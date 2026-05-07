import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware, rateLimitPublic, getClientIp } from "../middleware/rateLimiter";
import {
  getDbUser,
  generateInviteCode,
  createNotification,
  overlayOAuthTokens,
  deleteOAuthTokens,
  removeCalendarEventsForMeetup,
} from "../utils/helpers";
import { getSupabase } from "../supabase";

const router = express.Router();

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

/** POST /users/me — upsert user on first login / profile update */
router.post("/users/me", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

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
              .maybeSingle();

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

      // Reclassify any friendships based on neighborhoods
      if (data.neighborhood) {
        try {
          await reclassifyFriendships(data.id, data.neighborhood);
        } catch (e) {
          console.error("Failed to reclassify friendships on signup:", e);
        }
      }
    }

    // Send a welcome notification only for brand-new users (not on every login)
    if (data && !existing) {
      // Guard against duplicate welcome notifications (race condition on rapid calls)
      const { data: existingWelcome } = await getSupabase()
        .from("notifications")
        .select("id")
        .eq("user_id", data.id)
        .like("title", "%Welcome to Slotted%")
        .limit(1);

      if (!existingWelcome || existingWelcome.length === 0) {
        await getSupabase().from("notifications").insert({
          user_id: data.id,
          type: "calendar_match",
          title: "Welcome to Slotted! 👋",
          body: "Get started in 2 quick steps: 1️⃣ Go to Settings to connect your calendar and set your preferences. 2️⃣ Head to the Friends tab to invite friends — Slotted will find the best times for you to hang out!",
          read: true,
        });
      }
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
  "outlook_access_token",
  "outlook_refresh_token",
  "outlook_token_expires_at",
];

function stripSensitive(user: Record<string, any>) {
  const safe = { ...user };
  for (const field of SENSITIVE_FIELDS) {
    delete safe[field];
  }
  return safe;
}

/** Extract city from neighborhood string (e.g., "West Village, NYC" → "nyc") */
function extractCity(neighborhood: string): string {
  return neighborhood.toLowerCase().split(',').pop()?.trim() || '';
}

/** Re-evaluate friendship types for all of a user's friendships based on current neighborhoods */
async function reclassifyFriendships(userId: string, myNeighborhood: string) {
  const myCity = extractCity(myNeighborhood);

  const { data: friendships } = await getSupabase()
    .from("friendships")
    .select("id, user_a_id, user_b_id, user_a_friendship_type, user_b_friendship_type, user_a:users!friendships_user_a_id_fkey(id, neighborhood), user_b:users!friendships_user_b_id_fkey(id, neighborhood)")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .eq("status", "accepted");

  if (!friendships?.length) return;

  for (const f of friendships) {
    const iAmA = (f as any).user_a_id === userId;
    const friend = iAmA ? (f as any).user_b : (f as any).user_a;
    const theirNeighborhood = friend?.neighborhood || '';
    const theirCity = extractCity(theirNeighborhood);

    let newType = 'local';
    if (myCity && theirCity && myCity !== theirCity) {
      newType = 'long_distance';
    }

    // Only update MY side — the friend's classification of me updates when they save their settings
    const myCurrentType = iAmA ? (f as any).user_a_friendship_type : (f as any).user_b_friendship_type;
    if (myCurrentType !== newType) {
      const col = iAmA ? 'user_a_friendship_type' : 'user_b_friendship_type';
      await getSupabase()
        .from("friendships")
        .update({ [col]: newType })
        .eq("id", (f as any).id);
    }
  }
}

