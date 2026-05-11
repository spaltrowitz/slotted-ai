import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import { getSupabase } from "./supabase";
import {
  getDbUserById,
  getAuthedCalendarClient,
  createNotification,
  filterOverlapsToHangoutWindows,
  GOOGLE_WEBHOOK_SECRET,
  formatDateTimeForTimeZone,
} from "./utils/helpers";

// Route modules
import notificationsRouter from "./routes/notifications";
import usersRouter from "./routes/users";
import friendsRouter from "./routes/friends";
import availabilityRouter from "./routes/availability";
import meetupsRouter from "./routes/meetups";
import eventsRouter from "./routes/events";
import calendarRouter from "./routes/calendar";
import miscRouter from "./routes/misc";
import adminRouter from "./routes/admin";
import smsRouter from "./routes/sms";
import couplesRouter from "./routes/couples";
import recurringRouter from "./routes/recurring";
import quickRouter from "./routes/quick";

// ---------------------------------------------------------------------------
// Firebase & global config
// ---------------------------------------------------------------------------
admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

// ---------------------------------------------------------------------------
// Startup env-var validation — fail loudly if critical vars are missing
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "FRONTEND_URL",
] as const;

const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missingVars.length) {
  console.warn(
    `[WARN] Missing environment variables: ${missingVars.join(", ")}. ` +
    "Add them to functions/.env before deploying.",
  );
}

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
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
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

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const originalEnd = res.end;
  res.end = function (...args: Parameters<typeof res.end>) {
    const duration = Date.now() - start;
    const status = res.statusCode;
    if (status >= 500) {
      console.error(`[REQ] ${req.method} ${req.path} → ${status} (${duration}ms)`);
    } else if (status >= 400 || duration > 5000) {
      console.warn(`[REQ] ${req.method} ${req.path} → ${status} (${duration}ms)`);
    }
    return originalEnd.apply(res, args);
  } as typeof res.end;
  next();
});

