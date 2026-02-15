import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import { createDAVClient, DAVCalendar, DAVObject } from "tsdav";
import { getSupabase } from "./supabase";

// ---------------------------------------------------------------------------
// Firebase & global config
// ---------------------------------------------------------------------------
admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const app = express();

// CORS: restrict to known origins in production
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://slotted-ai.web.app",
  "https://slotted-ai.firebaseapp.com",
];
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Still allow in dev; tighten for production
      }
    },
    credentials: true,
  }),
);
app.use(express.json());

// Strip /api prefix so routes work both directly and through Firebase Hosting rewrites
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    req.url = req.url.replace(/^\/api/, "");
  }
  next();
});

// ---------------------------------------------------------------------------
// Auth middleware — verifies Firebase ID token from Authorization header
// ---------------------------------------------------------------------------
interface AuthRequest extends Request {
  uid?: string;
}

async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    const token = header.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/** Helper: get the Supabase user row for a Firebase UID */
async function getDbUser(firebaseUid: string) {
  const { data } = await getSupabase()
    .from("users")
    .select("*")
    .eq("firebase_uid", firebaseUid)
    .single();
  return data;
}

/** Helper: get the Supabase user row by internal UUID */
async function getDbUserById(userId: string) {
  const { data } = await getSupabase()
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

// ---------------------------------------------------------------------------
// Health check (public)
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "slotted-api", timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------
async function createNotification(opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedUserId?: string;
  relatedId?: string;
}) {
  const { error } = await getSupabase().from("notifications").insert({
    user_id: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    related_user_id: opts.relatedUserId || null,
    related_id: opts.relatedId || null,
  });
  if (error) {
    console.error("Failed to create notification:", error.message);
    return;
  }

  //Send FCM push notification
  try {
    const { data: tokens } = await getSupabase()
      .from("fcm_tokens")
      .select("token")
      .eq("user_id", opts.userId);

    if (!tokens || tokens.length === 0) {
      console.log(`No FCM tokens found for user ${opts.userId}`);
      return;
    }

    // Send to all user's devices
    const messaging = admin.messaging();
    const tokenList = tokens.map((t) => t.token);

    const message = {
      notification: {
        title: opts.title,
        body: opts.body,
      },
      data: {
        type: opts.type,
        relatedId: opts.relatedId || "",
        relatedUserId: opts.relatedUserId || "",
      },
      tokens: tokenList,
    };

    const response = await messaging.sendEachForMulticast(message);
    console.log(`Sent ${response.successCount} FCM notifications to user ${opts.userId}`);

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
          ) {
            invalidTokens.push(tokenList[idx]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await getSupabase()
          .from("fcm_tokens")
          .delete()
          .in("token", invalidTokens);
        console.log(`Removed ${invalidTokens.length} invalid FCM tokens`);
      }
    }
  } catch (fcmError: any) {
    console.error("Error sending FCM push notification:", fcmError.message);
    // Don't fail the whole notification creation if FCM fails
  }
}

// ---------------------------------------------------------------------------
// Notification routes
// ---------------------------------------------------------------------------

/** GET /notifications — list current user's notifications */
app.get("/notifications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { data, error } = await getSupabase()
      .from("notifications")
      .select("*, related_user:related_user_id(display_name, photo_url)")
      .eq("user_id", me.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /notifications/unread-count — quick badge count */
app.get("/notifications/unread-count", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { count, error } = await getSupabase()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", me.id)
      .eq("read", false);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ count: count || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /notifications/:id/read — mark a single notification as read */
app.patch("/notifications/:id/read", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { error } = await getSupabase()
      .from("notifications")
      .update({ read: true })
      .eq("id", req.params.id)
      .eq("user_id", me.id);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /notifications/mark-all-read — mark all notifications as read */
app.post("/notifications/mark-all-read", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { error } = await getSupabase()
      .from("notifications")
      .update({ read: true })
      .eq("user_id", me.id)
      .eq("read", false);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// User routes
// ---------------------------------------------------------------------------

/** Generate an invite code from a display name (e.g. "Shari Paltrowitz" → "shari123") */
async function generateInviteCode(displayName: string): Promise<string> {
  const base = (displayName || "user")
    .split(" ")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20) || "user";
  const sb = getSupabase();

  // Try the base name first (e.g. "mike"), then "mike" + random 4-digit suffix
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = attempt === 0 ? "" : String(Math.floor(1000 + Math.random() * 9000));
    const code = `${base}${suffix}`;
    const { data } = await sb.from("users").select("id").eq("invite_code", code).single();
    if (!data) return code; // unique — use it
  }
  // Fallback: base + full UUID fragment (guaranteed unique)
  const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base}${uuid}`;
}

/** POST /users/me — upsert user on first login / profile update */
app.post("/users/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { email, displayName, photoUrl, timezone } = req.body;

    // Check if user already exists (to preserve invite_code)
    const existing = await getDbUser(req.uid!);
    let inviteCode = existing?.invite_code;

    // Generate invite code for new users
    if (!inviteCode && displayName) {
      inviteCode = await generateInviteCode(displayName);
    }

    const { data, error } = await getSupabase()
      .from("users")
      .upsert(
        {
          firebase_uid: req.uid!,
          email,
          display_name: displayName,
          photo_url: photoUrl,
          // Only set timezone on first login; don't overwrite if the user already has one
          ...(existing?.timezone ? {} : { timezone: timezone || "America/New_York" }),
          ...(inviteCode ? { invite_code: inviteCode } : {}),
        },
        { onConflict: "firebase_uid" },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Auto-connect with anyone who previously invited this email
    if (data && email) {
      try {
        const { data: pendingRows } = await getSupabase()
          .from("pending_invites")
          .select("inviter_id")
          .eq("invited_email", email.toLowerCase());

        if (pendingRows && pendingRows.length > 0) {
          // Deduplicate — only process unique inviter IDs
          const uniqueInviterIds = [...new Set(pendingRows.map((r: any) => r.inviter_id))];
          for (const inviterId of uniqueInviterIds) {
            if (inviterId === data.id) continue; // skip self
            const [userA, userB] =
              data.id < inviterId
                ? [data.id, inviterId]
                : [inviterId, data.id];

            // Check if friendship already exists (may have been created by accept-invite)
            const { data: existingFriendship } = await getSupabase()
              .from("friendships")
              .select("id")
              .eq("user_a_id", userA)
              .eq("user_b_id", userB)
              .single();

            if (existingFriendship) continue; // Already connected — skip

            await getSupabase()
              .from("friendships")
              .upsert(
                {
                  user_a_id: userA,
                  user_b_id: userB,
                  invited_by: inviterId,
                  status: "accepted",
                },
                { onConflict: "user_a_id,user_b_id" },
              );

            // Notify the inviter
            await createNotification({
              userId: inviterId,
              type: "friend_accepted",
              title: "New friend joined!",
              body: `${data.display_name || email} joined Slotted and you're now connected.`,
              relatedUserId: data.id,
            });
          }

          // Clean up fulfilled pending invites
          await getSupabase()
            .from("pending_invites")
            .delete()
            .eq("invited_email", email.toLowerCase());
        }
      } catch (pendingErr) {
        console.error("Pending invite auto-connect failed:", pendingErr);
        // Non-blocking — don't fail the signup
      }
    }

    // Send a welcome notification encouraging the user to invite friends
    if (data) {
      await createNotification({
        userId: data.id,
        type: "friend_request" as any,
        title: "Welcome to Slotted! 👋",
        body: "Invite your friends so Slotted can find the best times for you to hang out. Head to the Friends tab to send invites!",
      });
    }

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Fields that must NEVER be sent to the client */
const SENSITIVE_FIELDS = [
  "google_access_token",
  "google_refresh_token",
  "google_token_expires_at",
  "apple_caldav_password",
  "apple_caldav_username",
  "calendar_watch_channel",
  "calendar_watch_expiry",
];

function stripSensitive(user: Record<string, any>) {
  const safe = { ...user };
  for (const field of SENSITIVE_FIELDS) {
    delete safe[field];
  }
  return safe;
}