/** GET /users/me — fetch current user profile (sensitive fields stripped) */
router.get("/users/me", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/users/invite/:code", async (req: Request, res: Response) => {
  try {
    const clientKey = getClientIp(req);
    if (rateLimitPublic(clientKey)) {
      res.status(429).json({ error: "Too many invite lookups. Please try again shortly." });
      return;
    }

    const { code } = req.params;
    const normalizedCode = String(code || "").trim().toLowerCase();
    if (!/^[a-z0-9]{3,32}$/.test(normalizedCode)) {
      res.status(400).json({ error: "Invalid invite code format" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("users")
      .select("firebase_uid, display_name, photo_url")
      .eq("invite_code", normalizedCode)
      .maybeSingle();

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
router.patch("/users/me/battery", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.put("/users/me/settings", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const {
      socialFrequency, preferredTimes, travelBuffer,
      socialBattery, rechargingDays, planningStyle,
      neighborhood, workNeighborhood, officeDays,
      callWindows, tripBufferBefore, tripBufferAfter, shareHangouts, officeScheduleVaries,
      eventInterests, eventCity, displayName, videoPlatforms,
      socialGoal, preferredDuration, preferredCallDuration,
    } = req.body;

    const updates: Record<string, any> = {};
    if (displayName !== undefined) updates.display_name = displayName;
    if (videoPlatforms !== undefined) updates.video_platforms = videoPlatforms;
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
    if (socialGoal !== undefined) updates.social_goal = socialGoal;
    if (preferredDuration !== undefined) updates.preferred_duration = preferredDuration;
    if (preferredCallDuration !== undefined) updates.preferred_call_duration = preferredCallDuration;

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

    // When neighborhood changes, re-evaluate friendship types for all friendships
    if (neighborhood !== undefined && data) {
      try {
        await reclassifyFriendships(data.id, neighborhood);
      } catch (e) {
        // Non-critical — don't fail the settings save
        console.error("Failed to reclassify friendships:", e);
      }
    }

    res.json(stripSensitive(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /users/me/onboarding — save onboarding answers */
router.post("/users/me/onboarding", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { socialFrequency, preferredTimes, travelBuffer, socialBattery, rechargingDays, socialGoal, preferredDuration, preferredCallDuration, neighborhood } =
      req.body;

    const updatePayload: Record<string, any> = {
      social_frequency: socialFrequency,
      preferred_times: preferredTimes,
      travel_buffer_min: travelBuffer ? parseInt(travelBuffer, 10) : 30,
      social_battery: socialBattery || "open",
      recharging_days: rechargingDays || [],
      social_goal: socialGoal || null,
      preferred_duration: preferredDuration || null,
      preferred_call_duration: preferredCallDuration || null,
      onboarded: true,
    };

    if (neighborhood) {
      updatePayload.neighborhood = neighborhood;
    }

    const { data, error } = await getSupabase()
      .from("users")
      .update(updatePayload)
      .eq("firebase_uid", req.uid!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // If neighborhood was provided, reclassify friendships for long-distance detection
    if (neighborhood && data?.id) {
      await reclassifyFriendships(data.id, neighborhood);
    }

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /users/me/fcm-token — save FCM token for push notifications */
router.post("/users/me/fcm-token", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

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
router.delete("/users/me/fcm-token", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
// Account Deletion (GDPR / App Store compliance)
// ---------------------------------------------------------------------------

/** DELETE /account — permanently delete user account and all associated data */
router.delete("/account", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      // Idempotent — user already deleted from DB, clean up Firebase auth
      try {
        await admin.auth().deleteUser(req.uid!);
      } catch (err) { console.error("Failed to delete Firebase auth user:", err); }
      res.json({ success: true, message: "Account deleted" });
      return;
    }

    const userId = me.id;
    const supabase = getSupabase();

    // --- Cancel meetups created by this user and notify participants ---
    const { data: createdMeetups } = await supabase
      .from("meetups")
      .select("id, title")
      .eq("created_by", userId)
      .in("status", ["proposed", "confirmed"]);

    if (createdMeetups && createdMeetups.length > 0) {
      for (const mtup of createdMeetups) {
        // Remove calendar events for OTHER participants (deleted user's calendar cleans up automatically)
        removeCalendarEventsForMeetup(mtup.id, userId).catch(() => {});

        const { data: participants } = await supabase
          .from("meetup_participants")
          .select("user_id")
          .eq("meetup_id", mtup.id)
          .neq("user_id", userId);

        // Notify participants that the meetup is cancelled
        for (const p of participants || []) {
          await createNotification({
            userId: p.user_id,
            type: "meetup_declined",
            title: "📅 Plan cancelled",
            body: `${me.display_name || "Someone"} deleted their account — "${mtup.title || "Hangout"}" has been cancelled.`,
            relatedId: mtup.id,
          });
        }
      }

      // Cancel all meetups created by this user
      await supabase
        .from("meetups")
        .update({ status: "cancelled" })
        .eq("created_by", userId)
        .in("status", ["proposed", "confirmed"]);
    }

    // --- Delete notifications ABOUT this user that others see ---
    await supabase.from("notifications").delete().eq("related_user_id", userId);

    // --- Delete OAuth tokens from Vault ---
    for (const provider of ["google", "outlook", "apple"] as const) {
      try { await deleteOAuthTokens(userId, provider); } catch (err) { console.error(`Failed to delete ${provider} OAuth tokens:`, err); }
    }

    // --- Delete blocked_users entries (both directions) ---
    await supabase.from("blocked_users").delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

    // Delete in dependency order (child records first)
    await supabase.from("fcm_tokens").delete().eq("user_id", userId);
    await supabase.from("notifications").delete().eq("user_id", userId);
    await supabase.from("user_calendars").delete().eq("user_id", userId);
    await supabase.from("manual_busy_blocks").delete().eq("user_id", userId);
    await supabase.from("availability_slots").delete().eq("user_id", userId);
    await supabase.from("saved_events").delete().eq("user_id", userId);
    await supabase.from("event_invites").delete().or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
    await supabase.from("meetup_participants").delete().eq("user_id", userId);
    await supabase.from("meetup_logs").delete().eq("user_id", userId);
    await supabase.from("meetups").delete().eq("created_by", userId);
    await supabase.from("friendships").delete().or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);
    await supabase.from("pending_invites").delete().eq("inviter_id", userId);
    await supabase.from("feedback").delete().eq("user_id", userId);
    await supabase.from("users").delete().eq("id", userId);

    // Delete Firebase Auth account
    try {
      await admin.auth().deleteUser(req.uid!);
    } catch (authErr: any) {
      // Auth user may already be gone — not fatal
      console.warn("Firebase auth deletion note:", authErr.code);
    }

    // Audit log (no PII — just the event)
    console.log(`ACCOUNT_DELETED: db_user_id=${userId} at ${new Date().toISOString()}`);

    res.json({ success: true, message: "Account deleted" });
  } catch (err: any) {
    console.error("Account deletion error:", err);
    res.status(500).json({ error: "Failed to delete account. Please try again or contact support." });
  }
});

export default router;