// ---------------------------------------------------------------------------
// Health check (public)
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "slotted-api", timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Mount route modules
// ---------------------------------------------------------------------------
app.use(notificationsRouter);
app.use(usersRouter);
app.use(friendsRouter);
app.use(availabilityRouter);
app.use(meetupsRouter);
app.use(eventsRouter);
app.use(calendarRouter);
app.use(miscRouter);
app.use(adminRouter);
app.use(smsRouter);
app.use(couplesRouter);
app.use(recurringRouter);
app.use(quickRouter);

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[UNHANDLED] ${req.method} ${req.path}: ${err.message}`, err.stack?.split("\n").slice(0, 3).join("\n"));
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Scheduled Functions
// ---------------------------------------------------------------------------
async function sendEventPollNudgeEmail(userId: string, subject: string, body: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Slotted.ai <noreply@slotted.ai>";
  if (!apiKey) {
    console.log(`[EMAIL_POLL_NUDGE] RESEND_API_KEY not configured; skipped email for ${userId}`);
    return;
  }

  const { data: user, error } = await getSupabase()
    .from("users")
    .select("email, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error || !user?.email) {
    console.warn(`[EMAIL_POLL_NUDGE] Could not load email for ${userId}: ${error?.message || "missing email"}`);
    return;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: user.email,
      subject,
      text: body,
    }),
  });

  if (!resp.ok) {
    console.error(`[EMAIL_POLL_NUDGE] Failed to email ${user.email}: ${resp.status} ${await resp.text()}`);
  }
}

export const renewCalendarWatchChannels = onSchedule("every 6 hours", async () => {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: googleUserIds } = await sb.rpc("users_with_oauth_provider", { p_provider: "google" });
  const googleIdSet = new Set((googleUserIds || []).map((r: any) => r.user_id));

  const { data: users } = await sb.from("users")
    .select("id, firebase_uid, calendar_watch_channel, calendar_watch_resource_id")
    .lt("calendar_watch_expiry", cutoff);

  const filteredUsers = (users || []).filter((u: any) => googleIdSet.has(u.id));

  for (const user of filteredUsers) {
    try {
      const oauth2 = await getAuthedCalendarClient(user.firebase_uid);
      if (!oauth2) continue;
      const calendarApi = google.calendar({ version: "v3", auth: oauth2 });

      if (user.calendar_watch_channel && user.calendar_watch_resource_id) {
        await calendarApi.channels.stop({
          requestBody: {
            id: user.calendar_watch_channel,
            resourceId: user.calendar_watch_resource_id,
          },
        }).catch(() => {});
      }

      const channelId = `slotted-${user.id}-${Date.now()}`;
      const watchRes = await calendarApi.events.watch({
        calendarId: "primary",
        requestBody: {
          id: channelId,
          type: "web_hook",
          address: `${process.env.WEBHOOK_BASE_URL || "https://slotted-ai.web.app/api"}/webhooks/google-calendar`,
          token: GOOGLE_WEBHOOK_SECRET,
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await sb.from("users").update({
        calendar_watch_channel: channelId,
        calendar_watch_expiry: new Date(Number(watchRes.data.expiration)).toISOString(),
        calendar_watch_resource_id: watchRes.data.resourceId,
      }).eq("id", user.id);

      console.log(`Renewed watch channel for user ${user.id}`);
    } catch (err) {
      console.error(`Failed to renew watch for user ${user.id}:`, err);
    }
  }
});

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
    const locationStr = meetup.location ? ` at ${meetup.location}` : "";
    
    // Send reminders to all accepted participants
    const acceptedParticipants = (meetup.meetup_participants || [])
      .filter((p: any) => p.rsvp === "accepted");
    const acceptedUserIds = acceptedParticipants.map((participant: any) => participant.user_id);
    const { data: recipientRows } = acceptedUserIds.length
      ? await sb.from("users").select("id, timezone").in("id", acceptedUserIds)
      : { data: [] };
    const recipientTimeZones = new Map((recipientRows || []).map((user: any) => [user.id, user.timezone || "America/New_York"]));
    
    for (const participant of acceptedParticipants) {
      const timeStr = formatDateTimeForTimeZone(meetup.start_time, recipientTimeZones.get(participant.user_id));
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

export const expireEventSchedulePolls = onSchedule("every 1 hours", async () => {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from("event_schedules")
    .update({
      status: "expired",
      invites_closed: true,
      invites_closed_at: nowIso,
    })
    .eq("status", "voting")
    .lt("expires_at", nowIso)
    .select("id");

  if (error) {
    console.error("Failed to expire event schedule polls:", error.message);
    return;
  }

  console.log(`Expired ${data?.length || 0} event schedule polls`);
});

/**
 * Scheduled function: Pending RSVP Nudge
 * Runs every 4 hours. For meetups happening within 24-48 hours that are
 * still in "proposed" status with pending RSVPs, it nudges:
 *   - Outstanding invitees to respond
 *   - The meetup creator that responses are still pending
 * Each meetup is only nudged once (tracked via a dedicated notification per meetup per user).
 */
export const sendPendingRsvpNudges = onSchedule("every 4 hours", async (event) => {
  const sb = getSupabase();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // Find proposed meetups happening in 24-48 hours
  const { data: meetups } = await sb
    .from("meetups")
    .select(`
      id,
      title,
      start_time,
      created_by,
      meetup_participants (
        user_id,
        rsvp
      )
    `)
    .gte("start_time", in24h.toISOString())
    .lte("start_time", in48h.toISOString())
    .eq("status", "proposed");

  if (!meetups || meetups.length === 0) {
    console.log("No proposed meetups in 24-48h window needing RSVP nudges");
    return;
  }

  for (const meetup of meetups) {
    const pendingParticipants = (meetup.meetup_participants || [])
      .filter((p: any) => p.rsvp === "pending");

    if (pendingParticipants.length === 0) continue;

    const startDt = new Date(meetup.start_time);
    const timeStr = startDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " at " + startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    // Check if we already nudged for this meetup (dedup via relatedId in recent notifications)
    const recentCutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(); // 12h dedup window

    // Nudge each pending invitee
    for (const p of pendingParticipants) {
      // Check dedup — skip if already nudged this invitee for this meetup recently
      const { data: existing } = await sb
        .from("notifications")
        .select("id")
        .eq("user_id", p.user_id)
        .eq("related_id", meetup.id)
        .eq("type", "meetup_reminder")
        .gte("created_at", recentCutoff)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await createNotification({
        userId: p.user_id,
        type: "meetup_reminder",
        title: "\u23F0 Still waiting on your RSVP",
        body: `${meetup.title || "Hangout"} is coming up ${timeStr} — are you in?`,
        relatedId: meetup.id,
      });
    }

    // Nudge the creator that RSVPs are still pending
    const pendingNames: string[] = [];
    for (const p of pendingParticipants) {
      const u = await getDbUserById(p.user_id);
      if (u?.display_name) pendingNames.push(u.display_name.split(" ")[0]);
    }
    const namesStr = pendingNames.join(", ") || "your invitees";

    // Dedup check for creator too
    const { data: creatorExisting } = await sb
      .from("notifications")
      .select("id")
      .eq("user_id", meetup.created_by)
      .eq("related_id", meetup.id)
      .eq("type", "meetup_reminder")
      .gte("created_at", recentCutoff)
      .limit(1);

    if (!creatorExisting || creatorExisting.length === 0) {
      await createNotification({
        userId: meetup.created_by,
        type: "meetup_reminder",
        title: "\u23F3 Waiting on RSVPs",
        body: `${namesStr} haven't responded to ${meetup.title || "your hangout"} (${timeStr}). Want to send a nudge?`,
        relatedId: meetup.id,
      });
    }

    console.log(`Sent RSVP nudge for meetup ${meetup.id} — ${pendingParticipants.length} pending`);
  }
});