/** GET /users/me — fetch current user profile (sensitive fields stripped) */
app.get("/users/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getDbUser(req.uid!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(stripSensitive(user));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /users/invite/:code — look up a user by their invite code (public) */
app.get("/users/invite/:code", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { data, error } = await getSupabase()
      .from("users")
      .select("display_name, photo_url")
      .eq("invite_code", (code as string).toLowerCase())
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Invite code not found" });
      return;
    }
    res.json({ uid: data.firebase_uid, displayName: data.display_name, photoUrl: data.photo_url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /users/me/battery — update social battery level */
app.patch("/users/me/battery", requireAuth, async (req: AuthRequest, res: Response) => {
  const { level } = req.body;
  if (!["open", "ask_me", "recharging"].includes(level)) {
    res.status(400).json({ error: "Invalid battery level" });
    return;
  }
  try {
    const { data, error } = await getSupabase()
      .from("users")
      .update({ social_battery: level })
      .eq("firebase_uid", req.uid!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /users/me/settings — save settings page preferences */
app.put("/users/me/settings", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      socialFrequency, preferredTimes, travelBuffer,
      socialBattery, rechargingDays, planningStyle,
      neighborhood, workNeighborhood, officeDays,
      callWindows, tripBufferBefore, tripBufferAfter, shareHangouts, officeScheduleVaries,
      eventInterests, eventCity, displayName,
    } = req.body;

    const updates: Record<string, any> = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (socialFrequency !== undefined) updates.social_frequency = socialFrequency;
    if (preferredTimes !== undefined) updates.preferred_times = preferredTimes;
    if (travelBuffer !== undefined) updates.travel_buffer_min = parseInt(travelBuffer, 10);
    if (socialBattery !== undefined) updates.social_battery = socialBattery;
    if (rechargingDays !== undefined) updates.recharging_days = rechargingDays;
    if (planningStyle !== undefined) updates.planning_style = planningStyle;
    if (neighborhood !== undefined) updates.neighborhood = neighborhood;
    if (workNeighborhood !== undefined) updates.work_neighborhood = workNeighborhood;
    if (officeDays !== undefined) updates.office_days = officeDays;
    if (officeScheduleVaries !== undefined) updates.office_schedule_varies = officeScheduleVaries;
    if (callWindows !== undefined) updates.call_windows = callWindows;
    if (tripBufferBefore !== undefined) updates.trip_buffer_before = tripBufferBefore;
    if (tripBufferAfter !== undefined) updates.trip_buffer_after = tripBufferAfter;
    if (shareHangouts !== undefined) updates.share_hangouts = shareHangouts;
    if (eventInterests !== undefined) updates.event_interests = eventInterests;
    if (eventCity !== undefined) updates.event_city = eventCity;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("users")
      .update(updates)
      .eq("firebase_uid", req.uid!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(stripSensitive(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /users/me/onboarding — save onboarding answers */
app.post("/users/me/onboarding", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { socialFrequency, preferredTimes, travelBuffer, socialBattery, rechargingDays, socialGoal, preferredDuration, preferredCallDuration } =
      req.body;

    const { data, error } = await getSupabase()
      .from("users")
      .update({
        social_frequency: socialFrequency,
        preferred_times: preferredTimes,
        travel_buffer_min: travelBuffer ? parseInt(travelBuffer, 10) : 30,
        social_battery: socialBattery || "open",
        recharging_days: rechargingDays || [],
        social_goal: socialGoal || null,
        preferred_duration: preferredDuration || null,
        preferred_call_duration: preferredCallDuration || null,
        onboarded: true,
      })
      .eq("firebase_uid", req.uid!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /users/me/fcm-token — save FCM token for push notifications */
app.post("/users/me/fcm-token", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { token, deviceInfo } = req.body;
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    // Upsert the FCM token (allows multiple tokens per user for different devices)
    const { data, error } = await getSupabase()
      .from("fcm_tokens")
      .upsert(
        {
          user_id: me.id,
          token,
          device_info: deviceInfo || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,token" }
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /users/me/fcm-token — remove FCM token (logout/disable notifications) */
app.delete("/users/me/fcm-token", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const { error } = await getSupabase()
      .from("fcm_tokens")
      .delete()
      .eq("user_id", me.id)
      .eq("token", token);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Friends routes
// ---------------------------------------------------------------------------

/** GET /friends — list current user's friendships with friend details */
app.get("/friends", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Friendships where user is either side
    const { data: friendships, error } = await getSupabase()
      .from("friendships")
      .select("*, user_a:users!friendships_user_a_id_fkey(*), user_b:users!friendships_user_b_id_fkey(*)")
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Flatten: return the *other* user as "friend"
    const friends = (friendships || []).map((f: any) => {
      const iAmA = f.user_a.id === me.id;
      const friend = iAmA ? f.user_b : f.user_a;
      // hangoutPref is MY private preference for this friend
      const hangoutPref = iAmA ? (f.user_a_hangout_pref || "both") : (f.user_b_hangout_pref || "both");
      const friendshipType = iAmA ? (f.user_a_friendship_type || "local") : (f.user_b_friendship_type || "local");
      const visitDurationHours = iAmA ? f.user_a_visit_duration_hours : f.user_b_visit_duration_hours;
      return {
        friendshipId: f.id,
        status: f.status,
        invitedBy: f.invited_by,
        hangoutPref,
        friendshipType,
        visitDurationHours,
        friend: {
          id: friend.id,
          displayName: friend.display_name,
          email: friend.email,
          photoUrl: friend.photo_url,
          socialBattery: friend.social_battery,
          neighborhood: friend.neighborhood,
          timezone: friend.timezone,
          calendarConnected: !!(friend.google_refresh_token || friend.apple_calendar_connected),
          eventInterests: friend.event_interests || [],
        },
      };
    });

    res.json({ friends });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /friends/invite — send a friend invite by email */
app.post("/friends/invite", requireAuth, async (req: AuthRequest, res: Response) => {
  const { email, hangoutPref } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  const validPrefs = ["both", "one_on_one", "group"];
  const pref = validPrefs.includes(hangoutPref) ? hangoutPref : "both";
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Find the invitee
    const { data: invitee } = await getSupabase()
      .from("users")
      .select("id, neighborhood")
      .eq("email", email)
      .single();

    if (!invitee) {
      // Store a pending invite so we auto-connect when they sign up
      await getSupabase()
        .from("pending_invites")
        .upsert(
          { inviter_id: me.id, invited_email: email.toLowerCase() },
          { onConflict: "inviter_id,invited_email" },
        );
      res.status(202).json({
        pending: true,
        message: `${email} isn't on Slotted yet. They'll be auto-connected when they sign up!`,
        email,
      });
      return;
    }

    if (invitee.id === me.id) {
      res.status(400).json({ error: "Cannot friend yourself" });
      return;
    }

    // Auto-detect friendship type based on neighborhoods
    const myNeighborhood = (me.neighborhood || '').toLowerCase();
    const theirNeighborhood = (invitee.neighborhood || '').toLowerCase();
    let defaultFriendshipType = 'local';
    
    // Simple city detection: extract last part after comma (e.g., "West Village, NYC" → "nyc")
    const extractCity = (n: string) => n.split(',').pop()?.trim() || '';
    const myCity = extractCity(myNeighborhood);
    const theirCity = extractCity(theirNeighborhood);
    
    if (myCity && theirCity && myCity !== theirCity) {
      defaultFriendshipType = 'long_distance';
    } else if (!myNeighborhood || !theirNeighborhood) {
      defaultFriendshipType = 'local'; // Default to local if either is unknown
    }

    // Canonical ordering: smaller UUID first
    const iAmA = me.id < invitee.id;
    const [userA, userB] = iAmA ? [me.id, invitee.id] : [invitee.id, me.id];

    const upsertPayload: any = {
      user_a_id: userA,
      user_b_id: userB,
      invited_by: me.id,
      status: "pending",
      user_a_friendship_type: defaultFriendshipType,
      user_b_friendship_type: defaultFriendshipType,
    };
    // Set MY hangout pref on the correct column
    if (iAmA) {
      upsertPayload.user_a_hangout_pref = pref;
    } else {
      upsertPayload.user_b_hangout_pref = pref;
    }

    const { data, error } = await getSupabase()
      .from("friendships")
      .upsert(upsertPayload, { onConflict: "user_a_id,user_b_id" })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Notify the invitee about the friend request
    await createNotification({
      userId: invitee.id,
      type: "friend_request",
      title: "New friend request",
      body: `${me.display_name || me.email} wants to connect on Slotted`,
      relatedUserId: me.id,
      relatedId: data.id,
    });

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /friends/connect-referral — auto-connect when someone signs up via referral link */
app.post("/friends/connect-referral", requireAuth, async (req: AuthRequest, res: Response) => {
  const { referrerUid, referrerEmail } = req.body;
  if (!referrerUid && !referrerEmail) {
    res.status(400).json({ error: "referrerUid or referrerEmail is required" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Look up the referrer by Firebase UID or email
    let referrer: any = null;
    if (referrerUid) {
      const { data } = await getSupabase()
        .from("users")
        .select("id, neighborhood")
        .eq("firebase_uid", referrerUid)
        .single();
      referrer = data;
    } else if (referrerEmail) {
      const { data } = await getSupabase()
        .from("users")
        .select("id, neighborhood")
        .eq("email", referrerEmail)
        .single();
      referrer = data;
    }

    if (!referrer) {
      res.status(404).json({ error: "Referrer not found" });
      return;
    }

    if (referrer.id === me.id) {
      res.status(400).json({ error: "Cannot friend yourself" });
      return;
    }

    // Auto-detect friendship type based on neighborhoods
    const myNeighborhood = (me.neighborhood || '').toLowerCase();
    const theirNeighborhood = (referrer.neighborhood || '').toLowerCase();
    let defaultFriendshipType = 'local';
    
    const extractCity = (n: string) => n.split(',').pop()?.trim() || '';
    const myCity = extractCity(myNeighborhood);
    const theirCity = extractCity(theirNeighborhood);
    
    if (myCity && theirCity && myCity !== theirCity) {
      defaultFriendshipType = 'long_distance';
    } else if (!myNeighborhood || !theirNeighborhood) {
      defaultFriendshipType = 'local';
    }

    // Canonical ordering: smaller UUID first
    const [userA, userB] =
      me.id < referrer.id ? [me.id, referrer.id] : [referrer.id, me.id];

    const { data, error } = await getSupabase()
      .from("friendships")
      .upsert(
        {
          user_a_id: userA,
          user_b_id: userB,
          invited_by: referrer.id,
          status: "accepted",
          user_a_friendship_type: defaultFriendshipType,
          user_b_friendship_type: defaultFriendshipType,
        },
        { onConflict: "user_a_id,user_b_id" },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Notify the referrer that the new user connected — but only if no notification was already sent
    if (data) {
      // Check if a notification was already created for this connection (e.g. from pending_invites auto-connect)
      const { data: existingNotif } = await getSupabase()
        .from("notifications")
        .select("id")
        .eq("user_id", referrer.id)
        .eq("type", "friend_accepted")
        .eq("related_user_id", me.id)
        .single();

      if (!existingNotif) {
        await createNotification({
          userId: referrer.id,
          type: "friend_accepted",
          title: "New friend connected!",
          body: `${me.display_name || me.email} joined Slotted via your invite and you're now connected.`,
          relatedUserId: me.id,
          relatedId: data.id,
        });
      }
    }

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /friends/:friendshipId — accept or decline a friendship, update prefs */
app.patch("/friends/:friendshipId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendshipId } = req.params;
  const { action, hangoutPref, friendshipType, visitDurationHours } = req.body;

  // Support accept/decline actions AND hangoutPref/friendshipType/visitDurationHours updates
  const validActions = ["accept", "decline"];
  const validPrefs = ["both", "one_on_one", "group"];
  const validTypes = ["local", "long_distance", "both"];
  const hasAction = action && validActions.includes(action);
  const hasPref = hangoutPref && validPrefs.includes(hangoutPref);
  const hasType = friendshipType && validTypes.includes(friendshipType);
  const hasVisitDuration = visitDurationHours !== undefined;

  if (!hasAction && !hasPref && !hasType && !hasVisitDuration) {
    res.status(400).json({ error: "Provide action, hangoutPref, friendshipType, or visitDurationHours" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const updatePayload: any = {};
    if (hasAction) {
      updatePayload.status = action === "accept" ? "accepted" : "declined";
    }

    // Update hangout pref or friendship type on the correct side
    if (hasPref || hasType || hasVisitDuration) {
      // Fetch the friendship to determine which side I am
      const { data: friendship } = await getSupabase()
        .from("friendships")
        .select("user_a_id, user_b_id")
        .eq("id", friendshipId)
        .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
        .single();
      if (friendship) {
        if (friendship.user_a_id === me.id) {
          if (hasPref) updatePayload.user_a_hangout_pref = hangoutPref;
          if (hasType) updatePayload.user_a_friendship_type = friendshipType;
          if (hasVisitDuration) updatePayload.user_a_visit_duration_hours = visitDurationHours;
        } else {
          if (hasPref) updatePayload.user_b_hangout_pref = hangoutPref;
          if (hasType) updatePayload.user_b_friendship_type = friendshipType;
          if (hasVisitDuration) updatePayload.user_b_visit_duration_hours = visitDurationHours;
        }
      }
    }

    const { data, error } = await getSupabase()
      .from("friendships")
      .update(updatePayload)
      .eq("id", friendshipId)
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Notify the inviter when their invite is accepted
    if (data && action === "accept") {
      const inviterId = data.invited_by;
      if (inviterId && inviterId !== me.id) {
        await createNotification({
          userId: inviterId,
          type: "friend_accepted",
          title: "Friend request accepted!",
          body: `${me.display_name || me.email} accepted your friend invite. You can now see each other's availability!`,
          relatedUserId: me.id,
          relatedId: data.id,
        });
      }
    }

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Calendar Sync Engine
// ---------------------------------------------------------------------------

const SYNC_WINDOW_DAYS = 14; // look 2 weeks ahead

/**
 * Sync a single user's Google Calendar + Apple Calendar events → `availability` table.
 * Reads events from all selected calendars (both sources), writes busy blocks, then
 * computes the inverse as free blocks within 8am–10pm each day.
 */
async function syncUserCalendar(firebaseUid: string): Promise<{ synced: boolean; slots: number }> {
  const dbUser = await getDbUser(firebaseUid);
  if (!dbUser) return { synced: false, slots: 0 };

  const hasGoogle = !!dbUser.google_refresh_token;
  const hasApple = !!(dbUser.apple_calendar_connected && dbUser.apple_caldav_username && dbUser.apple_caldav_password);

  if (!hasGoogle && !hasApple) return { synced: false, slots: 0 };

  const sb = getSupabase();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const allBusyBlocks: { start: string; end: string }[] = [];

  // --- Google Calendar sync ---
  if (hasGoogle) {
    const oauth2 = await getAuthedCalendarClient(firebaseUid);
    if (oauth2) {
      const calendarApi = google.calendar({ version: "v3", auth: oauth2 });

      // Get user's selected Google calendars
      const { data: selectedGoogleCals } = await sb
        .from("user_calendars")
        .select("calendar_id")
        .eq("user_id", dbUser.id)
        .eq("is_selected", true)
        .eq("source", "google");

      const googleCalIds = selectedGoogleCals?.map((c: any) => c.calendar_id) || [];

      const googleFetchPromises = googleCalIds.map(async (calId: string) => {
        try {
          const eventsRes = await calendarApi.events.list({
            calendarId: calId,
            timeMin: now.toISOString(),
            timeMax: windowEnd.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 500,
            fields: "items(start,end,status,transparency)",
          });

          for (const event of eventsRes.data.items || []) {
            if (event.status === "cancelled") continue;
            if (event.transparency === "transparent") continue;

            const start = event.start?.dateTime || event.start?.date;
            const end = event.end?.dateTime || event.end?.date;
            if (!start || !end) continue;

            const startDt = new Date(start);
            const endDt = new Date(end);
            if (startDt >= endDt) continue;

            allBusyBlocks.push({
              start: startDt.toISOString(),
              end: endDt.toISOString(),
            });
          }
        } catch (err) {
          console.error(`Failed to fetch Google calendar ${calId}:`, err);
        }
      });

      await Promise.all(googleFetchPromises);
    }
  }

  // --- Apple Calendar sync ---
  if (hasApple) {
    const { data: selectedAppleCals } = await sb
      .from("user_calendars")
      .select("calendar_id")
      .eq("user_id", dbUser.id)
      .eq("is_selected", true)
      .eq("source", "apple");

    const appleCalUrls = selectedAppleCals?.map((c: any) => c.calendar_id) || [];

    if (appleCalUrls.length > 0) {
      try {
        const appleBlocks = await fetchAppleBusyBlocks(
          dbUser.apple_caldav_username,
          dbUser.apple_caldav_password,
          appleCalUrls,
          now,
          windowEnd,
        );
        allBusyBlocks.push(...appleBlocks);
      } catch (err) {
        console.error("Failed to fetch Apple Calendar events:", err);
      }
    }
  }

  // ─── Trip buffer: detect multi-day events and block buffer days ───
  const tbBefore = !!dbUser.trip_buffer_before;
  const tbAfter = dbUser.trip_buffer_after !== false;
  if (tbBefore || tbAfter) {
    // Find multi-day all-day events in the busy blocks (spans ≥ 2 days)
    for (const block of [...allBusyBlocks]) {
      const s = new Date(block.start);
      const e = new Date(block.end);
      const spanDays = (e.getTime() - s.getTime()) / 86400000;
      if (spanDays >= 2) {
        const tz = dbUser.timezone || "America/New_York";
        if (tbBefore) {
          const dayBefore = new Date(s);
          dayBefore.setDate(dayBefore.getDate() - 1);
          const dayBeforeStr = dayBefore.toISOString().slice(0, 10);
          allBusyBlocks.push({
            start: zonedToUtc(dayBeforeStr, "00:00", tz).toISOString(),
            end: zonedToUtc(dayBeforeStr, "23:59", tz).toISOString(),
          });
        }
        if (tbAfter) {
          const dayAfterStr = e.toISOString().slice(0, 10);
          allBusyBlocks.push({
            start: zonedToUtc(dayAfterStr, "00:00", tz).toISOString(),
            end: zonedToUtc(dayAfterStr, "23:59", tz).toISOString(),
          });
        }
      }
    }
  }

  // Sort busy blocks by start time
  allBusyBlocks.sort((a, b) => a.start.localeCompare(b.start));

  // Merge overlapping busy blocks
  const mergedBusy: { start: Date; end: Date }[] = [];
  for (const block of allBusyBlocks) {
    const s = new Date(block.start);
    const e = new Date(block.end);
    if (mergedBusy.length > 0 && s <= mergedBusy[mergedBusy.length - 1].end) {
      // Overlapping — extend the previous block
      if (e > mergedBusy[mergedBusy.length - 1].end) {
        mergedBusy[mergedBusy.length - 1].end = e;
      }
    } else {
      mergedBusy.push({ start: s, end: e });
    }
  }

  // Generate free blocks: invert busy within 8am–10pm each day (user's timezone)
  const tz = dbUser.timezone || "America/New_York";
  const freeBlocks: { start: string; end: string }[] = [];

  for (let d = 0; d < SYNC_WINDOW_DAYS; d++) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() + d);

    // Calculate 8am and 10pm in the user's timezone
    const dayStr = dayStart.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
    const dayOpen = new Date(`${dayStr}T08:00:00`);
    const dayClose = new Date(`${dayStr}T22:00:00`);

    // Convert to UTC using timezone offset estimation
    const utcOpen = zonedToUtc(dayStr, "08:00", tz);
    const utcClose = zonedToUtc(dayStr, "22:00", tz);

    if (utcOpen >= windowEnd || utcClose <= now) continue;

    // Clip to our sync window
    const windowStart = utcOpen < now ? now : utcOpen;
    const windowEndClamped = utcClose > windowEnd ? windowEnd : utcClose;

    // Find busy blocks that overlap this day window
    const dayBusy = mergedBusy.filter(
      (b) => b.start < windowEndClamped && b.end > windowStart,
    );

    // Compute free gaps
    let cursor = windowStart;
    for (const busy of dayBusy) {
      const busyStart = busy.start < windowStart ? windowStart : busy.start;
      const busyEnd = busy.end > windowEndClamped ? windowEndClamped : busy.end;

      if (cursor < busyStart) {
        // Free gap before this busy block
        const gapMinutes = (busyStart.getTime() - cursor.getTime()) / 60000;
        if (gapMinutes >= 30) {
          // Only keep gaps >= 30 min
          freeBlocks.push({
            start: cursor.toISOString(),
            end: busyStart.toISOString(),
          });
        }
      }
      if (busyEnd > cursor) cursor = busyEnd;
    }

    // Last free gap after all busy blocks
    if (cursor < windowEndClamped) {
      const gapMinutes = (windowEndClamped.getTime() - cursor.getTime()) / 60000;
      if (gapMinutes >= 30) {
        freeBlocks.push({
          start: cursor.toISOString(),
          end: windowEndClamped.toISOString(),
        });
      }
    }
  }

  // Clear old availability for this user and write new data
  await sb
    .from("availability")
    .delete()
    .eq("user_id", dbUser.id);

  if (freeBlocks.length > 0) {
    const rows = freeBlocks.map((f) => ({
      user_id: dbUser.id,
      start_time: f.start,
      end_time: f.end,
      status: "free",
    }));

    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await sb.from("availability").insert(batch);
    }
  }

  console.log(`📅 Synced ${freeBlocks.length} free blocks for user ${dbUser.id}`);
  return { synced: true, slots: freeBlocks.length };
}

/** Helper: rough timezone conversion (date string + time → UTC Date) */
function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  // Use a formatter to figure out the UTC offset for this timezone on this date
  const refDate = new Date(`${dateStr}T${timeStr}:00`);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(refDate);

    const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
    const localInTz = new Date(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`,
    );
    const offsetMs = localInTz.getTime() - refDate.getTime();
    // The target time in the timezone is dateStr + timeStr,
    // so UTC = target - offset
    return new Date(refDate.getTime() - offsetMs);
  } catch {
    return refDate; // fallback: assume local = UTC
  }
}

// ---------------------------------------------------------------------------
// Helpers: Travel Buffer, Weekly Quota, Planning Horizon
// ---------------------------------------------------------------------------

/**
 * Apply travel buffer to free slots — shrink each slot by `bufferMin` on both ends.
 * If the resulting slot is shorter than `minDurationMin`, discard it.
 */
function applyTravelBuffer(
  slots: { start_time: string; end_time: string }[],
  bufferMin: number,
  minDurationMin = 30,
): { start_time: string; end_time: string }[] {
  if (bufferMin <= 0) return slots;
  const bufferMs = bufferMin * 60000;
  return slots
    .map((s) => {
      const start = new Date(new Date(s.start_time).getTime() + bufferMs);
      const end = new Date(new Date(s.end_time).getTime() - bufferMs);
      return { start_time: start.toISOString(), end_time: end.toISOString() };
    })
    .filter((s) => {
      const durMin = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60000;
      return durMin >= minDurationMin;
    });
}

/**
 * Count user's upcoming meetups this week (confirmed + proposed + accepted).
 * Returns { count, limit, isOverLimit, message? }.
 */
async function getWeeklyMeetupStatus(userId: string) {
  const sb = getSupabase();

  // Get user's social_frequency setting
  const { data: user } = await sb
    .from("users")
    .select("social_frequency")
    .eq("id", userId)
    .single();

  // Map social_frequency to weekly limit
  const frequencyToLimit: Record<string, number> = {
    daily: 7,
    "2-3-week": 3,
    weekly: 1,
    biweekly: 1, // 1 per 2 weeks, but we check weekly
  };
  const limit = frequencyToLimit[user?.social_frequency || "2-3-week"] || 3;

  // Count meetups this week (Mon-Sun window)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  // Get meetup IDs where user is participating and accepted/confirmed
  const { data: participations } = await sb
    .from("meetup_participants")
    .select("meetup_id")
    .eq("user_id", userId)
    .in("rsvp", ["accepted", "pending"]);

  if (!participations || participations.length === 0) {
    return { count: 0, limit, isOverLimit: false };
  }

  const meetupIds = participations.map((p: any) => p.meetup_id);

  // Count those meetups that fall this week and aren't cancelled
  const { data: weekMeetups, count } = await sb
    .from("meetups")
    .select("id", { count: "exact" })
    .in("id", meetupIds)
    .gte("start_time", weekStart.toISOString())
    .lt("start_time", weekEnd.toISOString())
    .in("status", ["proposed", "confirmed"]);

  const meetupCount = count || weekMeetups?.length || 0;
  const isOverLimit = meetupCount >= limit;

  return {
    count: meetupCount,
    limit,
    isOverLimit,
    socialFrequency: user?.social_frequency || "2-3-week",
  };
}

/**
 * Get planning horizon scoring adjustments based on user's planning_style.
 * Returns { minDays, maxDays, bonusDaysRange, penaltyDaysRange }.
 */
function getPlanningHorizon(planningStyle: string | null | undefined) {
  switch (planningStyle) {
    case "spontaneous":
      return {
        // Spontaneous: strong preference for 0-3 days, penalize >7 days
        nearBonus: 20,     // bonus for slots 0-3 days out
        midBonus: 5,       // small bonus for 4-7 days
        farPenalty: -15,   // penalty for 7+ days
        nearRange: 3,
        midRange: 7,
      };
    case "planner":
      return {
        // Planner: penalize same-day, prefer 5-28 days out
        nearBonus: -10,    // penalty for 0-2 days (too spontaneous)
        midBonus: 10,      // bonus for 3-7 days
        farPenalty: 15,    // bonus (not penalty!) for 7+ days
        nearRange: 2,
        midRange: 7,
      };
    case "flexible":
    default:
      return {
        // Flexible: slight near-term preference, adapts
        nearBonus: 8,
        midBonus: 5,
        farPenalty: -3,
        nearRange: 3,
        midRange: 7,
      };
  }
}

// ---------------------------------------------------------------------------
// AI Suggestion Scoring
// ---------------------------------------------------------------------------

/**
 * Map a preferred_times entry (e.g. "weekday-evening") to an hour range.
 */
function timeSlotToHourRange(slot: string): { start: number; end: number } | null {
  const timeOfDay = slot.split("-").slice(1).join("-"); // handle "weekday-evening", "weekend-afternoon"
  switch (timeOfDay) {
    case "morning":   return { start: 8, end: 12 };
    case "afternoon": return { start: 12, end: 17 };
    case "evening":   return { start: 17, end: 21 };
    case "night":     return { start: 21, end: 23 };
    default:          return null;
  }
}

/**
 * Clamp overlap windows to the intersection of all participants' preferred time ranges.
 * For each user that has preferred_times set, overlaps are restricted to times within
 * those windows (unioned across their preference entries for the matching day type).
 * Users without preferred_times impose no restriction.
 * This uses each user's timezone for correct day-of-week and hour computation.
 */
function clampOverlapsToPreferences(
  overlaps: { start: string; end: string }[],
  userProfiles: Array<{ preferred_times?: string[] | null; timezone?: string | null }>,
): { start: string; end: string }[] {
  // Collect per-user allowed hour ranges keyed by "weekday" | "weekend"
  const userWindows = userProfiles
    .filter((u) => u.preferred_times && u.preferred_times.length > 0)
    .map((u) => {
      const weekdayRanges: { start: number; end: number }[] = [];
      const weekendRanges: { start: number; end: number }[] = [];
      for (const pref of u.preferred_times!) {
        const isWeekend = pref.startsWith("weekend");
        const range = timeSlotToHourRange(pref);
        if (range) {
          (isWeekend ? weekendRanges : weekdayRanges).push(range);
        }
      }
      return { tz: u.timezone || "America/New_York", weekdayRanges, weekendRanges };
    });

  if (userWindows.length === 0) return overlaps; // no restrictions

  let result = overlaps;

  for (const uw of userWindows) {
    const newResult: { start: string; end: string }[] = [];

    for (const slot of result) {
      const startDt = new Date(slot.start);
      const endDt = new Date(slot.end);

      // Determine day-of-week in user's timezone
      const dayInTz = parseInt(
        new Intl.DateTimeFormat("en-US", { timeZone: uw.tz, weekday: "narrow" })
          .formatToParts(startDt)
          .find(() => true)?.value || "0",
        10,
      );
      // Better: use numeric weekday
      const weekdayNum = new Date(
        startDt.toLocaleString("en-US", { timeZone: uw.tz }),
      ).getDay();
      const isWeekend = weekdayNum === 0 || weekdayNum === 6;
      const ranges = isWeekend ? uw.weekendRanges : uw.weekdayRanges;

      if (ranges.length === 0) {
        // No preference for this day type — allow all hours
        newResult.push(slot);
        continue;
      }

      // Get the date string in user's timezone for constructing clamped UTC times
      const dateStr = startDt.toLocaleDateString("en-CA", { timeZone: uw.tz });

      for (const range of ranges) {
        const rangeStartUtc = zonedToUtc(dateStr, `${String(range.start).padStart(2, "0")}:00`, uw.tz);
        const rangeEndUtc = zonedToUtc(dateStr, `${String(range.end).padStart(2, "0")}:00`, uw.tz);

        // Clamp the overlap to this preference window
        const clampedStart = startDt > rangeStartUtc ? startDt : rangeStartUtc;
        const clampedEnd = endDt < rangeEndUtc ? endDt : rangeEndUtc;

        if (clampedStart < clampedEnd) {
          const durMin = (clampedEnd.getTime() - clampedStart.getTime()) / 60000;
          if (durMin >= 30) {
            newResult.push({
              start: clampedStart.toISOString(),
              end: clampedEnd.toISOString(),
            });
          }
        }
      }
    }

    result = newResult;
  }

  return result;
}

interface ScoredSlot {
  start: string;
  end: string;
  score: number;
  reasons: string[];
  dayLabel: string;
  timeLabel: string;
}

/**
 * Score overlapping free slots based on user preferences.
 * Supports 1-to-1 (userId + friendId) or group (userId + friendIds[]).
 * Returns top-N suggestions sorted by score descending.
 */
async function scoreOverlaps(
  userId: string,
  friendId: string,
  overlaps: { start: string; end: string }[],
  limit = 5,
  mode = "in_person",
): Promise<ScoredSlot[]> {
  return scoreGroupOverlaps(userId, [friendId], overlaps, limit, mode);
}

/**
 * Score overlapping free slots for a group of participants.
 */
async function scoreGroupOverlaps(
  userId: string,
  participantIds: string[],
  overlaps: { start: string; end: string }[],
  limit = 5,
  mode = "in_person",
): Promise<ScoredSlot[]> {
  const sb = getSupabase();

  // Fetch all participants' profiles and preferences in parallel
  const allIds = [userId, ...participantIds];
  const [profilesRes, prefsRes] = await Promise.all([
    Promise.all(allIds.map((id) =>
      sb.from("users").select("*").eq("id", id).single().then((r) => r.data),
    )),
    Promise.all(allIds.map((id) =>
      sb.from("user_preferences").select("*").eq("user_id", id).single().then((r) => r.data),
    )),
  ]);

  const userProfile = profilesRes[0];
  const friendProfiles = profilesRes.slice(1);
  const userPrefs = prefsRes[0];

  // Use the requesting user's timezone for all time computations
  const userTz = userProfile?.timezone || "America/New_York";

  /** Get hour and day-of-week in the user's timezone */
  const getLocalParts = (dt: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: userTz,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(dt);
    const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value || "Mon";
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { hour: parseInt(hourStr, 10), dayOfWeek: dayMap[weekdayStr] ?? 1 };
  };

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const scored: ScoredSlot[] = overlaps.map((slot) => {
    const startDt = new Date(slot.start);
    const endDt = new Date(slot.end);
    const durationMin = (endDt.getTime() - startDt.getTime()) / 60000;
    const localParts = getLocalParts(startDt);
    const dayOfWeek = localParts.dayOfWeek;
    const hour = localParts.hour;
    const isCallMode = mode === "phone" || mode === "video";
    let score = 50; // base score
    const reasons: string[] = [];

    // 1. Duration scoring — different for calls vs in-person
    if (isCallMode) {
      // For calls: 15-30 min is ideal, 30-60 is great, longer is fine but not as necessary
      if (durationMin >= 30 && durationMin <= 60) {
        score += 15;
        reasons.push("Perfect call length");
      } else if (durationMin >= 15 && durationMin < 30) {
        score += 10;
        reasons.push("Quick catch-up window");
      } else if (durationMin > 60) {
        score += 8;
        reasons.push("Plenty of time");
      }
    } else {
      // For in-person: longer is better
      if (durationMin >= 120) {
        score += 15;
        reasons.push("2+ hour window");
      } else if (durationMin >= 60) {
        score += 10;
        reasons.push("1 hour window");
      } else if (durationMin < 45) {
        score -= 10;
      }
    }

    // 2. Time-of-day match with user preferred times
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const timeKey = `${isWeekend ? "weekend" : "weekday"}-${timeOfDay}`;

    if (userProfile?.preferred_times?.includes(timeKey)) {
      score += 15;
      reasons.push("Your preferred time");
    }

    // 2b. Call-specific: boost lunch breaks, commute hours, and user's call windows
    if (isCallMode) {
      // Lunch break is great for calls
      if (hour >= 12 && hour <= 13) {
        score += 12;
        reasons.push("Lunch break call");
      }
      // Early morning commute (8-9am) or evening commute (5-7pm)
      if ((hour >= 8 && hour < 9) || (hour >= 17 && hour < 19)) {
        score += 8;
        reasons.push("Commute-friendly");
      }
      // Check user's saved call windows
      if (userProfile?.call_windows && Array.isArray(userProfile.call_windows)) {
        for (const cw of userProfile.call_windows) {
          if (cw.day === dayOfWeek) {
            const cwStart = parseInt(cw.start?.split(":")[0] || "0", 10);
            const cwEnd = parseInt(cw.end?.split(":")[0] || "23", 10);
            if (hour >= cwStart && hour < cwEnd) {
              score += 15;
              reasons.push(cw.label ? `Your "${cw.label}" window` : "Your call window");
              break;
            }
          }
        }
      }
    }

    // 3. Social battery check — factor in all participants
    if (userProfile?.social_battery === "recharging") {
      score -= 20;
      reasons.push("You're recharging");
    } else if (userProfile?.social_battery === "open") {
      score += 5;
    }

    let friendsRecharging = 0;
    let friendsOpen = 0;
    for (const fp of friendProfiles) {
      if (fp?.social_battery === "recharging") friendsRecharging++;
      else if (fp?.social_battery === "open") friendsOpen++;
    }
    if (friendsRecharging > 0) {
      score -= 10 * friendsRecharging;
      reasons.push(`${friendsRecharging} friend${friendsRecharging > 1 ? "s" : ""} recharging`);
    }
    if (friendsOpen === friendProfiles.length && friendProfiles.length > 0) {
      score += 5;
      reasons.push("Everyone's open");
    }

    // 3b. Recharging days — heavily penalize days the user always recharges
    if (userProfile?.recharging_days?.includes(dayOfWeek)) {
      score -= 40;
      reasons.push("Your recharge day");
    }
    for (const fp of friendProfiles) {
      if (fp?.recharging_days?.includes(dayOfWeek)) {
        score -= 20;
        reasons.push(`${fp.display_name || "Friend"}'s recharge day`);
      }
    }

    // 4. Weekend bonus
    if (isWeekend) {
      score += isCallMode ? 3 : 5;
      reasons.push("Weekend");
    }

    // 5. Afternoon/evening sweet spot (in-person only — call mode handles this above)
    if (!isCallMode) {
      if (hour >= 11 && hour <= 14) {
        score += 8;
        reasons.push("Lunch hours");
      } else if (hour >= 17 && hour <= 20) {
        score += 10;
        reasons.push("Evening hours");
      } else if (hour < 9) {
        score -= 5;
      }
    }

    // 6. Learned preference match
    if (userPrefs?.preferred_time === timeOfDay) {
      score += 10;
      reasons.push("Matches your pattern");
    }
    if (userPrefs?.preferred_day === dayNames[dayOfWeek]) {
      score += 8;
      reasons.push("Your favorite day");
    }

    // 7. Planning horizon — adjust score based on user's planning style
    const daysAway = (startDt.getTime() - Date.now()) / 86400000;
    const horizon = getPlanningHorizon(userProfile?.planning_style);
    if (daysAway <= horizon.nearRange) {
      score += horizon.nearBonus;
      if (horizon.nearBonus > 0) reasons.push("Fits your spontaneous style");
      else if (horizon.nearBonus < -5) reasons.push("Might be too last-minute for you");
    } else if (daysAway <= horizon.midRange) {
      score += horizon.midBonus;
    } else {
      score += horizon.farPenalty;
      if (horizon.farPenalty > 0) reasons.push("Good planning-ahead window");
      else if (horizon.farPenalty < -5) reasons.push("Far out — you prefer spontaneous");
    }

    // Also factor in friend planning styles — if both are planners, boost far-out slots
    for (const fp of friendProfiles) {
      if (fp?.planning_style === "planner" && userProfile?.planning_style === "planner" && daysAway > 5) {
        score += 5;
        reasons.push("Both planners — great to book ahead");
      }
      if (fp?.planning_style === "spontaneous" && userProfile?.planning_style === "spontaneous" && daysAway <= 2) {
        score += 5;
        reasons.push("Both spontaneous — grab it!");
      }
    }

    // Clamp score 0–100
    score = Math.max(0, Math.min(100, score));

    // Human-readable labels (in the requesting user's timezone)
    const dayLabel = startDt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: userTz,
    });
    const startTime = startDt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: userTz,
    });
    const endTime = endDt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: userTz,
    });
    const timeLabel = `${startTime} – ${endTime}`;

    return { start: slot.start, end: slot.end, score, reasons, dayLabel, timeLabel };
  });

  // Sort by score descending, return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Availability routes
// ---------------------------------------------------------------------------

/** POST /calendar/sync — trigger a calendar sync for the current user */
app.post("/calendar/sync", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await syncUserCalendar(req.uid!);
    if (!result.synced) {
      res.status(400).json({ error: "Calendar not connected or no calendars selected" });
      return;
    }
    res.json({ success: true, freeSlots: result.slots });
  } catch (err: any) {
    console.error("Calendar sync error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /availability — get current user's free/busy slots */
app.get("/availability", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data: slots, error } = await getSupabase()
      .from("availability")
      .select("*")
      .eq("user_id", me.id)
      .gte("end_time", new Date().toISOString())
      .order("start_time", { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ slots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /availability/overlap/:friendId — find mutual free slots with AI scoring */
app.get("/availability/overlap/:friendId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendId } = req.params;
  const mode = (req.query.mode as string) || "in_person"; // "in_person" | "phone" | "video"
  const isCallMode = mode === "phone" || mode === "video";
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Get the friend's DB user to find their firebase_uid for syncing
    const friendUser = await getDbUserById(friendId);

    // Auto-sync both calendars (in parallel) before computing overlap
    const syncResults = await Promise.allSettled([
      syncUserCalendar(req.uid!),
      friendUser?.firebase_uid ? syncUserCalendar(friendUser.firebase_uid) : Promise.resolve({ synced: false, slots: 0 }),
    ]);

    const mySync = syncResults[0].status === "fulfilled" ? syncResults[0].value : { synced: false, slots: 0 };
    const friendSync = syncResults[1].status === "fulfilled" ? syncResults[1].value : { synced: false, slots: 0 };

    const now = new Date().toISOString();

    // Fetch both users' free slots
    const [mySlots, friendSlots] = await Promise.all([
      getSupabase()
        .from("availability")
        .select("*")
        .eq("user_id", me.id)
        .eq("status", "free")
        .gte("end_time", now)
        .order("start_time"),
      getSupabase()
        .from("availability")
        .select("*")
        .eq("user_id", friendId)
        .eq("status", "free")
        .gte("end_time", now)
        .order("start_time"),
    ]);

    if (mySlots.error || friendSlots.error) {
      res.status(500).json({ error: "Failed to fetch availability" });
      return;
    }

    // Apply travel buffer — skip for phone/video calls
    const myBuffer = isCallMode ? 0 : (me.travel_buffer_min || 0);
    const friendBuffer = isCallMode ? 0 : (friendUser?.travel_buffer_min || 0);
    const myBuffered = applyTravelBuffer(mySlots.data || [], myBuffer);
    const friendBuffered = applyTravelBuffer(friendSlots.data || [], friendBuffer);

    // Compute overlaps (using buffered slots)
    const minDurationMin = isCallMode ? 15 : 30;
    const rawOverlaps: { start: string; end: string }[] = [];
    for (const a of myBuffered) {
      for (const b of friendBuffered) {
        const start = a.start_time > b.start_time ? a.start_time : b.start_time;
        const end = a.end_time < b.end_time ? a.end_time : b.end_time;
        if (start < end) {
          const durMin = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
          if (durMin >= minDurationMin) {
            rawOverlaps.push({ start, end });
          }
        }
      }
    }

    // Clamp overlaps to each user's preferred time windows
    const overlaps = clampOverlapsToPreferences(rawOverlaps, [
      { preferred_times: me.preferred_times, timezone: me.timezone },
      { preferred_times: friendUser?.preferred_times, timezone: friendUser?.timezone },
    ]);

    // AI-score the overlaps (pass mode for call-specific scoring)
    const suggestions = await scoreOverlaps(me.id, friendId, overlaps, 8, mode);

    // Persist top suggestions to suggestion_events
    for (const s of suggestions.slice(0, 5)) {
      const startDt = new Date(s.start);
      try {
        await getSupabase()
          .from("suggestion_events")
          .upsert(
            {
              user_id: me.id,
              friend_id: friendId,
              suggested_start: s.start,
              suggested_end: s.end,
              day_of_week: startDt.getDay(),
              hour_of_day: startDt.getHours(),
              social_battery: me.social_battery || "open",
              score: s.score / 100,
            },
            { onConflict: "user_id,friend_id,suggested_start" },
          );
      } catch { /* ignore duplicate insert errors */ }
    }

    res.json({
      overlaps,
      suggestions,
      syncStatus: {
        me: { synced: mySync.synced, freeSlots: mySync.slots },
        friend: {
          synced: friendSync.synced,
          freeSlots: friendSync.slots,
          name: friendUser?.display_name || "Friend",
          calendarConnected: !!(friendUser?.google_refresh_token || friendUser?.apple_calendar_connected),
        },
      },
    });
  } catch (err: any) {
    console.error("Overlap error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /availability/group-overlap — find mutual free slots among multiple friends */
app.post("/availability/group-overlap", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendIds } = req.body; // array of friend UUIDs
  if (!Array.isArray(friendIds) || friendIds.length === 0) {
    res.status(400).json({ error: "friendIds must be a non-empty array" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Fetch all friends' DB records
    const friendUsers = await Promise.all(
      friendIds.map((fid: string) => getDbUserById(fid)),
    );

    // Sync all calendars in parallel (me + all friends)
    const allUids = [
      req.uid!,
      ...friendUsers.map((u) => u?.firebase_uid).filter(Boolean) as string[],
    ];
    const syncResults = await Promise.allSettled(
      allUids.map((uid) => syncUserCalendar(uid)),
    );

    const now = new Date().toISOString();
    const sb = getSupabase();

    // Fetch free slots for all participants (me + friends) with travel buffer
    const allUserIds = [me.id, ...friendIds];
    const allProfiles = [me, ...friendUsers];
    const slotsByUser = await Promise.all(
      allUserIds.map((uid, idx) =>
        sb
          .from("availability")
          .select("start_time, end_time")
          .eq("user_id", uid)
          .eq("status", "free")
          .gte("end_time", now)
          .order("start_time")
          .then((r) => {
            const buffer = allProfiles[idx]?.travel_buffer_min || 0;
            return applyTravelBuffer(r.data || [], buffer);
          }),
      ),
    );

    // N-way overlap: start with first user's slots, intersect with each subsequent user
    let currentOverlaps: { start: string; end: string }[] = slotsByUser[0].map(
      (s: any) => ({ start: s.start_time, end: s.end_time }),
    );

    for (let i = 1; i < slotsByUser.length; i++) {
      const nextSlots = slotsByUser[i];
      const newOverlaps: { start: string; end: string }[] = [];
      for (const a of currentOverlaps) {
        for (const b of nextSlots) {
          const start = a.start > b.start_time ? a.start : b.start_time;
          const end = a.end < b.end_time ? a.end : b.end_time;
          if (start < end) {
            const durMin = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
            if (durMin >= 30) {
              newOverlaps.push({ start, end });
            }
          }
        }
      }
      currentOverlaps = newOverlaps;
    }

    // Clamp overlaps to each participant's preferred time windows
    const allParticipantProfiles = [me, ...friendUsers].map((u) => ({
      preferred_times: u?.preferred_times,
      timezone: u?.timezone,
    }));
    currentOverlaps = clampOverlapsToPreferences(currentOverlaps, allParticipantProfiles);

    // AI-score the group overlaps
    const suggestions = await scoreGroupOverlaps(me.id, friendIds, currentOverlaps, 8);

    // Build sync status for each participant
    const participantStatus = friendUsers.map((fu, idx) => {
      const syncResult = syncResults[idx + 1]; // +1 because index 0 is "me"
      const synced = syncResult?.status === "fulfilled"
        ? (syncResult.value as { synced: boolean; slots: number }).synced
        : false;
      const freeSlots = syncResult?.status === "fulfilled"
        ? (syncResult.value as { synced: boolean; slots: number }).slots
        : 0;
      return {
        id: fu?.id || friendIds[idx],
        name: fu?.display_name || "Friend",
        synced,
        freeSlots,
        calendarConnected: !!(fu?.google_refresh_token || fu?.apple_calendar_connected),
      };
    });

    const mySyncResult = syncResults[0];
    const mySync = mySyncResult?.status === "fulfilled"
      ? mySyncResult.value as { synced: boolean; slots: number }
      : { synced: false, slots: 0 };

    res.json({
      overlaps: currentOverlaps,
      suggestions,
      syncStatus: {
        me: { synced: mySync.synced, freeSlots: mySync.slots },
        participants: participantStatus,
      },
    });
  } catch (err: any) {
    console.error("Group overlap error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Friend Group routes
// ---------------------------------------------------------------------------

/** GET /groups — list user's groups with members */
app.get("/groups", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const sb = getSupabase();

    // Groups the user created OR is a member of
    const { data: memberRows } = await sb
      .from("friend_group_members")
      .select("group_id")
      .eq("user_id", me.id);

    const { data: createdGroups } = await sb
      .from("friend_groups")
      .select("id")
      .eq("created_by", me.id);

    const allGroupIds = [
      ...new Set([
        ...(memberRows || []).map((r: any) => r.group_id),
        ...(createdGroups || []).map((r: any) => r.id),
      ]),
    ];

    if (allGroupIds.length === 0) {
      res.json({ groups: [] });
      return;
    }

    const { data: groups } = await sb
      .from("friend_groups")
      .select("*")
      .in("id", allGroupIds)
      .order("created_at", { ascending: false });

    // Fetch members for each group
    const { data: allMembers } = await sb
      .from("friend_group_members")
      .select("group_id, user_id")
      .in("group_id", allGroupIds);

    // Fetch user details for all member IDs
    const memberUserIds = [...new Set((allMembers || []).map((m: any) => m.user_id))];
    const { data: memberUsers } = memberUserIds.length > 0
      ? await sb.from("users").select("id, display_name, email, photo_url").in("id", memberUserIds)
      : { data: [] };

    const userMap = new Map((memberUsers || []).map((u: any) => [u.id, u]));

    const result = (groups || []).map((g: any) => {
      const members = (allMembers || [])
        .filter((m: any) => m.group_id === g.id)
        .map((m: any) => {
          const u = userMap.get(m.user_id);
          return {
            id: m.user_id,
            displayName: u?.display_name || "Unknown",
            email: u?.email || "",
            photoUrl: u?.photo_url || null,
          };
        });
      return { ...g, members };
    });

    res.json({ groups: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /groups — create a new group */
app.post("/groups", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { name, emoji, memberIds } = req.body;
    if (!name || !Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ error: "name and memberIds[] are required" });
      return;
    }

    const sb = getSupabase();

    const { data: group, error: gErr } = await sb
      .from("friend_groups")
      .insert({ name, emoji: emoji || "👥", created_by: me.id })
      .select()
      .single();

    if (gErr) { res.status(500).json({ error: gErr.message }); return; }

    // Add creator + all members
    const allIds = [me.id, ...memberIds.filter((id: string) => id !== me.id)];
    const rows = allIds.map((uid: string) => ({ group_id: group.id, user_id: uid }));

    const { error: mErr } = await sb
      .from("friend_group_members")
      .insert(rows);

    if (mErr) { res.status(500).json({ error: mErr.message }); return; }

    res.json(group);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /groups/:id — update a group (name, emoji, members) */
app.put("/groups/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const sb = getSupabase();
    const groupId = req.params.id;

    // Only creator can edit
    const { data: group } = await sb
      .from("friend_groups")
      .select("*")
      .eq("id", groupId)
      .eq("created_by", me.id)
      .single();

    if (!group) { res.status(404).json({ error: "Group not found or not owned by you" }); return; }

    const { name, emoji, memberIds } = req.body;

    if (name || emoji) {
      await sb.from("friend_groups").update({
        ...(name ? { name } : {}),
        ...(emoji ? { emoji } : {}),
      }).eq("id", groupId);
    }

    if (Array.isArray(memberIds)) {
      // Replace all members
      await sb.from("friend_group_members").delete().eq("group_id", groupId);
      const allIds = [me.id, ...memberIds.filter((id: string) => id !== me.id)];
      const rows = allIds.map((uid: string) => ({ group_id: groupId, user_id: uid }));
      await sb.from("friend_group_members").insert(rows);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /groups/:id — delete a group */
app.delete("/groups/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const sb = getSupabase();

    const { error } = await sb
      .from("friend_groups")
      .delete()
      .eq("id", req.params.id)
      .eq("created_by", me.id);

    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Meetup routes
// ---------------------------------------------------------------------------

/** POST /meetups — create a new meetup proposal */
app.post("/meetups", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { title, friendId, friendIds, startTime, endTime, location, description } = req.body;

    // Support both single friendId and multiple friendIds
    const participantIds: string[] = friendIds && Array.isArray(friendIds)
      ? friendIds
      : friendId
        ? [friendId]
        : [];

    if (participantIds.length === 0) {
      res.status(400).json({ error: "At least one friendId is required" });
      return;
    }

    // Check weekly quota — soft warning (not a block)
    const quotaStatus = await getWeeklyMeetupStatus(me.id);

    // Create the meetup
    const { data: meetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .insert({
        title: title || "Hangout",
        description,
        location,
        start_time: startTime,
        end_time: endTime,
        created_by: me.id,
      })
      .select()
      .single();

    if (meetupErr) {
      res.status(500).json({ error: meetupErr.message });
      return;
    }

    // Add all users as participants (creator + friends)
    const participants = [
      { meetup_id: meetup.id, user_id: me.id, rsvp: "accepted" },
      ...participantIds.map((pid: string) => ({
        meetup_id: meetup.id,
        user_id: pid,
        rsvp: "pending",
      })),
    ];

    const { error: partErr } = await getSupabase()
      .from("meetup_participants")
      .insert(participants);

    if (partErr) {
      res.status(500).json({ error: partErr.message });
      return;
    }

    // Notify each invited participant
    const startDt = new Date(startTime);
    const timeStr = startDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " at " + startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    for (const pid of participantIds) {
      await createNotification({
        userId: pid,
        type: "meetup_request",
        title: `${me.display_name || "Someone"} wants to hang!`,
        body: `${title || "Hangout"} — ${timeStr}`,
        relatedUserId: me.id,
        relatedId: meetup.id,
      });
    }

    // Return meetup with quota warning if applicable
    const response: any = { ...meetup };
    if (quotaStatus.isOverLimit) {
      response.quotaWarning = {
        message: `Heads up — you already have ${quotaStatus.count} plans this week. Your preference is ${quotaStatus.limit === 1 ? "about 1 plan" : `${quotaStatus.limit} plans`} per week. Want to keep this one?`,
        count: quotaStatus.count,
        limit: quotaStatus.limit,
        socialFrequency: quotaStatus.socialFrequency,
      };
    }
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /meetups — list user's meetups */
app.get("/meetups", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Find meetup IDs the user participates in
    const { data: participations, error: partErr } = await getSupabase()
      .from("meetup_participants")
      .select("meetup_id, rsvp")
      .eq("user_id", me.id);

    if (partErr) {
      res.status(500).json({ error: partErr.message });
      return;
    }

    if (!participations || participations.length === 0) {
      res.json({ meetups: [] });
      return;
    }

    const meetupIds = participations.map((p: any) => p.meetup_id);

    const { data: meetups, error: meetupErr } = await getSupabase()
      .from("meetups")
      .select("*")
      .in("id", meetupIds)
      .order("start_time", { ascending: true });

    if (meetupErr) {
      res.status(500).json({ error: meetupErr.message });
      return;
    }

    // Enrich meetups with participants + RSVP status
    const { data: allParticipants } = await getSupabase()
      .from("meetup_participants")
      .select("meetup_id, user_id, rsvp")
      .in("meetup_id", meetupIds);

    const participantUserIds = [...new Set((allParticipants || []).map((p: any) => p.user_id))];
    const { data: participantUsers } = participantUserIds.length > 0
      ? await getSupabase()
          .from("users")
          .select("id, display_name, photo_url, email")
          .in("id", participantUserIds)
      : { data: [] };

    const userMap = new Map((participantUsers || []).map((u: any) => [u.id, u]));

    const enriched = (meetups || []).map((m: any) => {
      const parts = (allParticipants || [])
        .filter((p: any) => p.meetup_id === m.id)
        .map((p: any) => {
          const u = userMap.get(p.user_id);
          return {
            userId: p.user_id,
            rsvp: p.rsvp,
            displayName: u?.display_name || "Unknown",
            photoUrl: u?.photo_url || null,
          };
        });
      return {
        ...m,
        myRsvp: participations.find((p: any) => p.meetup_id === m.id)?.rsvp || "pending",
        participants: parts,
      };
    });

    res.json({ meetups: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /meetups/:meetupId/rsvp — RSVP to a meetup */
app.patch("/meetups/:meetupId/rsvp", requireAuth, async (req: AuthRequest, res: Response) => {
  const { meetupId } = req.params;
  const { rsvp } = req.body;
  if (!["accepted", "declined", "maybe"].includes(rsvp)) {
    res.status(400).json({ error: "Invalid rsvp value" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Check weekly quota before accepting — soft warning
    let quotaWarning = null;
    if (rsvp === "accepted") {
      const quotaStatus = await getWeeklyMeetupStatus(me.id);
      if (quotaStatus.isOverLimit) {
        quotaWarning = {
          message: `It looks like you've already accepted ${quotaStatus.count} events this week and may be at your social limit — are you sure you want to commit to this event?`,
          count: quotaStatus.count,
          limit: quotaStatus.limit,
          socialFrequency: quotaStatus.socialFrequency,
        };
      }
    }

    const { data, error } = await getSupabase()
      .from("meetup_participants")
      .update({ rsvp })
      .eq("meetup_id", meetupId)
      .eq("user_id", me.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Notify the meetup creator about the RSVP
    const { data: meetup } = await getSupabase()
      .from("meetups")
      .select("title, created_by")
      .eq("id", meetupId)
      .single();

    if (meetup && meetup.created_by !== me.id) {
      const rsvpEmoji = rsvp === "accepted" ? "✅" : rsvp === "declined" ? "❌" : "🤔";
      await createNotification({
        userId: meetup.created_by,
        type: rsvp === "accepted" ? "meetup_confirmed" : "meetup_request",
        title: `${rsvpEmoji} ${me.display_name || "Someone"} ${rsvp} your invite`,
        body: meetup.title || "Hangout",
        relatedUserId: me.id,
        relatedId: meetupId,
      });
    }

    // Return RSVP data with quota warning if applicable
    const response: any = { ...data };
    if (quotaWarning) response.quotaWarning = quotaWarning;
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /meetups/:meetupId/didnt-happen — mark a meetup as didn't happen with reason */
app.patch("/meetups/:meetupId/didnt-happen", requireAuth, async (req: AuthRequest, res: Response) => {
  const { meetupId } = req.params;
  const { reason } = req.body;
  const validReasons = ["sick", "cancelled", "something_came_up", "too_tired", "scheduling_conflict", "other"];
  if (reason && !validReasons.includes(reason)) {
    res.status(400).json({ error: "Invalid reason" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("meetups")
      .update({ status: "didnt_happen", cancel_reason: reason || null })
      .eq("id", meetupId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Add to Calendar routes
// ---------------------------------------------------------------------------

/** GET /meetups/:meetupId/writable-calendars — list the user's writable Google + Apple calendars */
app.get("/meetups/:meetupId/writable-calendars", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const calendars: { id: string; name: string; color: string | null; source: string }[] = [];

    // Google calendars the user owns or can write to
    if (me.google_refresh_token) {
      const { data: gcals } = await getSupabase()
        .from("user_calendars")
        .select("calendar_id, calendar_name, calendar_color, access_role, source")
        .eq("user_id", me.id)
        .eq("source", "google")
        .eq("is_selected", true)
        .in("access_role", ["owner", "writer"])
        .order("calendar_name");

      (gcals || []).forEach((c: any) => {
        calendars.push({
          id: c.calendar_id,
          name: c.calendar_name,
          color: c.calendar_color,
          source: "google",
        });
      });
    }

    // Apple calendars (the user has stored via CalDAV)
    if (me.apple_calendar_connected) {
      const { data: acals } = await getSupabase()
        .from("user_calendars")
        .select("calendar_id, calendar_name, calendar_color, source")
        .eq("user_id", me.id)
        .eq("source", "apple")
        .eq("is_selected", true)
        .order("calendar_name");

      (acals || []).forEach((c: any) => {
        calendars.push({
          id: c.calendar_id,
          name: c.calendar_name,
          color: c.calendar_color,
          source: "apple",
        });
      });
    }

    // Always offer ICS download as a fallback
    res.json({
      calendars,
      googleConnected: !!me.google_refresh_token,
      appleConnected: !!me.apple_calendar_connected,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /meetups/:meetupId/add-to-calendar — create event in user's Google or Apple calendar (or return ICS) */
app.post("/meetups/:meetupId/add-to-calendar", requireAuth, async (req: AuthRequest, res: Response) => {
  const { meetupId } = req.params;
  const { calendarId, source } = req.body; // source: "google" | "apple" | "ics"

  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // Fetch the meetup details
    const { data: meetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .select("*")
      .eq("id", meetupId)
      .single();

    if (meetupErr || !meetup) {
      res.status(404).json({ error: "Meetup not found" });
      return;
    }

    // Fetch participants for the event description / attendees
    const { data: parts } = await getSupabase()
      .from("meetup_participants")
      .select("user_id, rsvp")
      .eq("meetup_id", meetupId);

    const participantUserIds = (parts || []).map((p: any) => p.user_id);
    const { data: partUsers } = participantUserIds.length > 0
      ? await getSupabase().from("users").select("id, display_name, email").in("id", participantUserIds)
      : { data: [] };

    const attendees = (partUsers || []).map((u: any) => ({
      email: u.email,
      displayName: u.display_name,
    }));

    const eventTitle = meetup.title || "Hangout";
    const eventDescription = meetup.description || `Scheduled via Slotted with ${attendees.map((a: any) => a.displayName).join(", ")}`;

    // ─── Google Calendar ───
    if (source === "google") {
      if (!me.google_refresh_token) {
        res.status(400).json({ error: "Google Calendar not connected. Please connect in Settings first." });
        return;
      }

      const oauth2 = await getAuthedCalendarClient(req.uid!);
      if (!oauth2) {
        res.status(400).json({ error: "Could not authenticate with Google" });
        return;
      }

      const calendarApi = google.calendar({ version: "v3", auth: oauth2 });

      const targetCalendar = calendarId || "primary";

      const gcalEvent = await calendarApi.events.insert({
        calendarId: targetCalendar,
        requestBody: {
          summary: eventTitle,
          description: eventDescription,
          location: meetup.location || undefined,
          start: {
            dateTime: meetup.start_time,
            timeZone: me.timezone || "America/New_York",
          },
          end: {
            dateTime: meetup.end_time,
            timeZone: me.timezone || "America/New_York",
          },
          attendees: attendees.filter((a: any) => a.email !== me.email),
          reminders: {
            useDefault: false,
            overrides: [
              { method: "popup", minutes: 60 },
              { method: "popup", minutes: 15 },
            ],
          },
        },
      });

      // Store the Google event ID on the meetup_participant row for reference
      // (google_event_id column may need migration — see migrations/add_google_event_id.sql)
      try {
        await getSupabase()
          .from("meetup_participants")
          .update({ google_event_id: gcalEvent.data.id })
          .eq("meetup_id", meetupId)
          .eq("user_id", me.id);
      } catch {
        // Column may not exist yet — safe to ignore
      }

      res.json({
        success: true,
        source: "google",
        calendarId: targetCalendar,
        eventId: gcalEvent.data.id,
        eventLink: gcalEvent.data.htmlLink,
      });
      return;
    }

    // ─── Apple Calendar (CalDAV) ───
    if (source === "apple") {
      if (!me.apple_calendar_connected || !me.apple_caldav_username || !me.apple_caldav_password) {
        res.status(400).json({ error: "Apple Calendar not connected. Please connect in Settings first." });
        return;
      }

      // Generate ICS content for the CalDAV PUT
      const uid = `slotted-${meetupId}-${me.id}@slotted-ai.web.app`;
      const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const dtStart = new Date(meetup.start_time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const dtEnd = new Date(meetup.end_time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

      const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Slotted//EN",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${eventTitle}`,
        `DESCRIPTION:${eventDescription}`,
        meetup.location ? `LOCATION:${meetup.location}` : "",
        "BEGIN:VALARM",
        "TRIGGER:-PT60M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${eventTitle} in 1 hour`,
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${eventTitle} in 15 minutes`,
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ].filter(Boolean).join("\r\n");

      try {
        const client = await createDAVClient({
          serverUrl: "https://caldav.icloud.com",
          credentials: {
            username: me.apple_caldav_username,
            password: me.apple_caldav_password,
          },
          authMethod: "Basic",
          defaultAccountType: "caldav",
        });

        const targetUrl = calendarId
          ? `${calendarId}${uid}.ics`
          : `https://caldav.icloud.com/${me.apple_caldav_username}/calendars/home/${uid}.ics`;

        await client.createCalendarObject({
          calendar: { url: calendarId || `https://caldav.icloud.com/${me.apple_caldav_username}/calendars/home/` } as DAVCalendar,
          filename: `${uid}.ics`,
          iCalString: icsContent,
        });

        res.json({ success: true, source: "apple", eventId: uid });
        return;
      } catch (appleErr: any) {
        console.error("Apple CalDAV event creation error:", appleErr);
        // Fall through to ICS download if CalDAV fails
      }
    }

    // ─── ICS download fallback ───
    const uid = `slotted-${meetupId}-${me.id}@slotted-ai.web.app`;
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dtStart = new Date(meetup.start_time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dtEnd = new Date(meetup.end_time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Slotted//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${eventTitle}`,
      `DESCRIPTION:${eventDescription}`,
      meetup.location ? `LOCATION:${meetup.location}` : "",
      ...attendees.map((a: any) => `ATTENDEE;CN=${a.displayName}:mailto:${a.email}`),
      "BEGIN:VALARM",
      "TRIGGER:-PT60M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${eventTitle} in 1 hour`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");

    res.json({
      success: true,
      source: "ics",
      icsContent,
      filename: `${eventTitle.replace(/[^a-zA-Z0-9]/g, "_")}.ics`,
    });
  } catch (err: any) {
    console.error("Add to calendar error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Suggestions routes (AI scoring — placeholder logic for now)
// ---------------------------------------------------------------------------

/** GET /suggestions/:friendId — get suggested meeting times */
app.get("/suggestions/:friendId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendId } = req.params;
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // For now, return any logged suggestions from the DB
    const { data: suggestions, error } = await getSupabase()
      .from("suggestion_events")
      .select("*")
      .eq("user_id", me.id)
      .eq("friend_id", friendId)
      .is("outcome", null)
      .order("score", { ascending: false })
      .limit(5);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ suggestions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /suggestions/:suggestionId/act — record user action on suggestion */
app.post("/suggestions/:suggestionId/act", requireAuth, async (req: AuthRequest, res: Response) => {
  const { suggestionId } = req.params;
  const { outcome } = req.body;
  if (!["accepted", "declined", "ignored"].includes(outcome)) {
    res.status(400).json({ error: "Invalid outcome" });
    return;
  }
  try {
    const { data, error } = await getSupabase()
      .from("suggestion_events")
      .update({ outcome, acted_at: new Date().toISOString() })
      .eq("id", suggestionId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Dashboard — aggregated data for the home page
// ---------------------------------------------------------------------------
app.get("/dashboard", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // 1. Get accepted friends
    const { data: friendships } = await getSupabase()
      .from("friendships")
      .select("*, user_a:users!friendships_user_a_id_fkey(id,display_name,photo_url,social_battery,neighborhood,timezone), user_b:users!friendships_user_b_id_fkey(id,display_name,photo_url,social_battery,neighborhood,timezone)")
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
      .eq("status", "accepted");

    const friends = (friendships || []).map((f: any) => {
      const iAmA = f.user_a.id === me.id;
      const friend = iAmA ? f.user_b : f.user_a;
      const friendshipType = iAmA ? (f.user_a_friendship_type || "local") : (f.user_b_friendship_type || "local");
      return {
        id: friend.id,
        displayName: friend.display_name,
        photoUrl: friend.photo_url,
        socialBattery: friend.social_battery,
        neighborhood: friend.neighborhood,
        timezone: friend.timezone,
        friendshipType,
      };
    });

    // 2. Get all meetups this user participated in that are past + confirmed/completed
    const { data: myParticipations } = await getSupabase()
      .from("meetup_participants")
      .select("meetup_id")
      .eq("user_id", me.id);

    const meetupIds = (myParticipations || []).map((p: any) => p.meetup_id);

    let pastMeetups: any[] = [];
    if (meetupIds.length > 0) {
      const { data } = await getSupabase()
        .from("meetups")
        .select("id, start_time, end_time, status")
        .in("id", meetupIds)
        .in("status", ["confirmed", "completed"])
        .lt("end_time", new Date().toISOString())
        .order("start_time", { ascending: false });
      pastMeetups = data || [];
    }

    // 3. For past meetups, get co-participants
    const pastMeetupIds = pastMeetups.map((m: any) => m.id);
    let coParticipants: any[] = [];
    if (pastMeetupIds.length > 0) {
      const { data } = await getSupabase()
        .from("meetup_participants")
        .select("meetup_id, user_id")
        .in("meetup_id", pastMeetupIds)
        .neq("user_id", me.id);
      coParticipants = data || [];
    }

    // 4. For each friend, find most recent shared meetup
    const meetupStartMap = new Map(pastMeetups.map((m: any) => [m.id, m.start_time]));
    const friendLastSeen = new Map<string, string>();
    for (const cp of coParticipants) {
      const existing = friendLastSeen.get(cp.user_id);
      const thisDate = meetupStartMap.get(cp.meetup_id);
      if (thisDate && (!existing || thisDate > existing)) {
        friendLastSeen.set(cp.user_id, thisDate);
      }
    }

    // 5. Build friends-to-see list sorted by longest since last seen
    const friendsToSee = friends.map((f: any) => ({
      ...f,
      lastHangout: friendLastSeen.get(f.id) || null,
    })).sort((a: any, b: any) => {
      // Friends never seen first, then oldest last-seen first
      if (!a.lastHangout && !b.lastHangout) return 0;
      if (!a.lastHangout) return -1;
      if (!b.lastHangout) return 1;
      return new Date(a.lastHangout).getTime() - new Date(b.lastHangout).getTime();
    });

    // 6. Stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const hangoutsThisMonth = pastMeetups.filter((m: any) => m.start_time >= startOfMonth).length;

    res.json({
      friendsToSee,
      stats: {
        totalFriends: friends.length,
        hangoutsThisMonth,
        totalPastHangouts: pastMeetups.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /activity-feed — get activity feed items */
app.get("/activity-feed", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const activities: any[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch user's dismissals from the last 30 days
    const { data: dismissals } = await getSupabase()
      .from("activity_dismissals")
      .select("activity_type, friend_id")
      .eq("user_id", me.id)
      .gte("dismissed_at", thirtyDaysAgo.toISOString());

    const dismissedSet = new Set<string>();
    if (dismissals) {
      dismissals.forEach((d) => {
        // Create a key for this dismissal: "type:friendId" or just "type" if no friend
        dismissedSet.add(d.friend_id ? `${d.activity_type}:${d.friend_id}` : d.activity_type);
      });
    }

    // Helper to check if activity is dismissed
    const isDismissed = (type: string, friendId?: string) => {
      if (friendId && dismissedSet.has(`${type}:${friendId}`)) return true;
      // Also check for type-level dismissals (3+ dismissals of same type = auto-dismiss that type)
      const typeCount = Array.from(dismissedSet).filter(k => k.startsWith(`${type}:`)).length;
      return typeCount >= 3;
    };

    // 1. Get overdue friends (haven't seen in 30+ days)
    const { data: friendships } = await getSupabase()
      .from("friendships")
      .select(`
        id,
        user_a_id,
        user_b_id,
        user_a:users!friendships_user_a_id_fkey(id, display_name, photo_url),
        user_b:users!friendships_user_b_id_fkey(id, display_name, photo_url)
      `)
      .eq("status", "accepted")
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`);

    if (friendships && friendships.length > 0) {
      // For each friend, check last hangout
      const overdueFriends: any[] = [];
      
      for (const f of friendships) {
        const iAmA = f.user_a.id === me.id;
        const friend = iAmA ? f.user_b : f.user_a;

        // Get last meetup with this friend
        const { data: lastMeetup } = await getSupabase()
          .from("meetups")
          .select("start_time")
          .eq("status", "completed")
          .or(`id.in.(
            select meetup_id from meetup_participants where user_id = '${me.id}'
          ),id.in.(
            select meetup_id from meetup_participants where user_id = '${friend.id}'
          )`)
          .order("start_time", { ascending: false })
          .limit(1)
          .single();

        const lastSeen = lastMeetup ? new Date(lastMeetup.start_time) : null;
        
        // Only consider friends "overdue" if we have actual hangout history
        if (!lastSeen) continue; // Skip friends with no recorded hangouts
        
        const daysSinceLastSeen = Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceLastSeen >= 30) {
          overdueFriends.push({
            type: "overdue",
            friend,
            daysSince: daysSinceLastSeen,
            lastSeen: lastSeen.toISOString(),
          });
        }
      }

      // Add top 3 most overdue (excluding dismissed)
      overdueFriends
        .sort((a, b) => b.daysSince - a.daysSince)
        .filter((f) => !isDismissed("overdue_friends", f.friend.id))
        .slice(0, 3)
        .forEach((f) => {
          activities.push({
            type: "overdue_friends",
            priority: 3,
            friendId: f.friend.id,
            friendName: f.friend.display_name,
            friendPhoto: f.friend.photo_url,
            daysSince: f.daysSince,
            message: f.daysSince > 90 
              ? `You haven't seen ${f.friend.display_name} in over 3 months` 
              : `It's been ${f.daysSince} days since you saw ${f.friend.display_name}`,
          });
        });
    }

    // 2. Recent shared hangout activity (last 7 days, friends with share_hangouts=true)
    const { data: recentLogs } = await getSupabase()
      .from("meetup_logs")
      .select(`
        created_at,
        activity_type,
        user:users!meetup_logs_user_id_fkey(id, display_name, photo_url, share_hangouts)
      `)
      .gte("created_at", sevenDaysAgo.toISOString())
      .neq("user_id", me.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentLogs) {
      for (const log of recentLogs) {
        // Only show if user has share_hangouts enabled
        if (!log.user.share_hangouts) continue;

        // Check if this person is my friend
        const { data: friendship } = await getSupabase()
          .from("friendships")
          .select("id")
          .eq("status", "accepted")
          .or(`user_a_id.eq.${me.id} AND user_b_id.eq.${log.user.id},user_a_id.eq.${log.user.id} AND user_b_id.eq.${me.id}`)
          .single();

        if (friendship) {
          // Skip if dismissed
          if (isDismissed("recent_activity", log.user.id)) continue;

          const activityEmoji = {
            coffee: "☕",
            meal: "🍽️",
            drinks: "🍻",
            walk: "🚶",
            workout: "💪",
            movie: "🎬",
            phone_call: "📞",
            facetime: "📱",
            video_call: "💻",
          }[log.activity_type] || "😎";

          activities.push({
            type: "recent_activity",
            priority: 2,
            friendId: log.user.id,
            friendName: log.user.display_name,
            friendPhoto: log.user.photo_url,
            activityType: log.activity_type,
            timestamp: log.created_at,
            message: `${log.user.display_name} logged a ${log.activity_type.replace("_", " ")} ${activityEmoji}`,
          });
        }
      }
    }

    // 3. Friends free this weekend (simple version)
    const dayOfWeek = now.getDay();
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
    const nextSaturday = new Date(now);
    nextSaturday.setDate(now.getDate() + daysUntilSaturday);
    nextSaturday.setHours(9, 0, 0, 0);
    const nextSunday = new Date(nextSaturday);
    nextSunday.setDate(nextSaturday.getDate() + 1);
    nextSunday.setHours(23, 59, 59, 999);

    if (friendships && friendships.length > 0 && daysUntilSaturday <= 3) {
      // Only show if it's Wed-Sat
      const { data: weekendAvail } = await getSupabase()
        .from("availability")
        .select("user_id")
        .eq("status", "free")
        .gte("start_time", nextSaturday.toISOString())
        .lte("end_time", nextSunday.toISOString())
        .in(
          "user_id",
          friendships.map((f) => (f.user_a.id === me.id ? f.user_b.id : f.user_a.id))
        );

      if (weekendAvail && weekendAvail.length > 0) {
        const freeFriendIds = new Set(weekendAvail.map((a) => a.user_id));
        const freeFriends = friendships
          .map((f) => {
            const iAmA = f.user_a.id === me.id;
            return freeFriendIds.has(iAmA ? f.user_b.id : f.user_a.id)
              ? (iAmA ? f.user_b : f.user_a)
              : null;
          })
          .filter(Boolean)
          .slice(0, 2);

        freeFriends.forEach((friend: any) => {
          // Skip if dismissed
          if (isDismissed("free_weekend", friend.id)) return;

          activities.push({
            type: "free_weekend",
            priority: 1,
            friendId: friend.id,
            friendName: friend.display_name,
            friendPhoto: friend.photo_url,
            message: `${friend.display_name} is free this weekend`,
          });
        });
      }
    }

    // Sort by priority (higher first) then timestamp
    activities.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.timestamp && b.timestamp) return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return 0;
    });

    res.json({ activities: activities.slice(0, 10) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /activity-feed/dismiss — dismiss an activity feed item
// ---------------------------------------------------------------------------
app.post("/activity-feed/dismiss", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { activityType, friendId } = req.body;
    if (!activityType || !["overdue_friends", "recent_activity", "free_weekend"].includes(activityType)) {
      res.status(400).json({ error: "Invalid activity type" });
      return;
    }

    // Record the dismissal
    const { error } = await getSupabase()
      .from("activity_dismissals")
      .insert({
        user_id: dbUser.id,
        activity_type: activityType,
        friend_id: friendId || null,
      });

    if (error) {
      console.error("Dismissal insert error:", error);
      res.status(500).json({ error: "Failed to record dismissal" });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Activity dismissal error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Events — search SeatGeek & Ticketmaster, match with friend availability
// ---------------------------------------------------------------------------

const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID || "";
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || "";
const EVENTBRITE_API_KEY = process.env.EVENTBRITE_API_KEY || "";
const MEETUP_API_KEY = process.env.MEETUP_API_KEY || "";
const NYC_OPEN_DATA_APP_TOKEN = process.env.NYC_OPEN_DATA_APP_TOKEN || "";

// Log which APIs are configured at cold-start
console.log(`Event APIs configured — SeatGeek: ${!!SEATGEEK_CLIENT_ID}, Ticketmaster: ${!!TICKETMASTER_API_KEY}, Eventbrite: ${!!EVENTBRITE_API_KEY}`);

interface ExternalEvent {
  id: string;
  source: "seatgeek" | "ticketmaster" | "eventbrite" | "meetup" | "nyc_open_data";
  sources?: string[];          // all sources this event was found on
  title: string;
  type: string;
  venue: string;
  city: string;
  datetime: string;
  datetimeLocal: string;
  url: string;
  urls?: { source: string; url: string }[];  // ticket links from all sources
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
  performers?: string[];
}

/**
 * Normalize a title for fuzzy matching:
 * - lowercase, strip "the", punctuation, extra whitespace
 * - collapse common suffixes like "- new york" or "(broadway)"
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, "")           // strip parenthetical info
    .replace(/[-–—:].*$/g, "")         // strip everything after dash/colon (venue/city suffixes)
    .replace(/\b(the|a|an|at|in|on)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")       // remove punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if two normalized titles are "the same event".
 * Uses exact match after normalization, OR checks if one contains the other
 * (handles "Hamilton" vs "Hamilton: An American Musical").
 */
function titlesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // If one is a substring of the other (at least 6 chars to avoid false positives)
  if (a.length >= 6 && b.includes(a)) return true;
  if (b.length >= 6 && a.includes(b)) return true;
  return false;
}

/**
 * Deduplicate events from multiple sources.
 * Groups by similar title + same date, merges ticket links, keeps best metadata.
 */
function deduplicateEvents(events: ExternalEvent[]): ExternalEvent[] {
  const groups: ExternalEvent[][] = [];

  for (const ev of events) {
    const normTitle = normalizeTitle(ev.title);
    const evDate = ev.datetime?.slice(0, 10) || "";

    // Try to find an existing group this event belongs to
    let matched = false;
    for (const group of groups) {
      const rep = group[0];
      const repNorm = normalizeTitle(rep.title);
      const repDate = rep.datetime?.slice(0, 10) || "";

      // Same date (or within 1 day for timezone edge cases) + similar title
      const dateDiff = Math.abs(new Date(evDate).getTime() - new Date(repDate).getTime());
      const sameDate = dateDiff <= 86400000; // within 24h

      if (sameDate && titlesMatch(normTitle, repNorm)) {
        group.push(ev);
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups.push([ev]);
    }
  }

  // Merge each group into a single event with combined metadata
  return groups.map((group) => {
    // Pick the "best" listing as the primary (prefer one with image, then lowest price)
    const sorted = [...group].sort((a, b) => {
      // Prefer entries with images
      if (a.imageUrl && !b.imageUrl) return -1;
      if (!a.imageUrl && b.imageUrl) return 1;
      // Then prefer lower price
      if ((a.priceMin || Infinity) !== (b.priceMin || Infinity)) {
        return (a.priceMin || Infinity) - (b.priceMin || Infinity);
      }
      // Prefer SeatGeek (usually has better data for live events)
      if (a.source === "seatgeek" && b.source !== "seatgeek") return -1;
      if (a.source !== "seatgeek" && b.source === "seatgeek") return 1;
      return 0;
    });

    const primary = sorted[0];

    // Collect all source URLs
    const urls = group.map((ev) => ({ source: ev.source, url: ev.url }));
    const sources = [...new Set(group.map((ev) => ev.source))];

    // Merge prices — take the lowest min and highest max across sources
    const allMins = group.map((e) => e.priceMin).filter((p): p is number => p !== undefined && p > 0);
    const allMaxes = group.map((e) => e.priceMax).filter((p): p is number => p !== undefined && p > 0);

    // Merge performers — union of all
    const allPerformers = [...new Set(group.flatMap((e) => e.performers || []))];

    // Use best image
    const bestImage = group.find((e) => e.imageUrl)?.imageUrl;

    return {
      ...primary,
      sources,
      urls,
      imageUrl: bestImage || primary.imageUrl,
      priceMin: allMins.length > 0 ? Math.min(...allMins) : undefined,
      priceMax: allMaxes.length > 0 ? Math.max(...allMaxes) : undefined,
      performers: allPerformers.length > 0 ? allPerformers : primary.performers,
    };
  });
}

/** Search SeatGeek for events */
async function searchSeatGeek(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!SEATGEEK_CLIENT_ID) return [];
  try {
    const url = new URL("https://api.seatgeek.com/2/events");
    url.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
    url.searchParams.set("q", params.q);
    url.searchParams.set("per_page", String(params.perPage || 25));
    url.searchParams.set("sort", "score.desc");

    if (params.city) {
      // SeatGeek uses venue.city for location filtering
      url.searchParams.set("venue.city", params.city);
    }
    if (params.type) {
      // Map our types to SeatGeek taxonomy
      const typeMap: Record<string, string> = {
        theater: "theater",
        concert: "concert",
        sports: "sports",
        comedy: "comedy",
        festivals: "festival",
        dance: "dance_performance_tour",
        opera: "theater",
        family: "family",
      };
      const sgType = typeMap[params.type];
      if (sgType) url.searchParams.set("type", sgType);
    }
    if (params.dateFrom) {
      url.searchParams.set("datetime_utc.gte", new Date(params.dateFrom).toISOString());
    }
    if (params.dateTo) {
      url.searchParams.set("datetime_utc.lte", new Date(params.dateTo + "T23:59:59").toISOString());
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("SeatGeek API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    return (data.events || []).map((ev: any) => ({
      id: `sg-${ev.id}`,
      source: "seatgeek" as const,
      title: ev.title || ev.short_title || "",
      type: ev.type || ev.taxonomies?.[0]?.name || "event",
      venue: ev.venue?.name || "",
      city: ev.venue?.city || "",
      datetime: ev.datetime_utc || "",
      datetimeLocal: ev.datetime_local || ev.datetime_utc || "",
      url: ev.url || "",
      imageUrl: ev.performers?.[0]?.image || ev.performers?.[0]?.images?.huge || "",
      priceMin: ev.stats?.lowest_sg_base_price || ev.stats?.lowest_price || undefined,
      priceMax: ev.stats?.highest_price || undefined,
      performers: (ev.performers || []).map((p: any) => p.name).filter(Boolean),
    }));
  } catch (err) {
    console.error("SeatGeek search error:", err);
    return [];
  }
}

/** Search Ticketmaster for events */
async function searchTicketmaster(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!TICKETMASTER_API_KEY) return [];
  try {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.searchParams.set("apikey", TICKETMASTER_API_KEY);
    url.searchParams.set("keyword", params.q);
    url.searchParams.set("size", String(params.perPage || 25));
    url.searchParams.set("sort", "relevance,desc");

    if (params.city) {
      url.searchParams.set("city", params.city);
    }
    if (params.type) {
      // Map our types to Ticketmaster classification
      const classMap: Record<string, string> = {
        theater: "Arts & Theatre",
        concert: "Music",
        sports: "Sports",
        comedy: "Arts & Theatre",
        festivals: "Music",
        dance: "Arts & Theatre",
        opera: "Arts & Theatre",
        family: "Family",
      };
      const cls = classMap[params.type];
      if (cls) url.searchParams.set("classificationName", cls);
    }
    if (params.dateFrom) {
      url.searchParams.set("startDateTime", new Date(params.dateFrom).toISOString().replace(".000Z", "Z"));
    }
    if (params.dateTo) {
      url.searchParams.set("endDateTime", new Date(params.dateTo + "T23:59:59").toISOString().replace(".000Z", "Z"));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("Ticketmaster API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    const events = data._embedded?.events || [];
    return events.map((ev: any) => {
      const venue = ev._embedded?.venues?.[0];
      const prices = ev.priceRanges?.[0];
      const startDate = ev.dates?.start;
      return {
        id: `tm-${ev.id}`,
        source: "ticketmaster" as const,
        title: ev.name || "",
        type: ev.classifications?.[0]?.segment?.name?.toLowerCase() || "event",
        venue: venue?.name || "",
        city: venue?.city?.name || "",
        datetime: startDate?.dateTime || "",
        datetimeLocal: startDate?.localDate
          ? `${startDate.localDate}T${startDate.localTime || "19:00:00"}`
          : startDate?.dateTime || "",
        url: ev.url || "",
        imageUrl: ev.images?.find((img: any) => img.ratio === "16_9" && img.width >= 500)?.url
          || ev.images?.[0]?.url || "",
        priceMin: prices?.min || undefined,
        priceMax: prices?.max || undefined,
        performers: (ev._embedded?.attractions || []).map((a: any) => a.name).filter(Boolean),
      };
    });
  } catch (err) {
    console.error("Ticketmaster search error:", err);
    return [];
  }
}

/** Search Eventbrite for events */
async function searchEventbrite(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!EVENTBRITE_API_KEY) return [];
  try {
    const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
    url.searchParams.set("token", EVENTBRITE_API_KEY);
    url.searchParams.set("q", params.q);
    url.searchParams.set("page_size", String(params.perPage || 25));
    url.searchParams.set("sort_by", "best");
    url.searchParams.set("expand", "venue,ticket_availability");

    if (params.city) {
      url.searchParams.set("location.address", params.city);
      url.searchParams.set("location.within", "30mi");
    }
    if (params.type) {
      const catMap: Record<string, string> = {
        theater: "105",    // Performing & Visual Arts
        concert: "103",    // Music
        sports: "108",     // Sports & Fitness
        comedy: "105",     // Performing & Visual Arts
        festivals: "103",  // Music
        dance: "105",      // Performing & Visual Arts
        opera: "105",      // Performing & Visual Arts
        family: "115",     // Family & Education
        food: "110",       // Food & Drink
        networking: "101", // Business
        community: "113",  // Community & Culture
      };
      const cat = catMap[params.type];
      if (cat) url.searchParams.set("categories", cat);
    }
    if (params.dateFrom) {
      url.searchParams.set("start_date.range_start", new Date(params.dateFrom).toISOString().replace(".000Z", "Z"));
    }
    if (params.dateTo) {
      url.searchParams.set("start_date.range_end", new Date(params.dateTo + "T23:59:59").toISOString().replace(".000Z", "Z"));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("Eventbrite API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    return (data.events || []).map((ev: any) => {
      const venue = ev.venue;
      const isFree = ev.is_free || ev.ticket_availability?.minimum_ticket_price?.major_value === "0";
      return {
        id: `eb-${ev.id}`,
        source: "eventbrite" as const,
        title: ev.name?.text || ev.name?.html || "",
        type: ev.category?.short_name?.toLowerCase() || "event",
        venue: venue?.name || "",
        city: venue?.address?.city || "",
        datetime: ev.start?.utc || "",
        datetimeLocal: ev.start?.local || ev.start?.utc || "",
        url: ev.url || "",
        imageUrl: ev.logo?.url || ev.logo?.original?.url || "",
        priceMin: isFree ? 0 : (ev.ticket_availability?.minimum_ticket_price?.major_value ? parseFloat(ev.ticket_availability.minimum_ticket_price.major_value) : undefined),
        priceMax: ev.ticket_availability?.maximum_ticket_price?.major_value ? parseFloat(ev.ticket_availability.maximum_ticket_price.major_value) : undefined,
        performers: [],
      };
    });
  } catch (err) {
    console.error("Eventbrite search error:", err);
    return [];
  }
}

/** Search Meetup via GraphQL API for events */
async function searchMeetup(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!MEETUP_API_KEY) return [];
  try {
    // Meetup uses a GraphQL API (pro network or open events endpoint)
    const url = new URL("https://api.meetup.com/find/upcoming_events");
    url.searchParams.set("key", MEETUP_API_KEY);
    url.searchParams.set("text", params.q);
    url.searchParams.set("page", String(params.perPage || 25));
    url.searchParams.set("order", "time");

    if (params.city) {
      // Meetup uses lon/lat but also supports text-based location
      url.searchParams.set("lon", "");
      url.searchParams.set("lat", "");
      // Fallback: set the "location" param for text-based city search
      url.searchParams.delete("lon");
      url.searchParams.delete("lat");
      // Use the self_groups endpoint with location or just rely on topic_category + city
      url.searchParams.set("lon", "");
      url.searchParams.delete("lon");
    }

    if (params.type) {
      const topicMap: Record<string, string> = {
        theater: "arts-culture",
        concert: "music",
        sports: "sports-fitness",
        comedy: "arts-culture",
        festivals: "music",
        dance: "dancing",
        food: "food-drink",
        networking: "career-business",
        community: "socializing",
        outdoors: "outdoors-adventure",
        tech: "tech",
      };
      const topic = topicMap[params.type];
      if (topic) url.searchParams.set("topic_category", topic);
    }

    if (params.dateFrom) {
      url.searchParams.set("start_date_range", new Date(params.dateFrom).toISOString());
    }
    if (params.dateTo) {
      url.searchParams.set("end_date_range", new Date(params.dateTo + "T23:59:59").toISOString());
    }

    // Use the open events endpoint as an alternative
    const openUrl = new URL("https://api.meetup.com/find/upcoming_events");
    openUrl.searchParams.set("photo-host", "public");
    openUrl.searchParams.set("page", String(params.perPage || 25));
    openUrl.searchParams.set("text", params.q);
    openUrl.searchParams.set("key", MEETUP_API_KEY);

    const resp = await fetch(openUrl.toString());
    if (!resp.ok) {
      console.error("Meetup API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    const events = data.events || [];
    return events.map((ev: any) => {
      const venue = ev.venue;
      return {
        id: `mu-${ev.id}`,
        source: "meetup" as const,
        title: ev.name || "",
        type: ev.group?.category?.shortname?.toLowerCase() || "meetup",
        venue: venue?.name || ev.group?.name || "",
        city: venue?.city || "",
        datetime: ev.time ? new Date(ev.time).toISOString() : "",
        datetimeLocal: ev.local_date
          ? `${ev.local_date}T${ev.local_time || "19:00:00"}`
          : (ev.time ? new Date(ev.time).toISOString() : ""),
        url: ev.link || ev.event_url || "",
        imageUrl: ev.group?.group_photo?.photo_link || ev.group?.key_photo?.photo_link || "",
        priceMin: ev.fee ? ev.fee.amount : 0,
        priceMax: ev.fee ? ev.fee.amount : undefined,
        performers: ev.group?.name ? [ev.group.name] : [],
      };
    });
  } catch (err) {
    console.error("Meetup search error:", err);
    return [];
  }
}

/** Search NYC Open Data for free city events (parks, libraries, cultural) */
async function searchNYCOpenData(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  // NYC Open Data is free; an app token just raises rate limits
  // Only search if the city is NYC-related or no city filter set
  const nycCities = ["new york", "nyc", "brooklyn", "queens", "bronx", "manhattan", "staten island"];
  if (params.city && !nycCities.some((c) => params.city!.toLowerCase().includes(c))) {
    return []; // Not NYC — skip
  }

  try {
    // NYC Parks Events dataset (Socrata SODA API)
    // Dataset ID: 8x4p-aji6 (NYC Parks Events Listing)
    const url = new URL("https://data.cityofnewyork.us/resource/8x4p-aji6.json");
    if (NYC_OPEN_DATA_APP_TOKEN) {
      url.searchParams.set("$$app_token", NYC_OPEN_DATA_APP_TOKEN);
    }
    url.searchParams.set("$limit", String(params.perPage || 25));
    url.searchParams.set("$order", "startdatetime ASC");

    // Build WHERE clause for filtering
    const where: string[] = [];

    if (params.q) {
      // Full-text search on title and description
      const safeQ = params.q.replace(/'/g, "''");
      where.push(`(upper(title) LIKE '%${safeQ.toUpperCase()}%' OR upper(description) LIKE '%${safeQ.toUpperCase()}%')`);
    }

    const dateFrom = params.dateFrom || new Date().toISOString().split("T")[0];
    where.push(`startdatetime >= '${dateFrom}T00:00:00'`);

    if (params.dateTo) {
      where.push(`startdatetime <= '${params.dateTo}T23:59:59'`);
    }

    if (where.length > 0) {
      url.searchParams.set("$where", where.join(" AND "));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("NYC Open Data API error:", resp.status, await resp.text());
      // Try alternative dataset: NYC events from libraries, cultural orgs
      return await searchNYCOpenDataAlt(params);
    }

    const data = await resp.json();
    const events: ExternalEvent[] = (data || []).map((ev: any) => ({
      id: `nyc-${ev.uid || ev._id || Math.random().toString(36).slice(2)}`,
      source: "nyc_open_data" as const,
      title: ev.title || ev.name || "",
      type: ev.category?.toLowerCase() || ev.subcategory?.toLowerCase() || "free event",
      venue: ev.location || ev.parknames || "",
      city: ev.borough || "New York",
      datetime: ev.startdatetime || ev.start_date_time || "",
      datetimeLocal: ev.startdatetime || ev.start_date_time || "",
      url: ev.link || ev.url || `https://www.nycgovparks.org/events/${ev.uid || ""}`,
      imageUrl: ev.image || "",
      priceMin: 0, // NYC Open Data events are free
      priceMax: 0,
      performers: [],
    }));
    return events;
  } catch (err) {
    console.error("NYC Open Data search error:", err);
    return [];
  }
}

/** Alternative NYC Open Data dataset — cultural events, library events */
async function searchNYCOpenDataAlt(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  try {
    // DOHMH Community Events dataset: bkfu-528j
    const url = new URL("https://data.cityofnewyork.us/resource/bkfu-528j.json");
    if (NYC_OPEN_DATA_APP_TOKEN) {
      url.searchParams.set("$$app_token", NYC_OPEN_DATA_APP_TOKEN);
    }
    url.searchParams.set("$limit", String(params.perPage || 25));

    const where: string[] = [];
    if (params.q) {
      const safeQ = params.q.replace(/'/g, "''");
      where.push(`(upper(event_name) LIKE '%${safeQ.toUpperCase()}%')`);
    }
    const dateFrom = params.dateFrom || new Date().toISOString().split("T")[0];
    where.push(`start_date_time >= '${dateFrom}T00:00:00'`);
    if (params.dateTo) {
      where.push(`start_date_time <= '${params.dateTo}T23:59:59'`);
    }
    if (where.length > 0) {
      url.searchParams.set("$where", where.join(" AND "));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) return [];

    const data = await resp.json();
    return (data || []).map((ev: any) => ({
      id: `nyc-${ev.event_id || Math.random().toString(36).slice(2)}`,
      source: "nyc_open_data" as const,
      title: ev.event_name || ev.name || "",
      type: ev.event_type?.toLowerCase() || "community event",
      venue: ev.event_location || "",
      city: ev.borough || "New York",
      datetime: ev.start_date_time || "",
      datetimeLocal: ev.start_date_time || "",
      url: ev.event_url || "",
      imageUrl: "",
      priceMin: 0,
      priceMax: 0,
      performers: [],
    }));
  } catch (err) {
    console.error("NYC Open Data alt search error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Event autocomplete — fires as user types
// ---------------------------------------------------------------------------
interface SuggestionItem {
  id: string;
  title: string;
  subtitle?: string;
  type: "event" | "performer" | "venue";
  imageUrl?: string;
  source: "seatgeek" | "ticketmaster";
}

async function suggestSeatGeek(q: string, city?: string): Promise<SuggestionItem[]> {
  if (!SEATGEEK_CLIENT_ID || !q) return [];
  try {
    const url = new URL("https://api.seatgeek.com/2/events");
    url.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
    url.searchParams.set("q", q);
    url.searchParams.set("per_page", "8");
    if (city) url.searchParams.set("venue.city", city);
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.events || []).map((ev: any) => ({
      id: `sg-${ev.id}`,
      title: ev.short_title || ev.title || "",
      subtitle: ev.venue?.name
        ? `${ev.venue.name}${ev.venue.city ? ` · ${ev.venue.city}` : ""}`
        : ev.datetime_local
          ? new Date(ev.datetime_local).toLocaleDateString()
          : undefined,
      type: "event" as const,
      imageUrl: ev.performers?.[0]?.image || undefined,
      source: "seatgeek" as const,
    }));
  } catch {
    return [];
  }
}

async function suggestTicketmaster(q: string, city?: string): Promise<SuggestionItem[]> {
  if (!TICKETMASTER_API_KEY || !q) return [];
  try {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/suggest");
    url.searchParams.set("apikey", TICKETMASTER_API_KEY);
    url.searchParams.set("keyword", q);
    if (city) url.searchParams.set("city", city);
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();

    const items: SuggestionItem[] = [];

    // Attractions (performers / shows)
    const attractions = data._embedded?.attractions || [];
    for (const a of attractions.slice(0, 4)) {
      items.push({
        id: `tm-attr-${a.id}`,
        title: a.name,
        subtitle: a.classifications?.[0]?.genre?.name || "Event",
        type: "performer",
        imageUrl: a.images?.[0]?.url,
        source: "ticketmaster",
      });
    }

    // Events
    const events = data._embedded?.events || [];
    for (const ev of events.slice(0, 4)) {
      const venue = ev._embedded?.venues?.[0];
      items.push({
        id: `tm-${ev.id}`,
        title: ev.name,
        subtitle: venue?.name
          ? `${venue.name}${venue.city?.name ? ` · ${venue.city.name}` : ""}`
          : undefined,
        type: "event",
        imageUrl: ev.images?.[0]?.url,
        source: "ticketmaster",
      });
    }

    return items;
  } catch {
    return [];
  }
}

/** GET /events/suggest — autocomplete suggestions as user types */
app.get("/events/suggest", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || "").trim();
    const city = req.query.city as string || undefined;
    if (q.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const [sgItems, tmItems] = await Promise.all([
      suggestSeatGeek(q, city),
      suggestTicketmaster(q, city),
    ]);

    // Merge and deduplicate by title similarity
    const seen = new Set<string>();
    const merged: SuggestionItem[] = [];
    for (const item of [...sgItems, ...tmItems]) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }

    res.json({ suggestions: merged.slice(0, 10) });
  } catch (err: any) {
    console.error("Event suggest error:", err);
    res.json({ suggestions: [] });
  }
});

// ---------------------------------------------------------------------------
// Event discover — browse local events by category
// ---------------------------------------------------------------------------

/** GET /events/discover — browse local popular events by category */
app.get("/events/discover", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const city = req.query.city as string || "";
    const type = req.query.type as string || "";
    const page = parseInt(req.query.page as string || "1", 10);
    const perPage = Math.min(parseInt(req.query.perPage as string || "20", 10), 50);

    if (!city) {
      // Try to get city from user profile
      const me = await getDbUser(req.uid!);
      const userCity = me?.event_city || me?.neighborhood || "";
      if (!userCity) {
        res.json({ events: [], message: "Set your city in Settings to discover local events." });
        return;
      }
      req.query.city = userCity;
    }

    const effectiveCity = (req.query.city as string) || city;

    // Search all APIs for upcoming events in the city (no keyword required)
    const dateFrom = new Date().toISOString().split("T")[0];
    const dateTo = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]; // Next 30 days

    const searchParams = { q: type || effectiveCity, city: effectiveCity, type, dateFrom, dateTo, perPage };
    const [sgEvents, tmEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
      searchSeatGeek(searchParams),
      searchTicketmaster(searchParams),
      searchEventbrite(searchParams),
      searchMeetup(searchParams),
      searchNYCOpenData(searchParams),
    ]);

    const allEvents = [...sgEvents, ...tmEvents, ...ebEvents, ...muEvents, ...nycEvents];
    allEvents.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    // Deduplicate across sources (e.g. Hamilton on both SeatGeek & Ticketmaster)
    const unique = deduplicateEvents(allEvents);

    // Paginate
    const start = (page - 1) * perPage;
    const paginated = unique.slice(start, start + perPage);

    res.json({
      events: paginated,
      total: unique.length,
      page,
      perPage,
      city: effectiveCity,
      sources: {
        seatgeek: sgEvents.length,
        ticketmaster: tmEvents.length,
        eventbrite: ebEvents.length,
        meetup: muEvents.length,
        nyc_open_data: nycEvents.length,
      },
    });
  } catch (err: any) {
    console.error("Event discover error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /events/search — search external event APIs */
app.get("/events/search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { q, city, type, dateFrom, dateTo } = req.query as Record<string, string>;
    if (!q?.trim()) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }

    // Search all APIs in parallel
    const [sgEvents, tmEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
      searchSeatGeek({ q, city, type, dateFrom, dateTo }),
      searchTicketmaster({ q, city, type, dateFrom, dateTo }),
      searchEventbrite({ q, city, type, dateFrom, dateTo }),
      searchMeetup({ q, city, type, dateFrom, dateTo }),
      searchNYCOpenData({ q, city, type, dateFrom, dateTo }),
    ]);

    // Merge and deduplicate across sources
    const allEvents = [...sgEvents, ...tmEvents, ...ebEvents, ...muEvents, ...nycEvents];
    allEvents.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    const dedupedEvents = deduplicateEvents(allEvents);

    res.json({
      events: dedupedEvents,
      sources: {
        seatgeek: sgEvents.length,
        ticketmaster: tmEvents.length,
        eventbrite: ebEvents.length,
        meetup: muEvents.length,
        nyc_open_data: nycEvents.length,
      },
    });
  } catch (err: any) {
    console.error("Event search error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /events/match — search events AND cross-reference with friends' availability */
app.post("/events/match", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { query: q, friendIds, city, type, dateFrom, dateTo } = req.body;
    if (!q?.trim()) {
      res.status(400).json({ error: "Query is required" });
      return;
    }
    if (!Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "friendIds must be a non-empty array" });
      return;
    }

    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // 1. Search events from all sources
    const [sgEvents, tmEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
      searchSeatGeek({ q, city, type, dateFrom, dateTo }),
      searchTicketmaster({ q, city, type, dateFrom, dateTo }),
      searchEventbrite({ q, city, type, dateFrom, dateTo }),
      searchMeetup({ q, city, type, dateFrom, dateTo }),
      searchNYCOpenData({ q, city, type, dateFrom, dateTo }),
    ]);
    const allEvents = [...sgEvents, ...tmEvents, ...ebEvents, ...muEvents, ...nycEvents];
    allEvents.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    const dedupedEvents = deduplicateEvents(allEvents);

    // 2. Sync calendars for all participants
    const friendUsers = await Promise.all(friendIds.map((fid: string) => getDbUserById(fid)));
    const allUids = [
      req.uid!,
      ...friendUsers.map((u) => u?.firebase_uid).filter(Boolean) as string[],
    ];
    await Promise.allSettled(allUids.map((uid) => syncUserCalendar(uid)));

    // 3. Fetch free slots for all participants
    const now = new Date().toISOString();
    const sb = getSupabase();
    const allUserIds = [me.id, ...friendIds];
    const allProfiles = [me, ...friendUsers];
    const slotsByUser = await Promise.all(
      allUserIds.map((uid, idx) =>
        sb
          .from("availability")
          .select("start_time, end_time")
          .eq("user_id", uid)
          .eq("status", "free")
          .gte("end_time", now)
          .order("start_time")
          .then((r) => {
            const buffer = allProfiles[idx]?.travel_buffer_min || 0;
            return applyTravelBuffer(r.data || [], buffer);
          }),
      ),
    );

    // 4. For each event, check if its time falls within everyone's free slots
    const matches: (ExternalEvent & { availabilityScore: number; note: string })[] = [];

    for (const ev of dedupedEvents) {
      if (!ev.datetime) continue;
      const eventStart = new Date(ev.datetime);
      const eventEnd = new Date(eventStart.getTime() + 3 * 3600000); // Assume ~3hr event

      let freeCount = 0;
      const freeNames: string[] = [];
      const busyNames: string[] = [];

      for (let i = 0; i < allUserIds.length; i++) {
        const userSlots = slotsByUser[i];
        const name = i === 0 ? "You" : (allProfiles[i]?.display_name?.split(" ")[0] || "Friend");
        let isFree = false;
        for (const slot of userSlots) {
          const slotStart = new Date(slot.start_time).getTime();
          const slotEnd = new Date(slot.end_time).getTime();
          // Check if event fits within this free slot (at least 2hr overlap)
          const overlapStart = Math.max(eventStart.getTime(), slotStart);
          const overlapEnd = Math.min(eventEnd.getTime(), slotEnd);
          if (overlapEnd - overlapStart >= 2 * 3600000) {
            isFree = true;
            break;
          }
        }
        if (isFree) {
          freeCount++;
          freeNames.push(name);
        } else {
          busyNames.push(name);
        }
      }

      if (freeCount === 0) continue; // No one is free, skip

      const score = Math.round((freeCount / allUserIds.length) * 100);
      let note = "";
      if (freeCount === allUserIds.length) {
        note = `Everyone is free! ${freeNames.join(", ")} can all make it.`;
      } else {
        note = `${freeNames.join(", ")} ${freeNames.length === 1 ? "is" : "are"} free. ${busyNames.join(", ")} may be busy.`;
      }

      matches.push({ ...ev, availabilityScore: score, note });
    }

    // Sort matches by score (best first), then by date
    matches.sort((a, b) => b.availabilityScore - a.availabilityScore || new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    const message = matches.length > 0
      ? `Found ${matches.length} showtime${matches.length !== 1 ? "s" : ""} that work for ${freeCount(matches)} of your group.`
      : "No showtimes match everyone's availability. Try expanding the date range.";

    res.json({
      events: dedupedEvents,
      matches,
      message,
      sources: {
        seatgeek: sgEvents.length,
        ticketmaster: tmEvents.length,
      },
    });
  } catch (err: any) {
    console.error("Event match error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Helper for match message */
function freeCount(matches: { availabilityScore: number }[]) {
  const best = matches[0]?.availabilityScore || 0;
  return best >= 100 ? "everyone" : "some";
}

// ---------------------------------------------------------------------------
// Saved Events — bookmark events for later
// ---------------------------------------------------------------------------

/** POST /events/save — save/bookmark an event */
app.post("/events/save", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { event, status } = req.body;
    if (!event?.id || !event?.source || !event?.title || !event?.url) {
      res.status(400).json({ error: "Missing required event fields (id, source, title, url)" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("saved_events")
      .upsert(
        {
          user_id: me.id,
          external_id: event.id,
          source: event.source,
          title: event.title,
          event_type: event.type || null,
          venue: event.venue || null,
          city: event.city || null,
          datetime_utc: event.datetime || new Date().toISOString(),
          datetime_local: event.datetimeLocal || null,
          url: event.url,
          image_url: event.imageUrl || null,
          price_min: event.priceMin || null,
          price_max: event.priceMax || null,
          performers: event.performers || [],
          status: status || "saved",
        },
        { onConflict: "user_id,external_id,source" },
      )
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /events/saved — get user's saved events */
app.get("/events/saved", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const status = req.query.status as string || undefined;
    let query = getSupabase()
      .from("saved_events")
      .select("*")
      .eq("user_id", me.id)
      .order("datetime_utc", { ascending: true });

    if (status) {
      query = query.eq("status", status);
    } else {
      query = query.neq("status", "dismissed");
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ events: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /events/saved/:id — remove a saved event */
app.delete("/events/saved/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { error } = await getSupabase()
      .from("saved_events")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", me.id);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /events/saved/:id — update status of a saved event */
app.patch("/events/saved/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { status, notes } = req.body;
    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("saved_events")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", me.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /events/invite — invite friends to a saved event */
app.post("/events/invite", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { savedEventId, friendIds } = req.body;
    if (!savedEventId || !Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "savedEventId and friendIds are required" });
      return;
    }

    // Verify the saved event belongs to this user
    const { data: savedEvent } = await getSupabase()
      .from("saved_events")
      .select("*")
      .eq("id", savedEventId)
      .eq("user_id", me.id)
      .single();

    if (!savedEvent) {
      res.status(404).json({ error: "Saved event not found" });
      return;
    }

    // Create invites and notifications
    const results = [];
    for (const friendId of friendIds) {
      const { data: invite, error } = await getSupabase()
        .from("event_invites")
        .upsert(
          {
            saved_event_id: savedEventId,
            invited_by: me.id,
            invited_user_id: friendId,
          },
          { onConflict: "saved_event_id,invited_user_id" },
        )
        .select()
        .single();

      if (!error && invite) {
        results.push(invite);
        // Send notification
        await createNotification({
          userId: friendId,
          type: "meetup_request",
          title: `${me.display_name || "A friend"} wants to go to ${savedEvent.title}!`,
          body: `You've been invited to ${savedEvent.title} on ${new Date(savedEvent.datetime_utc).toLocaleDateString()}. Check it out!`,
          relatedUserId: me.id,
          relatedId: savedEventId,
        });
      }
    }

    res.json({ invites: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /events/invites — get event invites received by the current user */
app.get("/events/invites", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { data, error } = await getSupabase()
      .from("event_invites")
      .select(`
        *,
        saved_event:saved_event_id (
          title, venue, city, datetime_utc, datetime_local, url, image_url, 
          price_min, price_max, event_type, source, performers
        ),
        inviter:invited_by (display_name, photo_url)
      `)
      .eq("invited_user_id", me.id)
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ invites: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /events/invites/:id — respond to an event invite */
app.patch("/events/invites/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { rsvp } = req.body;
    if (!["interested", "going", "declined"].includes(rsvp)) {
      res.status(400).json({ error: "Invalid RSVP value" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("event_invites")
      .update({ rsvp })
      .eq("id", req.params.id)
      .eq("invited_user_id", me.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Feedback — sends user feedback to developer
// ---------------------------------------------------------------------------
app.post("/feedback", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const firebaseUser = await admin.auth().getUser(req.uid!);
    const feedbackEntry = {
      firebase_uid: req.uid,
      email: firebaseUser.email ?? "unknown",
      display_name: firebaseUser.displayName ?? "unknown",
      message: message.trim(),
      created_at: new Date().toISOString(),
    };

    // Store in Supabase
    const { error } = await getSupabase()
      .from("feedback")
      .insert(feedbackEntry);

    if (error) {
      console.error("Failed to store feedback in Supabase:", error);
      // Still log it even if DB insert fails
    }

    // Always log so it's visible in Cloud Functions logs
    console.log("📬 USER FEEDBACK:", JSON.stringify(feedbackEntry));

    res.json({ success: true });
  } catch (err) {
    console.error("Feedback error:", err);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// ---------------------------------------------------------------------------
// POST /meetup-logs — Log a meetup for progressive profiling
// ---------------------------------------------------------------------------
app.post("/meetup-logs", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { friend_id, activity_type, duration_min, day_of_week, time_of_day, notice_days, was_spontaneous, rating } = req.body;

    const { data, error } = await getSupabase()
      .from("meetup_logs")
      .insert({
        user_id: dbUser.id,
        friend_id: friend_id || null,
        activity_type: activity_type || "other",
        duration_min: duration_min || null,
        day_of_week: day_of_week ?? new Date().getDay(),
        time_of_day: time_of_day || "afternoon",
        notice_days: notice_days || null,
        was_spontaneous: was_spontaneous || false,
        rating: rating || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Recompute learned preferences after each log
    await recomputePreferences(dbUser.id);

    console.log("📝 Meetup logged:", data.id);
    res.status(201).json(data);
  } catch (err) {
    console.error("Meetup log error:", err);
    res.status(500).json({ error: "Failed to log meetup" });
  }
});

// ---------------------------------------------------------------------------
// GET /meetup-logs — Get all meetup logs for current user
// ---------------------------------------------------------------------------
app.get("/meetup-logs", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("meetup_logs")
      .select("*")
      .eq("user_id", dbUser.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Meetup logs fetch error:", err);
    res.status(500).json({ error: "Failed to fetch meetup logs" });
  }
});

// ---------------------------------------------------------------------------
// GET /preferences/learned — Get learned preferences for current user
// ---------------------------------------------------------------------------
app.get("/preferences/learned", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("user_preferences")
      .select("*")
      .eq("user_id", dbUser.id)
      .single();

    if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
    res.json(data || { total_meetups_logged: 0 });
  } catch (err) {
    console.error("Preferences fetch error:", err);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

/** Recompute learned preferences from meetup_logs */
async function recomputePreferences(userId: string) {
  const supabase = getSupabase();

  const { data: logs } = await supabase
    .from("meetup_logs")
    .select("*")
    .eq("user_id", userId);

  if (!logs || logs.length === 0) return;

  // Count activity types
  const activityCounts: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;
  const timeCounts: Record<string, number> = {};
  const dayCounts: Record<number, number> = {};
  let spontaneousCount = 0;

  for (const log of logs) {
    activityCounts[log.activity_type] = (activityCounts[log.activity_type] || 0) + 1;
    if (log.duration_min) {
      totalDuration += log.duration_min;
      durationCount++;
    }
    timeCounts[log.time_of_day] = (timeCounts[log.time_of_day] || 0) + 1;
    dayCounts[log.day_of_week] = (dayCounts[log.day_of_week] || 0) + 1;
    if (log.was_spontaneous) spontaneousCount++;
  }

  const topActivity = Object.entries(activityCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : null;
  const topTime = Object.entries(timeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const spontaneousRatio = spontaneousCount / logs.length;
  const planningStyle = spontaneousRatio > 0.6 ? "spontaneous" : spontaneousRatio < 0.3 ? "planner" : "mixed";

  await supabase
    .from("user_preferences")
    .upsert({
      user_id: userId,
      preferred_activity: topActivity || null,
      avg_duration_min: avgDuration,
      preferred_time: topTime || null,
      preferred_day: topDay !== undefined ? dayNames[Number(topDay)] : null,
      planning_style: planningStyle,
      total_meetups_logged: logs.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
}

// ---------------------------------------------------------------------------
// Google Calendar OAuth helpers
// ---------------------------------------------------------------------------
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:5173/api/calendar/callback",
  );
}

/** Build an authenticated OAuth2 client for a user who has stored tokens */
async function getAuthedCalendarClient(firebaseUid: string) {
  const user = await getDbUser(firebaseUid);
  if (!user?.google_refresh_token) return null;

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: user.google_access_token,
    refresh_token: user.google_refresh_token,
    expiry_date: user.google_token_expires_at
      ? new Date(user.google_token_expires_at).getTime()
      : undefined,
  });

  // Auto-refresh: listen for new tokens and persist them
  oauth2.on("tokens", async (tokens) => {
    const updates: Record<string, unknown> = {};
    if (tokens.access_token) updates.google_access_token = tokens.access_token;
    if (tokens.refresh_token) updates.google_refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) {
      updates.google_token_expires_at = new Date(tokens.expiry_date).toISOString();
    }

    if (Object.keys(updates).length) {
      await getSupabase()
        .from("users")
        .update(updates)
        .eq("firebase_uid", firebaseUid);
    }
  });

  return oauth2;
}

// ---------------------------------------------------------------------------
// Google Calendar OAuth routes
// ---------------------------------------------------------------------------

/** GET /calendar/auth-url — generate the OAuth URL so the client can redirect */
app.get("/calendar/auth-url", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const oauth2 = getOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      state: req.uid, // pass Firebase UID so the callback can associate the tokens
    });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/callback — exchange the OAuth code for tokens */
app.get("/calendar/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string; // Firebase UID
  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }
  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    // Store tokens in the users table
    const updates: Record<string, unknown> = {
      google_access_token: tokens.access_token,
      google_refresh_token: tokens.refresh_token,
      google_token_expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    };

    await getSupabase()
      .from("users")
      .update(updates)
      .eq("firebase_uid", state);

    // After storing tokens, auto-fetch the user's calendar list and store defaults
    oauth2.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const calListRes = await calendar.calendarList.list();
    const calendars = calListRes.data.items || [];

    const dbUser = await getDbUser(state);
    if (dbUser) {
      for (const cal of calendars) {
        const { data: existing } = await getSupabase()
          .from("user_calendars")
          .select("calendar_id")
          .eq("user_id", dbUser.id)
          .eq("calendar_id", cal.id!)
          .single();

        if (existing) {
          // Calendar already known — update metadata only, keep is_selected
          await getSupabase()
            .from("user_calendars")
            .update({
              calendar_name: cal.summary || cal.id!,
              calendar_color: cal.backgroundColor || null,
              access_role: cal.accessRole || null,
            })
            .eq("user_id", dbUser.id)
            .eq("calendar_id", cal.id!);
        } else {
          // New calendar — insert with default selection
          await getSupabase()
            .from("user_calendars")
            .insert({
              user_id: dbUser.id,
              calendar_id: cal.id!,
              calendar_name: cal.summary || cal.id!,
              calendar_color: cal.backgroundColor || null,
              is_selected: cal.accessRole === "owner",
              access_role: cal.accessRole || null,
              source: "google",
            });
        }
      }
    }

    // Redirect back to the frontend settings page
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontendUrl}/settings?calendar=connected`);
  } catch (err: any) {
    console.error("Calendar OAuth callback error:", err);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontendUrl}/settings?calendar=error`);
  }
});

/** GET /calendar/status — check if user has connected their calendar (Google and/or Apple) */
app.get("/calendar/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getDbUser(req.uid!);
    const googleConnected = !!(user?.google_refresh_token);
    const appleConnected = !!(user?.apple_calendar_connected && user?.apple_caldav_username);
    res.json({
      connected: googleConnected || appleConnected,
      google: googleConnected,
      apple: appleConnected,
      appleUsername: user?.apple_caldav_username || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /calendar/disconnect — remove stored Google tokens */
app.post("/calendar/disconnect", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await getSupabase()
      .from("users")
      .update({
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: null,
      })
      .eq("firebase_uid", req.uid!);

    // Only remove Google calendars (not Apple)
    const dbUser = await getDbUser(req.uid!);
    if (dbUser) {
      await getSupabase()
        .from("user_calendars")
        .delete()
        .eq("user_id", dbUser.id)
        .eq("source", "google");
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Apple Calendar (CalDAV / iCloud) helpers
// ---------------------------------------------------------------------------

/** Create an authenticated CalDAV client for iCloud */
async function createAppleCalDAVClient(username: string, password: string) {
  const client = await createDAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: {
      username,
      password,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  return client;
}

/** Fetch calendars from iCloud CalDAV */
async function fetchAppleCalendars(username: string, password: string): Promise<DAVCalendar[]> {
  const client = await createAppleCalDAVClient(username, password);
  const calendars = await client.fetchCalendars();
  return calendars;
}

/** Parse iCalendar VEVENT data to extract events with details (title, location, allDay) */
function parseICalEventsWithDetails(
  icalData: string,
  timeMin: Date,
  timeMax: Date,
): { start: Date; end: Date; title: string; location: string | null; allDay: boolean }[] {
  const events: { start: Date; end: Date; title: string; location: string | null; allDay: boolean }[] = [];

  const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;

  while ((match = veventRegex.exec(icalData)) !== null) {
    const block = match[1];
    if (/STATUS:CANCELLED/i.test(block)) continue;
    if (/TRANSP:TRANSPARENT/i.test(block)) continue;

    const dtStartMatch = block.match(/DTSTART[^:]*:(\d{8}T?\d{0,6}Z?)/);
    const dtEndMatch = block.match(/DTEND[^:]*:(\d{8}T?\d{0,6}Z?)/);
    if (!dtStartMatch) continue;

    const summaryMatch = block.match(/SUMMARY[^:]*:(.*)/);
    const locationMatch = block.match(/LOCATION[^:]*:(.*)/);
    const title = summaryMatch?.[1]?.trim() || "Busy";
    const location = locationMatch?.[1]?.trim() || null;

    const startStr = dtStartMatch[1];
    const endStr = dtEndMatch?.[1];
    let startDt: Date;
    let endDt: Date;
    let allDay = false;

    if (startStr.length === 8) {
      allDay = true;
      startDt = new Date(`${startStr.slice(0, 4)}-${startStr.slice(4, 6)}-${startStr.slice(6, 8)}T00:00:00Z`);
      if (endStr && endStr.length === 8) {
        endDt = new Date(`${endStr.slice(0, 4)}-${endStr.slice(4, 6)}-${endStr.slice(6, 8)}T00:00:00Z`);
      } else {
        endDt = new Date(startDt.getTime() + 24 * 60 * 60 * 1000);
      }
    } else {
      startDt = parseICalDateTime(startStr);
      endDt = endStr ? parseICalDateTime(endStr) : new Date(startDt.getTime() + 60 * 60 * 1000);
    }

    if (endDt <= timeMin || startDt >= timeMax) continue;
    if (startDt >= endDt) continue;

    events.push({ start: startDt, end: endDt, title, location, allDay });
  }

  return events;
}

/** Parse iCalendar VEVENT data to extract busy blocks */
function parseICalEvents(icalData: string, timeMin: Date, timeMax: Date): { start: Date; end: Date }[] {
  const events: { start: Date; end: Date }[] = [];

  // Split into VEVENT blocks
  const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;

  while ((match = veventRegex.exec(icalData)) !== null) {
    const block = match[1];

    // Skip cancelled events
    if (/STATUS:CANCELLED/i.test(block)) continue;
    // Skip transparent (free) events
    if (/TRANSP:TRANSPARENT/i.test(block)) continue;

    // Extract DTSTART and DTEND
    const dtStartMatch = block.match(/DTSTART[^:]*:(\d{8}T?\d{0,6}Z?)/);
    const dtEndMatch = block.match(/DTEND[^:]*:(\d{8}T?\d{0,6}Z?)/);

    if (!dtStartMatch) continue;

    const startStr = dtStartMatch[1];
    const endStr = dtEndMatch?.[1];

    let startDt: Date;
    let endDt: Date;

    if (startStr.length === 8) {
      // All-day event: YYYYMMDD
      startDt = new Date(`${startStr.slice(0, 4)}-${startStr.slice(4, 6)}-${startStr.slice(6, 8)}T00:00:00Z`);
      if (endStr && endStr.length === 8) {
        endDt = new Date(`${endStr.slice(0, 4)}-${endStr.slice(4, 6)}-${endStr.slice(6, 8)}T00:00:00Z`);
      } else {
        // Default: 1-day event
        endDt = new Date(startDt.getTime() + 24 * 60 * 60 * 1000);
      }
    } else {
      // Date-time: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
      startDt = parseICalDateTime(startStr);
      endDt = endStr ? parseICalDateTime(endStr) : new Date(startDt.getTime() + 60 * 60 * 1000);
    }

    // Filter to events within our sync window
    if (endDt <= timeMin || startDt >= timeMax) continue;
    if (startDt >= endDt) continue;

    events.push({ start: startDt, end: endDt });
  }

  return events;
}

/** Parse iCal date-time string (YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss) to Date */
function parseICalDateTime(dtStr: string): Date {
  const year = dtStr.slice(0, 4);
  const month = dtStr.slice(4, 6);
  const day = dtStr.slice(6, 8);
  const hour = dtStr.slice(9, 11) || "00";
  const min = dtStr.slice(11, 13) || "00";
  const sec = dtStr.slice(13, 15) || "00";
  const isUtc = dtStr.endsWith("Z");

  const dateStr = `${year}-${month}-${day}T${hour}:${min}:${sec}${isUtc ? "Z" : ""}`;
  return new Date(dateStr);
}

/**
 * Sync Apple Calendar events → busy blocks for the sync engine.
 * Returns busy blocks from all selected Apple calendars.
 */
async function fetchAppleBusyBlocks(
  username: string,
  password: string,
  calendarUrls: string[],
  timeMin: Date,
  timeMax: Date,
): Promise<{ start: string; end: string }[]> {
  const client = await createAppleCalDAVClient(username, password);
  const allBusyBlocks: { start: string; end: string }[] = [];

  for (const calUrl of calendarUrls) {
    try {
      const objects: DAVObject[] = await client.fetchCalendarObjects({
        calendar: { url: calUrl } as DAVCalendar,
        timeRange: {
          start: timeMin.toISOString(),
          end: timeMax.toISOString(),
        },
      });

      for (const obj of objects) {
        if (!obj.data) continue;
        const events = parseICalEvents(obj.data, timeMin, timeMax);
        for (const ev of events) {
          allBusyBlocks.push({
            start: ev.start.toISOString(),
            end: ev.end.toISOString(),
          });
        }
      }
    } catch (err) {
      console.error(`Failed to fetch Apple calendar ${calUrl}:`, err);
    }
  }

  return allBusyBlocks;
}

// ---------------------------------------------------------------------------
// Apple Calendar routes
// ---------------------------------------------------------------------------

/** POST /calendar/apple/connect — connect Apple Calendar via app-specific password */
app.post("/calendar/apple/connect", requireAuth, async (req: AuthRequest, res: Response) => {
  const { username, password } = req.body;
  console.log("Apple Calendar connection attempt for user:", req.uid, "username:", username);
  
  if (!username || !password) {
    res.status(400).json({ error: "Apple ID email and app-specific password are required" });
    return;
  }

  try {
    console.log("Attempting to fetch Apple calendars...");
    // Validate credentials by attempting to connect
    const calendars = await fetchAppleCalendars(username, password);
    console.log("Successfully fetched calendars, count:", calendars?.length);

    if (!calendars || calendars.length === 0) {
      res.status(400).json({ error: "Could not find any calendars. Please check your credentials." });
      return;
    }

    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Store credentials
    await getSupabase()
      .from("users")
      .update({
        apple_caldav_username: username,
        apple_caldav_password: password,
        apple_calendar_connected: true,
      })
      .eq("firebase_uid", req.uid!);

    // Store discovered calendars
    const rows = calendars.map((cal) => ({
      user_id: dbUser.id,
      calendar_id: cal.url,
      calendar_name: cal.displayName || cal.url.split("/").filter(Boolean).pop() || "Apple Calendar",
      calendar_color: null,
      is_selected: true, // default-select all Apple calendars
      access_role: "owner",
      source: "apple",
    }));

    if (rows.length) {
      await getSupabase()
        .from("user_calendars")
        .upsert(rows, { onConflict: "user_id,calendar_id" });
    }

    res.json({
      success: true,
      calendarsFound: calendars.length,
      calendars: rows.map((r) => ({
        calendar_id: r.calendar_id,
        calendar_name: r.calendar_name,
        is_selected: r.is_selected,
        source: r.source,
      })),
    });
  } catch (err: any) {
    // Detailed error logging for debugging
    console.error("Apple Calendar connect error - Full details:");
    console.error("Error type:", err?.constructor?.name);
    console.error("Error message:", err?.message);
    console.error("Error code:", err?.code);
    console.error("Error status:", err?.status || err?.statusCode);
    console.error("Error stack:", err?.stack?.substring(0, 500));
    console.error("Full error object:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2).substring(0, 1000));
    
    if (
      err.message?.includes("401") ||
      err.message?.includes("Unauthorized") ||
      err.message?.includes("credentials") ||
      err.message?.includes("cannot find homeUrl") ||
      err.message?.includes("homeUrl") ||
      err.message?.includes("Invalid credentials")
    ) {
      res.status(401).json({
        error: "Could not connect. Please check: (1) Use your Apple ID email — this may differ from your Gmail. (2) Use an app-specific password from appleid.apple.com, not your regular Apple password.",
      });
    } else {
      res.status(500).json({ error: "Failed to connect Apple Calendar: " + (err.message || "Unknown error") });
    }
  }
});

/** GET /calendar/apple/status — check if Apple Calendar is connected */
app.get("/calendar/apple/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getDbUser(req.uid!);
    res.json({
      connected: !!(user?.apple_calendar_connected && user?.apple_caldav_username),
      username: user?.apple_caldav_username || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /calendar/apple/disconnect — remove stored Apple Calendar credentials */
app.post("/calendar/apple/disconnect", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await getSupabase()
      .from("users")
      .update({
        apple_caldav_username: null,
        apple_caldav_password: null,
        apple_calendar_connected: false,
      })
      .eq("firebase_uid", req.uid!);

    // Remove Apple calendars
    const dbUser = await getDbUser(req.uid!);
    if (dbUser) {
      await getSupabase()
        .from("user_calendars")
        .delete()
        .eq("user_id", dbUser.id)
        .eq("source", "apple");
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/apple/list — refresh Apple Calendar list */
app.get("/calendar/apple/list", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    console.log("Fetching Apple calendars for user:", req.uid);
    const user = await getDbUser(req.uid!);
    console.log("User found:", !!user, "Apple connected:", !!user?.apple_calendar_connected, "Has username:", !!user?.apple_caldav_username, "Has password:", !!user?.apple_caldav_password);
    
    if (!user?.apple_caldav_username || !user?.apple_caldav_password) {
      console.error("Apple Calendar credentials missing for user:", req.uid);
      res.status(400).json({ error: "Apple Calendar not connected. Please reconnect in Settings." });
      return;
    }

    console.log("Fetching calendars from Apple CalDAV...");
    const calendars = await fetchAppleCalendars(user.apple_caldav_username, user.apple_caldav_password);
    console.log("Found", calendars.length, "Apple calendars");

    // Upsert fresh calendar metadata
    const rows = calendars.map((cal) => ({
      user_id: user.id,
      calendar_id: cal.url,
      calendar_name: cal.displayName || cal.url.split("/").filter(Boolean).pop() || "Apple Calendar",
      calendar_color: null,
      access_role: "owner",
      source: "apple",
    }));

    if (rows.length) {
      const { error: upsertError } = await getSupabase()
        .from("user_calendars")
        .upsert(rows, { onConflict: "user_id,calendar_id" });
      
      if (upsertError) {
        console.error("Failed to upsert Apple calendars:", upsertError);
      } else {
        console.log("Successfully upserted", rows.length, "Apple calendars");
      }
    }

    // Return stored rows (which include is_selected)
    const { data: stored, error: selectError } = await getSupabase()
      .from("user_calendars")
      .select("*")
      .eq("user_id", user.id)
      .eq("source", "apple")
      .order("calendar_name");

    if (selectError) {
      console.error("Failed to fetch stored Apple calendars:", selectError);
    }

    console.log("Returning", stored?.length || 0, "stored Apple calendars");
    res.json({ calendars: stored || [] });
  } catch (err: any) {
    console.error("Apple calendar list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Combined calendar events endpoint
// ---------------------------------------------------------------------------

/** GET /calendar/events — fetch merged events from Google + Apple calendars */
app.get("/calendar/events", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const now = new Date();
    // Default: 2 weeks ahead, allow query params to override
    const daysAhead = parseInt(req.query.days as string) || 14;
    const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    interface CalEvent {
      id: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      location: string | null;
      source: "google" | "apple";
      calendarName: string;
      color: string | null;
    }

    const allEvents: CalEvent[] = [];
    const sb = getSupabase();

    // --- Google Calendar events ---
    const hasGoogle = !!dbUser.google_refresh_token;
    console.log("Calendar events - hasGoogle:", hasGoogle, "hasApple:", !!(dbUser.apple_calendar_connected && dbUser.apple_caldav_username));
    if (hasGoogle) {
      try {
        const oauth2 = await getAuthedCalendarClient(req.uid!);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });

          const { data: selectedGoogleCals } = await sb
            .from("user_calendars")
            .select("calendar_id, calendar_name, calendar_color")
            .eq("user_id", dbUser.id)
            .eq("is_selected", true)
            .eq("source", "google");

          const googleCals = selectedGoogleCals || [];
          console.log("Google calendars selected:", googleCals.length, googleCals.map((c: any) => c.calendar_name));

          // If no Google calendars selected, check if any exist and auto-select owned ones
          if (googleCals.length === 0) {
            const { data: allGoogleCals } = await sb
              .from("user_calendars")
              .select("calendar_id, calendar_name, calendar_color, is_selected, access_role")
              .eq("user_id", dbUser.id)
              .eq("source", "google");
            
            console.log("All Google calendars in DB:", allGoogleCals?.length || 0);
            
            if (!allGoogleCals || allGoogleCals.length === 0) {
              // No Google calendars stored at all — fetch them now
              console.log("No Google calendars in DB, fetching from Google API...");
              try {
                const calListRes = await calendarApi.calendarList.list();
                const calendars = calListRes.data.items || [];
                console.log("Google API returned", calendars.length, "calendars");
                
                const rows = calendars.map((cal) => ({
                  user_id: dbUser.id,
                  calendar_id: cal.id!,
                  calendar_name: cal.summary || cal.id!,
                  calendar_color: cal.backgroundColor || null,
                  is_selected: cal.accessRole === "owner",
                  access_role: cal.accessRole || null,
                  source: "google",
                }));
                
                if (rows.length) {
                  await sb.from("user_calendars").upsert(rows, { onConflict: "user_id,calendar_id" });
                  // Use the newly inserted owned calendars
                  const owned = rows.filter(r => r.is_selected);
                  googleCals.push(...owned.map(r => ({
                    calendar_id: r.calendar_id,
                    calendar_name: r.calendar_name,
                    calendar_color: r.calendar_color,
                  })));
                  console.log("Auto-imported and selected", owned.length, "Google calendars");
                }
              } catch (fetchErr) {
                console.error("Failed to auto-fetch Google calendar list:", fetchErr);
              }
            } else {
              // Calendars exist but none selected — auto-select owned ones
              const ownedIds = allGoogleCals
                .filter((c: any) => c.access_role === "owner")
                .map((c: any) => c.calendar_id);
              
              if (ownedIds.length > 0) {
                console.log("Auto-selecting", ownedIds.length, "owned Google calendars");
                for (const calId of ownedIds) {
                  await sb
                    .from("user_calendars")
                    .update({ is_selected: true })
                    .eq("user_id", dbUser.id)
                    .eq("calendar_id", calId);
                }
                // Re-fetch selected
                const reSelected = allGoogleCals.filter((c: any) => ownedIds.includes(c.calendar_id));
                googleCals.push(...reSelected);
              }
            }
          }

          const googlePromises = googleCals.map(async (cal: any) => {
            try {
              console.log(`Fetching Google events for "${cal.calendar_name}" (${cal.calendar_id}), timeMin=${now.toISOString()}, timeMax=${windowEnd.toISOString()}`);
              const eventsRes = await calendarApi.events.list({
                calendarId: cal.calendar_id,
                timeMin: now.toISOString(),
                timeMax: windowEnd.toISOString(),
                singleEvents: true,
                orderBy: "startTime",
                maxResults: 250,
              });

              const rawItems = eventsRes.data.items || [];
              console.log(`Google cal "${cal.calendar_name}": ${rawItems.length} raw events`);
              if (rawItems.length > 0) {
                console.log("Sample events:", rawItems.slice(0, 3).map(e => ({
                  summary: e.summary,
                  status: e.status,
                  transparency: e.transparency,
                  start: e.start,
                  end: e.end,
                })));
              }

              for (const event of rawItems) {
                if (event.status === "cancelled") continue;
                // NOTE: Don't filter transparency here — we want to SHOW all events
                // on the calendar display (transparent = "free" in Google but user
                // still wants to see them). The sync engine filters transparency
                // separately for availability calculations.

                const start = event.start?.dateTime || event.start?.date;
                const end = event.end?.dateTime || event.end?.date;
                if (!start || !end) continue;

                const isAllDay = !event.start?.dateTime;

                // For all-day Google events, use plain date strings
                let startVal: string;
                let endVal: string;
                if (isAllDay) {
                  startVal = start; // already "YYYY-MM-DD" from event.start.date
                  endVal = end;
                } else {
                  startVal = start;
                  endVal = end;
                }

                allEvents.push({
                  id: `google_${event.id}`,
                  title: event.summary || "Busy",
                  start: startVal,
                  end: endVal,
                  allDay: isAllDay,
                  location: event.location || null,
                  source: "google",
                  calendarName: cal.calendar_name || "Google Calendar",
                  color: cal.calendar_color || "#4285f4",
                });
              }
            } catch (err) {
              console.error(`Failed to fetch events from Google cal ${cal.calendar_id}:`, err);
            }
          });

          await Promise.all(googlePromises);
        }
      } catch (err) {
        console.error("Google Calendar events fetch error:", err);
      }
    }

    // --- Apple Calendar events ---
    const hasApple = !!(dbUser.apple_calendar_connected && dbUser.apple_caldav_username && dbUser.apple_caldav_password);
    if (hasApple) {
      try {
        const { data: selectedAppleCals } = await sb
          .from("user_calendars")
          .select("calendar_id, calendar_name")
          .eq("user_id", dbUser.id)
          .eq("is_selected", true)
          .eq("source", "apple");

        const appleCals = selectedAppleCals || [];
        if (appleCals.length > 0) {
          const client = await createAppleCalDAVClient(dbUser.apple_caldav_username, dbUser.apple_caldav_password);

          for (const cal of appleCals) {
            try {
              const objects: DAVObject[] = await client.fetchCalendarObjects({
                calendar: { url: cal.calendar_id } as DAVCalendar,
                timeRange: {
                  start: now.toISOString(),
                  end: windowEnd.toISOString(),
                },
              });

              for (const obj of objects) {
                if (!obj.data) continue;
                const events = parseICalEventsWithDetails(obj.data, now, windowEnd);
                for (const ev of events) {
                  // For all-day events, send plain date strings to avoid timezone issues
                  const startStr = ev.allDay
                    ? ev.start.toISOString().slice(0, 10) // "2026-02-26"
                    : ev.start.toISOString();
                  const endStr = ev.allDay
                    ? ev.end.toISOString().slice(0, 10)
                    : ev.end.toISOString();
                  allEvents.push({
                    id: `apple_${obj.url || Math.random().toString(36)}`,
                    title: ev.title,
                    start: startStr,
                    end: endStr,
                    allDay: ev.allDay,
                    location: ev.location,
                    source: "apple",
                    calendarName: cal.calendar_name || "Apple Calendar",
                    color: "#ff3b30", // Apple red
                  });
                }
              }
            } catch (err) {
              console.error(`Failed to fetch events from Apple cal ${cal.calendar_id}:`, err);
            }
          }
        }
      } catch (err) {
        console.error("Apple Calendar events fetch error:", err);
      }
    }

    // ─── Trip buffer: detect multi-day all-day events and inject buffer days ───
    const tripBufferBefore = !!dbUser.trip_buffer_before;
    const tripBufferAfter = dbUser.trip_buffer_after !== false; // default true
    if (tripBufferBefore || tripBufferAfter) {
      const trips = allEvents.filter((ev) => {
        if (!ev.allDay) return false;
        // Multi-day = start and end are different dates (end is exclusive in iCal)
        // A single all-day event has end = start + 1 day, so diff > 1 means multi-day
        const s = ev.start; // "YYYY-MM-DD"
        const e = ev.end;
        if (s.length !== 10 || e.length !== 10) return false;
        const startMs = new Date(s + "T00:00:00").getTime();
        const endMs = new Date(e + "T00:00:00").getTime();
        const daySpan = (endMs - startMs) / 86400000;
        return daySpan >= 2; // 2+ calendar days (end is exclusive, so span ≥ 2 means at least a 2-day trip)
      });

      for (const trip of trips) {
        if (tripBufferBefore) {
          const dayBefore = new Date(trip.start + "T00:00:00");
          dayBefore.setDate(dayBefore.getDate() - 1);
          const bufferDate = dayBefore.toISOString().slice(0, 10);
          const nextDate = trip.start; // the trip start itself
          allEvents.push({
            id: `buffer_before_${trip.id}`,
            title: "✈️ Pre-trip buffer",
            start: bufferDate,
            end: nextDate,
            allDay: true,
            location: null,
            source: trip.source,
            calendarName: "Slotted",
            color: "#94a3b8", // slate-400
          });
        }
        if (tripBufferAfter) {
          // trip.end is already exclusive (day after last day), so that IS the recovery day
          const recoveryDate = trip.end;
          const dayAfterRecovery = new Date(recoveryDate + "T00:00:00");
          dayAfterRecovery.setDate(dayAfterRecovery.getDate() + 1);
          const recoveryEndDate = dayAfterRecovery.toISOString().slice(0, 10);
          allEvents.push({
            id: `buffer_after_${trip.id}`,
            title: "🔋 Trip recovery day",
            start: recoveryDate,
            end: recoveryEndDate,
            allDay: true,
            location: null,
            source: trip.source,
            calendarName: "Slotted",
            color: "#94a3b8", // slate-400
          });
        }
      }
      if (trips.length > 0) {
        console.log(`Trip buffer: detected ${trips.length} trips, injected buffer events (before=${tripBufferBefore}, after=${tripBufferAfter})`);
      }
    }

    // Sort by start time
    allEvents.sort((a, b) => a.start.localeCompare(b.start));

    const googleCount = allEvents.filter(e => e.source === "google").length;
    const appleCount = allEvents.filter(e => e.source === "apple").length;
    const bufferCount = allEvents.filter(e => e.id.startsWith("buffer_")).length;
    console.log(`Calendar events: ${allEvents.length} total (${googleCount} Google, ${appleCount} Apple, ${bufferCount} trip buffers)`);

    res.json({
      events: allEvents,
      sources: {
        google: hasGoogle,
        apple: hasApple,
      },
    });
  } catch (err: any) {
    console.error("Calendar events error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Calendar list & selection routes
// ---------------------------------------------------------------------------

/** GET /calendar/list — fetch user's Google Calendars (refreshes from Google) */
app.get("/calendar/list", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const oauth2 = await getAuthedCalendarClient(req.uid!);
    if (!oauth2) {
      res.status(400).json({ error: "Calendar not connected" });
      return;
    }

    const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
    const calListRes = await calendarApi.calendarList.list();
    const calendars = calListRes.data.items || [];

    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Upsert fresh calendar metadata — preserve is_selected for existing rows
    for (const cal of calendars) {
      const row = {
        user_id: dbUser.id,
        calendar_id: cal.id!,
        calendar_name: cal.summary || cal.id!,
        calendar_color: cal.backgroundColor || null,
        access_role: cal.accessRole || null,
        source: "google" as const,
      };

      // Check if calendar already exists
      const { data: existing } = await getSupabase()
        .from("user_calendars")
        .select("calendar_id")
        .eq("user_id", dbUser.id)
        .eq("calendar_id", cal.id!)
        .single();

      if (existing) {
        // Update metadata only — do NOT touch is_selected
        await getSupabase()
          .from("user_calendars")
          .update({
            calendar_name: row.calendar_name,
            calendar_color: row.calendar_color,
            access_role: row.access_role,
          })
          .eq("user_id", dbUser.id)
          .eq("calendar_id", cal.id!);
      } else {
        // New calendar — insert with default is_selected based on ownership
        await getSupabase()
          .from("user_calendars")
          .insert({
            ...row,
            is_selected: cal.accessRole === "owner",
          });
      }
    }

    // Return stored rows (which include is_selected) — Google calendars only
    const { data: stored } = await getSupabase()
      .from("user_calendars")
      .select("*")
      .eq("user_id", dbUser.id)
      .eq("source", "google")
      .order("calendar_name");

    res.json({ calendars: stored || [] });
  } catch (err: any) {
    console.error("Calendar list error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/selected — get only the selected calendar IDs */
app.get("/calendar/selected", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data } = await getSupabase()
      .from("user_calendars")
      .select("*")
      .eq("user_id", dbUser.id)
      .eq("is_selected", true)
      .order("calendar_name");

    res.json({ calendars: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /calendar/selected — update which calendars are selected */
app.put("/calendar/selected", requireAuth, async (req: AuthRequest, res: Response) => {
  const { calendarIds } = req.body; // array of Google Calendar IDs to select
  if (!Array.isArray(calendarIds)) {
    res.status(400).json({ error: "calendarIds must be an array" });
    return;
  }
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Deselect all, then select the provided ones
    await getSupabase()
      .from("user_calendars")
      .update({ is_selected: false })
      .eq("user_id", dbUser.id);

    if (calendarIds.length > 0) {
      await getSupabase()
        .from("user_calendars")
        .update({ is_selected: true })
        .eq("user_id", dbUser.id)
        .in("calendar_id", calendarIds);
    }

    // Return updated list
    const { data } = await getSupabase()
      .from("user_calendars")
      .select("*")
      .eq("user_id", dbUser.id)
      .order("calendar_name");

    res.json({ calendars: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Google Calendar webhook receiver (public — Google sends POST here)
// ---------------------------------------------------------------------------
app.post("/webhooks/google-calendar", async (req: Request, res: Response) => {
  const channelId = req.headers["x-goog-channel-id"] as string | undefined;
  const resourceState = req.headers["x-goog-resource-state"];
  console.log("Calendar webhook:", { channelId, resourceState });

  // When we get a real change notification, find the user and re-sync
  if (channelId && resourceState !== "sync") {
    try {
      const { data: user } = await getSupabase()
        .from("users")
        .select("firebase_uid")
        .eq("calendar_watch_channel", channelId)
        .single();

      if (user?.firebase_uid) {
        await syncUserCalendar(user.firebase_uid);
        console.log(`🔄 Webhook-triggered sync for channel ${channelId}`);
      }
    } catch (err) {
      console.error("Webhook sync error:", err);
    }
  }

  res.status(200).send("OK");
});

// ---------------------------------------------------------------------------
// One-time migration endpoint
// ---------------------------------------------------------------------------
app.post("/admin/migrate", async (req: Request, res: Response) => {
  if (req.body.secret !== "slotted-migrate-2026") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const results: string[] = [];
  const sb = getSupabase();

  // Migration: add invite_code, neighborhood, planning_style to users
  // We do this by inserting a temp row with the new columns — if columns don't exist, it'll fail
  // Instead, just try to read/write and let the caller know to add columns manually

  // Test what columns exist by doing a select
  const { error: testErr } = await sb
    .from("users")
    .select("id, invite_code, neighborhood, planning_style")
    .limit(0);

  if (testErr) {
    results.push(`Users table missing columns: ${testErr.message}`);
    results.push("Run these in Supabase SQL Editor:");
    results.push("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE;");
    results.push("ALTER TABLE users ADD COLUMN IF NOT EXISTS neighborhood TEXT;");
    results.push("ALTER TABLE users ADD COLUMN IF NOT EXISTS planning_style TEXT DEFAULT 'flexible';");
  } else {
    results.push("✓ Users table has invite_code, neighborhood, planning_style columns");
  }

  // Test feedback table
  const { error: fbErr } = await sb.from("feedback").select("id").limit(0);
  if (fbErr) {
    results.push("Run in SQL Editor: CREATE TABLE IF NOT EXISTS feedback (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), text TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());");
  } else {
    results.push("✓ feedback table exists");
  }

  // Test meetup_logs table
  const { error: mlErr } = await sb.from("meetup_logs").select("id").limit(0);
  if (mlErr) {
    results.push("Run in SQL Editor: CREATE TABLE IF NOT EXISTS meetup_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), activity_type TEXT, duration_min INTEGER, day_of_week INTEGER, time_of_day TEXT, rating INTEGER, created_at TIMESTAMPTZ DEFAULT NOW());");
  } else {
    results.push("✓ meetup_logs table exists");
  }

  // Test user_preferences table
  const { error: upErr } = await sb.from("user_preferences").select("id").limit(0);
  if (upErr) {
    results.push("Run in SQL Editor: CREATE TABLE IF NOT EXISTS user_preferences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id) UNIQUE, data JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());");
  } else {
    results.push("✓ user_preferences table exists");
  }

  // Test notifications table
  const { error: notifErr } = await sb.from("notifications").select("id").limit(0);
  if (notifErr) {
    // Auto-create the notifications table via rpc
    const createSql = `
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('friend_accepted','friend_request','meetup_request','meetup_confirmed','meetup_reminder','calendar_match')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        related_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        related_id UUID,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, read) WHERE read = FALSE;
    `;
    const { error: execErr } = await sb.rpc("exec_sql", { sql: createSql });
    if (execErr) {
      results.push("notifications table missing — run this SQL in Supabase SQL Editor:");
      results.push(createSql.trim());
    } else {
      results.push("✓ notifications table auto-created");
    }
  } else {
    results.push("✓ notifications table exists");
  }

  // Test pending_invites table
  const { error: piErr } = await sb.from("pending_invites").select("id").limit(0);
  if (piErr) {
    const createPiSql = `
      CREATE TABLE IF NOT EXISTS pending_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invited_email TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (inviter_id, invited_email)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON pending_invites (invited_email);
      CREATE INDEX IF NOT EXISTS idx_pending_invites_inviter ON pending_invites (inviter_id);
    `;
    const { error: piExecErr } = await sb.rpc("exec_sql", { sql: createPiSql });
    if (piExecErr) {
      results.push("pending_invites table missing — run this SQL in Supabase SQL Editor:");
      results.push(createPiSql.trim());
    } else {
      results.push("✓ pending_invites table auto-created");
    }
  } else {
    results.push("✓ pending_invites table exists");
  }

  res.json({ results });
});

// ---------------------------------------------------------------------------
// Scheduled Functions
// ---------------------------------------------------------------------------

/** 
 * Scheduled function to send meetup reminders
 * Runs every hour to check for meetups happening in the next 24 hours
 * Sends one reminder per meetup to each participant who hasn't been notified
 */
export const sendMeetupReminders = onSchedule("every 1 hours", async (event) => {
  const sb = getSupabase();
  
  // Find meetups happening in the next 24 hours that haven't been reminded yet
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  const { data: meetups } = await sb
    .from("meetups")
    .select(`
      id,
      title,
      start_time,
      location,
      created_by,
      meetup_participants (
        user_id,
        rsvp
      )
    `)
    .gte("start_time", now.toISOString())
    .lte("start_time", tomorrow.toISOString())
    .eq("status", "confirmed")
    .is("reminder_sent_at", null);

  if (!meetups || meetups.length === 0) {
    console.log("No meetups needing reminders");
    return;
  }

  for (const meetup of meetups) {
    const startDt = new Date(meetup.start_time);
    const timeStr = startDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " at " + startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    
    const locationStr = meetup.location ? ` at ${meetup.location}` : "";
    
    // Send reminders to all accepted participants
    const acceptedParticipants = (meetup.meetup_participants || [])
      .filter((p: any) => p.rsvp === "accepted");
    
    for (const participant of acceptedParticipants) {
      await createNotification({
        userId: participant.user_id,
        type: "meetup_reminder",
        title: "Reminder: Upcoming hangout!",
        body: `${meetup.title || "Hangout"} — ${timeStr}${locationStr}`,
        relatedId: meetup.id,
      });
    }
    
    // Mark as reminded
    await sb
      .from("meetups")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", meetup.id);
    
    console.log(`Sent reminders for meetup ${meetup.id} to ${acceptedParticipants.length} participants`);
  }
});

/**
 * Scheduled function: Behavior Divergence Detector + Calendar Matching
 * Runs daily at 9am to:
 * 1. Detect when users' actual social activity diverges from their settings
 * 2. Send gentle recommendations to update settings
 * 3. Find calendar matches for proactive suggestions
 */
export const findCalendarMatches = onSchedule("every day 09:00", async (event) => {
  const sb = getSupabase();

  // Get all active users
  const { data: users } = await sb
    .from("users")
    .select("id, display_name, social_frequency, planning_style")
    .eq("onboarded", true);

  if (!users || users.length === 0) {
    console.log("No onboarded users found");
    return;
  }

  // Map social_frequency to expected weekly rate
  const frequencyToWeeklyRate: Record<string, { min: number; max: number; label: string }> = {
    daily: { min: 5, max: 7, label: "every day" },
    "2-3-week": { min: 2, max: 3, label: "2-3 times per week" },
    weekly: { min: 0.8, max: 1.5, label: "about once per week" },
    biweekly: { min: 0.3, max: 0.7, label: "1-2 times per month" },
  };

  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);

  for (const user of users) {
    try {
      // Count meetups completed/confirmed in the last 4 weeks
      const { data: recentParticipations } = await sb
        .from("meetup_participants")
        .select("meetup_id")
        .eq("user_id", user.id)
        .in("rsvp", ["accepted"]);

      if (!recentParticipations || recentParticipations.length === 0) continue;

      const meetupIds = recentParticipations.map((p: any) => p.meetup_id);

      const { data: recentMeetups } = await sb
        .from("meetups")
        .select("id, start_time, status")
        .in("id", meetupIds)
        .gte("start_time", fourWeeksAgo.toISOString())
        .lte("start_time", now.toISOString())
        .in("status", ["confirmed", "completed"]);

      if (!recentMeetups || recentMeetups.length === 0) continue;

      const meetupCount = recentMeetups.length;
      const weeklyRate = meetupCount / 4; // average per week over 4 weeks

      const expected = frequencyToWeeklyRate[user.social_frequency || "2-3-week"];
      if (!expected) continue;

      // Check if they haven't been notified about this recently (throttle to max once per 2 weeks)
      const { data: recentNotifs } = await sb
        .from("notifications")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "calendar_match") // reuse type since we can't add new DB enum easily
        .gte("created_at", new Date(now.getTime() - 14 * 86400000).toISOString())
        .limit(1);

      if (recentNotifs && recentNotifs.length > 0) continue; // Already notified recently

      // Divergence detection
      if (weeklyRate > expected.max * 1.5) {
        // User is WAY more social than their setting suggests
        const roundedRate = Math.round(weeklyRate * 10) / 10;
        await createNotification({
          userId: user.id,
          type: "calendar_match", // reusing this type for settings recommendations
          title: "📊 Your social schedule looks busier than expected",
          body: `You've been hanging out about ${roundedRate}x per week over the last month, but your setting is "${expected.label}." Want to update your social battery settings so Slotted can suggest plans that better match your actual rhythm?`,
        });
        console.log(`Sent divergence notification to ${user.display_name}: ${roundedRate}/week vs "${expected.label}"`);
      } else if (weeklyRate < expected.min * 0.5 && meetupCount >= 1) {
        // User is much LESS social than their setting — maybe they want to be nudged more?
        const roundedRate = Math.round(weeklyRate * 10) / 10;
        await createNotification({
          userId: user.id,
          type: "calendar_match",
          title: "💡 Looks like you've been less social lately",
          body: `You've had about ${roundedRate} plans per week over the last month, but your preference is "${expected.label}." Need a recharge? You can update your social battery in Settings, or we can help nudge you to reconnect.`,
        });
        console.log(`Sent under-activity notification to ${user.display_name}: ${roundedRate}/week vs "${expected.label}"`);
      }

      // Planning style divergence — check if meetup booking patterns don't match
      if (user.planning_style && recentMeetups.length >= 3) {
        // Check how far in advance meetups were created vs when they happened
        const { data: meetupsWithCreation } = await sb
          .from("meetups")
          .select("start_time, created_at")
          .in("id", recentMeetups.map((m: any) => m.id));

        if (meetupsWithCreation && meetupsWithCreation.length >= 3) {
          const leadTimes = meetupsWithCreation.map((m: any) => {
            const start = new Date(m.start_time).getTime();
            const created = new Date(m.created_at).getTime();
            return (start - created) / 86400000; // days of advance notice
          });
          const avgLeadDays = leadTimes.reduce((a: number, b: number) => a + b, 0) / leadTimes.length;

          if (user.planning_style === "planner" && avgLeadDays < 2) {
            // Says they're a planner but books last-minute
            await createNotification({
              userId: user.id,
              type: "calendar_match",
              title: "🔄 Your booking style has shifted",
              body: `Most of your recent plans were made ${Math.round(avgLeadDays * 10) / 10} days ahead — looks like you're more spontaneous than "Planner." Want to switch your planning style to Flexible or Spontaneous so we suggest more last-minute plans?`,
            });
          } else if (user.planning_style === "spontaneous" && avgLeadDays > 7) {
            // Says they're spontaneous but actually plans ahead
            await createNotification({
              userId: user.id,
              type: "calendar_match",
              title: "🔄 Your booking style has shifted",
              body: `Your recent plans were booked about ${Math.round(avgLeadDays)} days in advance — looks like you're more of a planner! Want to switch your planning style so we help you book further out?`,
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error processing behavior divergence for user ${user.id}:`, err);
    }
  }

  console.log(`Behavior divergence check complete for ${users.length} users`);
});

// ---------------------------------------------------------------------------
// Export as Firebase Cloud Function
// ---------------------------------------------------------------------------
export const api = onRequest({ memory: "512MiB" }, app);
