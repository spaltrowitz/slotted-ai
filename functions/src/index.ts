import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { getSupabase } from "./supabase";

// ---------------------------------------------------------------------------
// Firebase & global config
// ---------------------------------------------------------------------------
admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const app = express();
app.use(cors({ origin: true }));
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

// ---------------------------------------------------------------------------
// Health check (public)
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "slotted-api", timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// User routes
// ---------------------------------------------------------------------------

/** Generate an invite code from a display name (e.g. "Shari Paltrowitz" → "shari123") */
async function generateInviteCode(displayName: string): Promise<string> {
  const base = (displayName || "user")
    .split(" ")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const sb = getSupabase();

  // Try the base name first, then add random digits
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 900) + 100}`;
    const { data } = await sb.from("users").select("id").eq("invite_code", code).single();
    if (!data) return code; // unique — use it
  }
  // Fallback: base + timestamp suffix
  return `${base}${Date.now() % 100000}`;
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
          timezone: timezone || "America/New_York",
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
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /users/me — fetch current user profile */
app.get("/users/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getDbUser(req.uid!);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
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
      .select("firebase_uid, display_name, photo_url")
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

/** POST /users/me/onboarding — save onboarding answers */
app.post("/users/me/onboarding", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { socialFrequency, preferredTimes, travelBuffer, socialBattery } =
      req.body;

    const { data, error } = await getSupabase()
      .from("users")
      .update({
        social_frequency: socialFrequency,
        preferred_times: preferredTimes,
        travel_buffer_min: travelBuffer ? parseInt(travelBuffer, 10) : 30,
        social_battery: socialBattery || "open",
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
      const friend = f.user_a.id === me.id ? f.user_b : f.user_a;
      return {
        friendshipId: f.id,
        status: f.status,
        invitedBy: f.invited_by,
        friend: {
          id: friend.id,
          displayName: friend.display_name,
          email: friend.email,
          photoUrl: friend.photo_url,
          socialBattery: friend.social_battery,
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
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Find the invitee
    const { data: invitee } = await getSupabase()
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (!invitee) {
      // TODO: send an email invite to non-users
      res.status(404).json({ error: "User not on Slotted yet", email });
      return;
    }

    if (invitee.id === me.id) {
      res.status(400).json({ error: "Cannot friend yourself" });
      return;
    }

    // Canonical ordering: smaller UUID first
    const [userA, userB] =
      me.id < invitee.id ? [me.id, invitee.id] : [invitee.id, me.id];

    const { data, error } = await getSupabase()
      .from("friendships")
      .upsert(
        {
          user_a_id: userA,
          user_b_id: userB,
          invited_by: me.id,
          status: "pending",
        },
        { onConflict: "user_a_id,user_b_id" },
      )
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
        .select("id")
        .eq("firebase_uid", referrerUid)
        .single();
      referrer = data;
    } else if (referrerEmail) {
      const { data } = await getSupabase()
        .from("users")
        .select("id")
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
        },
        { onConflict: "user_a_id,user_b_id" },
      )
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

/** PATCH /friends/:friendshipId — accept or decline a friendship */
app.patch("/friends/:friendshipId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendshipId } = req.params;
  const { action } = req.body;
  if (!["accept", "decline"].includes(action)) {
    res.status(400).json({ error: "Invalid action" });
    return;
  }
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const newStatus = action === "accept" ? "accepted" : "declined";

    const { data, error } = await getSupabase()
      .from("friendships")
      .update({ status: newStatus })
      .eq("id", friendshipId)
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
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
// Availability routes
// ---------------------------------------------------------------------------

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

/** GET /availability/overlap/:friendId — find mutual free slots */
app.get("/availability/overlap/:friendId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendId } = req.params;
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const now = new Date().toISOString();

    // Fetch both users' free slots in parallel
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

    // Simple overlap calculation
    const overlaps: { start: string; end: string }[] = [];
    for (const a of mySlots.data || []) {
      for (const b of friendSlots.data || []) {
        const start = a.start_time > b.start_time ? a.start_time : b.start_time;
        const end = a.end_time < b.end_time ? a.end_time : b.end_time;
        if (start < end) {
          overlaps.push({ start, end });
        }
      }
    }

    res.json({ overlaps });
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

    const { title, friendId, startTime, endTime, location, description } = req.body;

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

    // Add both users as participants
    const participants = [
      { meetup_id: meetup.id, user_id: me.id, rsvp: "accepted" },
      { meetup_id: meetup.id, user_id: friendId, rsvp: "pending" },
    ];

    const { error: partErr } = await getSupabase()
      .from("meetup_participants")
      .insert(participants);

    if (partErr) {
      res.status(500).json({ error: partErr.message });
      return;
    }

    res.json(meetup);
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

    res.json({ meetups });
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
    res.json(data);
  } catch (err: any) {
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
        activity_type: activity_type || "hangout",
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
// Google Calendar webhook receiver (public — Google sends POST here)
// ---------------------------------------------------------------------------
app.post("/webhooks/google-calendar", (req: Request, res: Response) => {
  const channelId = req.headers["x-goog-channel-id"];
  const resourceState = req.headers["x-goog-resource-state"];
  console.log("Calendar webhook:", { channelId, resourceState });
  // TODO: fetch updated events from Google Calendar and sync to availability
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

  res.json({ results });
});

// ---------------------------------------------------------------------------
// Export as Firebase Cloud Function
// ---------------------------------------------------------------------------
export const api = onRequest(app);