/**
 * Event poll nudge: once a poll has been waiting at least 24 hours, remind
 * invited participants who still have not picked dates. Uses notification
 * history for dedupe so each person gets at most one auto nudge per poll/day.
 */
export const sendEventPollNudges = onSchedule("every 4 hours", async () => {
  const sb = getSupabase();
  const now = new Date();
  const olderThan24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recentNudgeCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: schedules, error: schedulesErr } = await sb
    .from("event_schedules")
    .select("id, event_title, created_by, friend_ids, created_at")
    .eq("status", "voting")
    .lte("created_at", olderThan24h)
    .limit(100);

  if (schedulesErr) {
    console.error("Failed to fetch event polls for nudges:", schedulesErr.message);
    return;
  }
  if (!schedules || schedules.length === 0) return;

  const scheduleIds = schedules.map((schedule: any) => schedule.id);
  const { data: votes, error: votesErr } = await sb
    .from("event_schedule_votes")
    .select("schedule_id, user_id")
    .in("schedule_id", scheduleIds);
  if (votesErr) {
    console.error("Failed to fetch event poll votes for nudges:", votesErr.message);
    return;
  }

  const votedBySchedule = new Map<string, Set<string>>();
  for (const vote of votes || []) {
    const current = votedBySchedule.get(vote.schedule_id) || new Set<string>();
    current.add(vote.user_id);
    votedBySchedule.set(vote.schedule_id, current);
  }

  for (const schedule of schedules) {
    const voted = votedBySchedule.get(schedule.id) || new Set<string>();
    const pendingFriendIds = (schedule.friend_ids || []).filter((userId: string) => !voted.has(userId));
    if (pendingFriendIds.length === 0) continue;

    for (const userId of pendingFriendIds) {
      const { data: existing } = await sb
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "meetup_request")
        .eq("related_id", schedule.id)
        .gte("created_at", recentNudgeCutoff)
        .limit(1);
      if (existing && existing.length > 0) continue;

      await createNotification({
        userId,
        type: "meetup_request",
        title: `Reminder: pick dates for ${schedule.event_title}`,
        body: "The poll is waiting on your availability.",
        relatedId: schedule.id,
      });
      await sendEventPollNudgeEmail(
        userId,
        `Reminder: pick dates for ${schedule.event_title}`,
        `The ${schedule.event_title} poll is waiting on your availability. Open Slotted.ai to pick the dates that work for you.`,
      );
    }
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
  const _oneWeekAgo = new Date(now.getTime() - 7 * 86400000);

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
      // Filter by divergence-specific title prefix to avoid cross-contamination with weekend match nudges
      const { data: recentNotifs } = await sb
        .from("notifications")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "calendar_match")
        .ilike("title", "📊%")
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

  // ─── Proactive free-time matching: "You and X are both free this weekend" ───
  try {
    // Hard cap: at most one proactive weekend match nudge per user per calendar day.
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const { data: sentToday } = await sb
      .from("notifications")
      .select("user_id")
      .eq("type", "calendar_match")
      .gte("created_at", dayStart.toISOString())
      .ilike("title", "📅 You and % are both free this weekend");
    const usersNudgedToday = new Set<string>((sentToday || []).map((n: any) => n.user_id));

    // Get all accepted friendships
    const { data: friendships } = await sb
      .from("friendships")
      .select("user_a_id, user_b_id")
      .eq("status", "accepted");

    if (friendships && friendships.length > 0) {
      // Determine the upcoming weekend window (Saturday + Sunday)
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
      const daysUntilSat = (6 - dayOfWeek + 7) % 7 || 7; // next Saturday
      const satStart = new Date(today);
      satStart.setDate(today.getDate() + daysUntilSat);
      satStart.setHours(8, 0, 0, 0);
      const sunEnd = new Date(satStart);
      sunEnd.setDate(satStart.getDate() + 1);
      sunEnd.setHours(22, 0, 0, 0);

      // Only run if the weekend is 1-5 days away (avoid stale suggestions)
      if (daysUntilSat >= 1 && daysUntilSat <= 5) {
        // Collect unique user IDs from friendships
        const userIdSet = new Set<string>();
        for (const f of friendships) {
          userIdSet.add(f.user_a_id);
          userIdSet.add(f.user_b_id);
        }

        // Batch-fetch weekend free slots for all users
        const userFreeSlots = new Map<string, any[]>();
        for (const uid of userIdSet) {
          const { data: slots } = await sb
            .from("availability")
            .select("start_time, end_time")
            .eq("user_id", uid)
            .eq("status", "free")
            .gte("end_time", satStart.toISOString())
            .lte("start_time", sunEnd.toISOString());
          if (slots && slots.length > 0) {
            userFreeSlots.set(uid, slots);
          }
        }

        // Check each friendship pair for overlapping weekend free time
        for (const f of friendships) {
          const slotsA = userFreeSlots.get(f.user_a_id);
          const slotsB = userFreeSlots.get(f.user_b_id);
          if (!slotsA || !slotsB) continue;

          // Find overlaps >= 1 hour
          let bestOverlap: { start: string; end: string } | null = null;
          for (const a of slotsA) {
            for (const b of slotsB) {
              const start = a.start_time > b.start_time ? a.start_time : b.start_time;
              const end = a.end_time < b.end_time ? a.end_time : b.end_time;
              const durMin = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
              if (durMin >= 60) {
                if (!bestOverlap || durMin > (new Date(bestOverlap.end).getTime() - new Date(bestOverlap.start).getTime()) / 60000) {
                  bestOverlap = { start, end };
                }
              }
            }
          }

          if (!bestOverlap) continue;

          // Filter through hangout windows before sending notifications
          const hangoutOverlaps = filterOverlapsToHangoutWindows([bestOverlap]);
          if (hangoutOverlaps.length === 0) continue;
          const filteredOverlap = hangoutOverlaps[0];

          // Throttle: skip if we already sent a calendar_match to either user about the other in the last 7 days
          const throttleCutoff = new Date(now.getTime() - 7 * 86400000).toISOString();
          for (const [userId, friendId] of [[f.user_a_id, f.user_b_id], [f.user_b_id, f.user_a_id]]) {
            if (usersNudgedToday.has(userId)) continue;

            const { data: recentMatch } = await sb
              .from("notifications")
              .select("id")
              .eq("user_id", userId)
              .eq("type", "calendar_match")
              .eq("related_user_id", friendId)
              .gte("created_at", throttleCutoff)
              .limit(1);

            if (recentMatch && recentMatch.length > 0) continue;

            // Check the friend's social battery — don't suggest if they're recharging
            const friendUser = await getDbUserById(friendId);
            const recipient = await getDbUserById(userId);
            if (!friendUser || !recipient) continue;
            if (friendUser.social_battery === "recharging") continue;
            const recipientTz = recipient.timezone || "America/New_York";
            const recipientHour = Number(
              new Intl.DateTimeFormat("en-US", {
                hour: "2-digit",
                hour12: false,
                timeZone: recipientTz,
              }).format(now),
            );
            // Quiet hours: don't send proactive nudges overnight in recipient local time.
            if (recipientHour < 9 || recipientHour >= 21) continue;

            // Re-filter using recipient's timezone for accurate day-of-week
            const recipientOverlaps = filterOverlapsToHangoutWindows([filteredOverlap], recipient.timezone);
            if (recipientOverlaps.length === 0) continue;
            const finalOverlap = recipientOverlaps[0];

            const overlapStart = new Date(finalOverlap.start);
            const windowStr = overlapStart.toLocaleDateString("en-US", { weekday: "long" }) +
              " " + overlapStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

            await createNotification({
              userId: userId,
              type: "calendar_match",
              title: `📅 You and ${friendUser.display_name?.split(" ")[0] || "a friend"} are both free this weekend`,
              body: `Looks like you're both available ${windowStr}. Want to make plans?`,
              relatedUserId: friendId,
            });
            usersNudgedToday.add(userId);
          }
        }
      }
    }
    console.log("Proactive weekend calendar matching complete");
  } catch (calMatchErr) {
    console.error("Error in proactive calendar matching:", calMatchErr);
  }
});

// ---------------------------------------------------------------------------
// Smart weekly nudge — texts users about their most overdue friend (max 1/week)
// ---------------------------------------------------------------------------
export const sendWeeklyNudges = onSchedule("every monday 10:00", async () => {
  const sb = getSupabase();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 86400000);

  // Get users with phone numbers who haven't opted out
  const { data: users } = await sb
    .from("users")
    .select("id, display_name, phone_number, social_battery, timezone")
    .not("phone_number", "is", null)
    .eq("onboarded", true);

  if (!users || users.length === 0) return;

  // Get opted-out phone numbers
  const { data: optOuts } = await sb.from("sms_opt_outs").select("phone_number");
  const optOutSet = new Set((optOuts || []).map((o: any) => o.phone_number));

  for (const user of users) {
    try {
      if (!user.phone_number || optOutSet.has(user.phone_number)) continue;
      if (user.social_battery === "recharging") continue;

      // Skip if user already has an upcoming meetup
      const { data: upcoming } = await sb
        .from("meetup_participants")
        .select("meetup_id, meetup:meetups(start_time, status)")
        .eq("user_id", user.id)
        .eq("rsvp", "accepted");

      const hasUpcoming = (upcoming || []).some((p: any) =>
        p.meetup?.status === "confirmed" && new Date(p.meetup.start_time) > now
      );
      if (hasUpcoming) continue;

      // Skip if we already nudged this user in the last 7 days
      const { data: recentNudge } = await sb
        .from("sms_pending_actions")
        .select("id")
        .eq("user_id", user.id)
        .eq("action_type", "nudge")
        .gte("created_at", oneWeekAgo.toISOString())
        .limit(1);

      if (recentNudge && recentNudge.length > 0) continue;

      // Find the most overdue friend (longest since last hangout relative to cadence)
      const { data: friendships } = await sb
        .from("friendships")
        .select("id, user_a_id, user_b_id")
        .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
        .eq("status", "accepted");

      if (!friendships || friendships.length === 0) continue;

      let mostOverdueFriend: { id: string; name: string; weeks: number } | null = null;

      for (const f of friendships) {
        const friendId = f.user_a_id === user.id ? f.user_b_id : f.user_a_id;

        // Get last hangout with this friend
        const { data: lastMeetup } = await sb
          .from("meetup_participants")
          .select("meetup_id, meetup:meetups(start_time, status)")
          .eq("user_id", user.id)
          .eq("rsvp", "accepted")
          .order("created_at", { ascending: false })
          .limit(20);

        // Find meetups where both users participated
        const { data: friendParts } = await sb
          .from("meetup_participants")
          .select("meetup_id")
          .eq("user_id", friendId)
          .eq("rsvp", "accepted");

        const friendMeetupIds = new Set((friendParts || []).map((p: any) => p.meetup_id));
        const sharedMeetups = (lastMeetup || []).filter((p: any) =>
          friendMeetupIds.has(p.meetup_id) &&
          p.meetup?.status !== "cancelled" &&
          new Date(p.meetup?.start_time) < now
        );

        let weeksSince = 4; // default if never hung out
        if (sharedMeetups.length > 0) {
          const latest = sharedMeetups[0];
          const daysSince = Math.floor((now.getTime() - new Date(latest.meetup.start_time).getTime()) / 86400000);
          weeksSince = Math.floor(daysSince / 7);
        }

        if (weeksSince < 2) continue; // Not overdue enough

        // Check 30-day cooldown — don't re-nudge about same friend
        const { data: recentFriendNudge } = await sb
          .from("sms_pending_actions")
          .select("id")
          .eq("user_id", user.id)
          .eq("action_type", "nudge")
          .contains("action_data", { friendId })
          .gte("created_at", new Date(now.getTime() - 30 * 86400000).toISOString())
          .limit(1);

        if (recentFriendNudge && recentFriendNudge.length > 0) continue;

        const { data: friendUser } = await sb
          .from("users")
          .select("display_name")
          .eq("id", friendId)
          .maybeSingle();

        const friendName = friendUser?.display_name?.split(" ")[0] || "your friend";

        if (!mostOverdueFriend || weeksSince > mostOverdueFriend.weeks) {
          mostOverdueFriend = { id: friendId, name: friendName, weeks: weeksSince };
        }
      }

      if (!mostOverdueFriend) continue;

      // Send the nudge
      const { sendSMS, createSMSAction, SMS_TEMPLATES } = await import("./utils/sms");
      await sendSMS(
        user.phone_number,
        SMS_TEMPLATES.nudge(mostOverdueFriend.name, mostOverdueFriend.weeks),
      );
      await createSMSAction(user.phone_number, user.id, "nudge", {
        friendId: mostOverdueFriend.id,
        friendName: mostOverdueFriend.name,
      });

      console.log(`[NUDGE] Sent to ${user.display_name}: "${mostOverdueFriend.name}" (${mostOverdueFriend.weeks} weeks)`);
    } catch (err) {
      console.error(`[NUDGE] Error for user ${user.id}:`, err);
    }
  }
});

// ---------------------------------------------------------------------------
// Email fallback — digest unread critical notifications older than 24h
// ---------------------------------------------------------------------------
export const sendEmailFallbacks = onSchedule("every 6 hours", async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: unreadNotifications } = await getSupabase()
    .from("notifications")
    .select("id, user_id, type, title, body, created_at")
    .eq("read", false)
    .lt("created_at", cutoff)
    .in("type", ["meetup_request", "friend_request", "meetup_counter_propose"])
    .limit(100);

  if (!unreadNotifications || unreadNotifications.length === 0) return;

  const byUser = new Map<string, typeof unreadNotifications>();
  for (const n of unreadNotifications) {
    const existing = byUser.get(n.user_id) || [];
    existing.push(n);
    byUser.set(n.user_id, existing);
  }

  for (const [userId, notifications] of byUser) {
    const { data: user } = await getSupabase()
      .from("users")
      .select("email, display_name")
      .eq("id", userId)
      .maybeSingle();

    if (!user?.email) continue;

    // TODO: Replace with actual email sending (SendGrid/SES)
    console.log(
      `[EMAIL_FALLBACK] Would send digest to ${user.email}: ${notifications.length} unread notification(s) — ` +
      notifications.map(n => `${n.type}: "${n.title}"`).join(", ")
    );
  }
});

// ---------------------------------------------------------------------------
// Recurring meetup checker — runs daily to find availability for standing hangouts
// ---------------------------------------------------------------------------
export const checkRecurringMeetups = onSchedule("every day 08:00", async () => {
  const sb = getSupabase();
  const now = new Date();

  const { data: recurring } = await sb
    .from("recurring_meetups")
    .select("*")
    .eq("is_active", true)
    .lte("next_check_at", now.toISOString());

  if (!recurring || recurring.length === 0) return;

  for (const rec of recurring) {
    try {
      const allParticipants: string[] = [rec.created_by, ...rec.participant_ids];

      // Check if there's already an upcoming meetup with the same title and participants
      const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString();
      const { data: existingMeetups } = await sb
        .from("meetups")
        .select("id")
        .eq("created_by", rec.created_by)
        .eq("title", rec.title)
        .gte("start_time", now.toISOString())
        .lte("start_time", nextWeek)
        .in("status", ["proposed", "confirmed"])
        .limit(1);

      if (existingMeetups && existingMeetups.length > 0) {
        // Already have an upcoming meetup — skip and advance next_check_at
        const intervalDays = rec.frequency === "weekly" ? 7 : rec.frequency === "biweekly" ? 14 : 30;
        await sb.from("recurring_meetups").update({
          next_check_at: new Date(now.getTime() + intervalDays * 86400000).toISOString(),
        }).eq("id", rec.id);
        continue;
      }

      // Fetch free slots for all participants
      const slotsByUser = await Promise.all(
        allParticipants.map((uid) =>
          sb
            .from("availability")
            .select("start_time, end_time")
            .eq("user_id", uid)
            .eq("status", "free")
            .gte("end_time", now.toISOString())
            .order("start_time")
            .then((r) => r.data || []),
        ),
      );

      // N-way overlap intersection
      let currentOverlaps: { start: string; end: string }[] = slotsByUser[0].map(
        (s) => ({ start: s.start_time, end: s.end_time }),
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
              if (durMin >= (rec.duration_min || 60)) {
                newOverlaps.push({ start, end });
              }
            }
          }
        }
        currentOverlaps = newOverlaps;
      }

      // Filter to preferred day/time if specified
      if (rec.preferred_day !== null && rec.preferred_day !== undefined) {
        currentOverlaps = currentOverlaps.filter((o) => new Date(o.start).getDay() === rec.preferred_day);
      }
      if (rec.preferred_time) {
        currentOverlaps = currentOverlaps.filter((o) => {
          const hour = new Date(o.start).getHours();
          if (rec.preferred_time === "morning") return hour >= 6 && hour < 12;
          if (rec.preferred_time === "afternoon") return hour >= 12 && hour < 17;
          if (rec.preferred_time === "evening") return hour >= 17 && hour < 22;
          return true;
        });
      }

      // If we found overlaps, notify the creator about the best slot
      if (currentOverlaps.length > 0) {
        const best = currentOverlaps[0];
        const startDt = new Date(best.start);
        const timeStr = startDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
          " at " + startDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

        await createNotification({
          userId: rec.created_by,
          type: "recurring_meetup",
          title: `🔄 Time found for "${rec.title}"`,
          body: `Everyone's free ${timeStr} — want to lock it in?`,
          relatedId: rec.id,
        });
      }

      // Update next_check_at based on frequency
      const intervalDays = rec.frequency === "weekly" ? 7 : rec.frequency === "biweekly" ? 14 : 30;
      await sb.from("recurring_meetups").update({
        next_check_at: new Date(now.getTime() + intervalDays * 86400000).toISOString(),
        last_scheduled_at: now.toISOString(),
      }).eq("id", rec.id);

    } catch (err) {
      console.error(`Recurring meetup ${rec.id} check failed:`, err);
    }
  }
});

// ---------------------------------------------------------------------------
// SMS Lifecycle Drip Messages (every 2 hours)
// ---------------------------------------------------------------------------
export const sendLifecycleMessages = onSchedule("every 2 hours", async () => {
  const sb = getSupabase();
  const { sendEngagementSMS } = await import("./utils/smsEngagement");

  const { data: users } = await sb
    .from("users")
    .select("id, display_name, phone_number, timezone, onboarded, created_at, invite_code")
    .not("phone_number", "is", null);

  if (!users || users.length === 0) return;

  const now = new Date();

  for (const user of users) {
    try {
      if (!user.phone_number) continue;
      const ageHours = (now.getTime() - new Date(user.created_at).getTime()) / 3600000;
      const firstName = user.display_name?.split(" ")[0] || "there";
      const inviteUrl = user.invite_code
        ? `https://slotted-ai.web.app/invite/${user.invite_code}`
        : `https://slotted-ai.web.app?ref=${user.id}`;

      // Day 0: Welcome (signed up in last 6 hours)
      if (ageHours < 6) {
        await sendEngagementSMS(
          user.id, user.phone_number, user.timezone || "America/New_York",
          "welcome",
          `📅 Welcome to Slotted, ${firstName}! I'll help you and your friends actually make plans. Connect your calendar: slotted-ai.web.app`,
        );
        continue;
      }

      // Day 0.5: Enable push notifications (12-24 hours, no FCM token)
      if (ageHours >= 12 && ageHours < 24) {
        const { data: fcmTokens } = await sb
          .from("fcm_tokens")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);

        if (!fcmTokens || fcmTokens.length === 0) {
          await sendEngagementSMS(
            user.id, user.phone_number, user.timezone || "America/New_York",
            "enable_push",
            `🔔 ${firstName}, turn on notifications so you don't miss when friends want to hang! Open Slotted and tap "Allow": slotted-ai.web.app/settings`,
          );
          continue;
        }
      }

      // Day 1: Invite a friend (24-48 hours, no friends yet)
      if (ageHours >= 24 && ageHours < 48) {
        const { data: friendships } = await sb
          .from("friendships")
          .select("id")
          .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
          .eq("status", "accepted")
          .limit(1);

        if (!friendships || friendships.length === 0) {
          await sendEngagementSMS(
            user.id, user.phone_number, user.timezone || "America/New_York",
            "invite_friend",
            `👋 Hey ${firstName}! Slotted works best with friends. Share your link and we'll find times to hang: ${inviteUrl}`,
          );
          continue;
        }
      }

      // Day 3: First meetup nudge (72-120 hours, has friends, no meetups)
      if (ageHours >= 72 && ageHours < 120) {
        const { data: friendships } = await sb
          .from("friendships")
          .select("id, user_a_id, user_b_id")
          .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
          .eq("status", "accepted")
          .limit(1);

        if (friendships && friendships.length > 0) {
          const { data: meetups } = await sb
            .from("meetup_participants")
            .select("id")
            .eq("user_id", user.id)
            .limit(1);

          if (!meetups || meetups.length === 0) {
            const friendId = friendships[0].user_a_id === user.id ? friendships[0].user_b_id : friendships[0].user_a_id;
            const { data: friend } = await sb.from("users").select("display_name").eq("id", friendId).maybeSingle();
            const friendName = friend?.display_name?.split(" ")[0] || "your friend";

            await sendEngagementSMS(
              user.id, user.phone_number, user.timezone || "America/New_York",
              "first_meetup",
              `📅 You and ${friendName} are on Slotted! Want to find a time to hang? Reply 1`,
              "nudge",
              { friendId, friendName },
            );
            continue;
          }
        }
      }

      // Day 7: Reactivation (168-240 hours, no recent activity)
      if (ageHours >= 168 && ageHours < 240) {
        const { data: recentMeetups } = await sb
          .from("meetup_participants")
          .select("meetup_id")
          .eq("user_id", user.id)
          .eq("rsvp", "accepted");

        const { data: recentNotifs } = await sb
          .from("notifications")
          .select("id")
          .eq("user_id", user.id)
          .eq("read", true)
          .gte("created_at", new Date(now.getTime() - 7 * 86400000).toISOString())
          .limit(1);

        if ((!recentMeetups || recentMeetups.length === 0) && (!recentNotifs || recentNotifs.length === 0)) {
          const { data: friendships } = await sb
            .from("friendships")
            .select("id, user_a_id, user_b_id")
            .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
            .eq("status", "accepted")
            .limit(1);

          if (friendships && friendships.length > 0) {
            const friendId = friendships[0].user_a_id === user.id ? friendships[0].user_b_id : friendships[0].user_a_id;
            const { data: friend } = await sb.from("users").select("display_name").eq("id", friendId).maybeSingle();
            const friendName = friend?.display_name?.split(" ")[0] || "your friend";

            await sendEngagementSMS(
              user.id, user.phone_number, user.timezone || "America/New_York",
              "reactivation",
              `👀 ${friendName} connected their calendar on Slotted! Find a time to hang: Reply 1`,
              "nudge",
              { friendId, friendName },
            );
          }
        }
      }

    } catch (err) {
      console.error(`[LIFECYCLE] Error for user ${user.id}:`, err);
    }
  }
});

// ---------------------------------------------------------------------------
// Monthly Recap SMS (1st of each month at 10am)
// ---------------------------------------------------------------------------
export const sendMonthlyRecap = onSchedule("1 of month 10:00", async () => {
  const sb = getSupabase();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setMonth(monthStart.getMonth() - 1);
  const monthEnd = new Date();
  monthEnd.setDate(0);

  const monthName = monthStart.toLocaleDateString("en-US", { month: "long" });

  const { data: users } = await sb
    .from("users")
    .select("id, display_name, invite_code")
    .eq("onboarded", true);

  if (!users || users.length === 0) return;

  for (const user of users) {
    try {
      const { data: parts } = await sb
        .from("meetup_participants")
        .select("meetup_id, meetup:meetups(start_time, status)")
        .eq("user_id", user.id)
        .eq("rsvp", "accepted");

      const hangouts = (parts || []).filter((p: any) => {
        const start = new Date(p.meetup?.start_time);
        return start >= monthStart && start <= monthEnd &&
          (p.meetup?.status === "confirmed" || p.meetup?.status === "completed");
      }).length;

      if (hangouts === 0) continue;

      const firstName = user.display_name?.split(" ")[0] || "there";

      await createNotification({
        userId: user.id,
        type: "calendar_match",
        title: `📊 Your ${monthName} recap`,
        body: `Nice work, ${firstName}! You hung out ${hangouts} time${hangouts > 1 ? "s" : ""} last month. Keep the momentum going — tap a friend to make plans!`,
      });

      console.log(`[RECAP] Sent notification to ${firstName}: ${hangouts} hangouts in ${monthName}`);
    } catch (err) {
      console.error(`[RECAP] Error for ${user.id}:`, err);
    }
  }
});

// ---------------------------------------------------------------------------
// Purge old suggestion_events (daily at 03:17 UTC)
// ---------------------------------------------------------------------------
// Enforces the 90-day retention policy declared in the schema for
// suggestion_events (which snapshots social_battery at suggestion time).
// Calls the SQL function `purge_old_suggestion_events()` installed via
// migrations/privacy_hardening.sql.
// ---------------------------------------------------------------------------
export const purgeOldSuggestionEvents = onSchedule(
  { schedule: "17 3 * * *", timeZone: "UTC" },
  async () => {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("purge_old_suggestion_events");
    if (error) {
      console.error("[PURGE] Failed to purge suggestion_events:", error);
      throw error;
    }
    const deleted = Array.isArray(data) && data.length > 0 ? data[0].deleted_count : 0;
    console.log(`[PURGE] Deleted ${deleted} suggestion_events older than 90 days`);
  }
);

// ---------------------------------------------------------------------------
// Export as Firebase Cloud Function
// ---------------------------------------------------------------------------
export const api = onRequest({ memory: "512MiB" }, app);
