import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import { createDAVClient, DAVCalendar, DAVObject } from "tsdav";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import { getSupabase } from "./supabase";

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
  console.error(
    `[FATAL] Missing required environment variables: ${missingVars.join(", ")}. ` +
    "Add them to functions/.env before deploying.",
  );
}

const GOOGLE_WEBHOOK_SECRET = process.env.GOOGLE_WEBHOOK_SECRET || "";

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
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting — generic per-key sliding-window limiter
// ---------------------------------------------------------------------------
function createRateLimiter(maxHits: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  // Periodically clean up stale entries to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter((t) => now - t < windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }, windowMs * 2);

  return (key: string): boolean => {
    const now = Date.now();
    const existing = hits.get(key) || [];
    const recent = existing.filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > maxHits;
  };
}

// Rate limiter tiers
const rateLimitRead = createRateLimiter(100, 60_000);    // 100 req/min
const rateLimitWrite = createRateLimiter(30, 60_000);     // 30 req/min
const rateLimitExpensive = createRateLimiter(5, 60_000);  // 5 req/min
const rateLimitPublic = createRateLimiter(30, 60_000);    // 30 req/min (unauthenticated)

// Expensive endpoints that should be heavily throttled
const EXPENSIVE_PATHS = new Set([
  "/calendar/sync",
  "/suggestions",
  "/events/suggest",
  "/events/discover",
  "/events/match",
  "/availability/group-overlap",
]);

function isExpensivePath(path: string): boolean {
  for (const p of EXPENSIVE_PATHS) {
    if (path === p || path.startsWith(p + "/")) return true;
  }
  return false;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip || "unknown";
}

// Rate limit middleware — applied after auth so we have req.uid
function rateLimitMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const uid = req.uid || getClientIp(req);
  const method = req.method;
  const path = req.path;

  if (isExpensivePath(path)) {
    if (rateLimitExpensive(uid)) {
      res.status(429).json({ error: "Too many requests to this endpoint. Please wait a minute." });
      return;
    }
  } else if (method === "GET" || method === "HEAD") {
    if (rateLimitRead(uid)) {
      res.status(429).json({ error: "Too many requests. Please slow down." });
      return;
    }
  } else {
    if (rateLimitWrite(uid)) {
      res.status(429).json({ error: "Too many write requests. Please slow down." });
      return;
    }
  }
  next();
}

// Strip /api prefix so routes work both directly and through Firebase Hosting rewrites
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    req.url = req.url.replace(/^\/api/, "");
  }
  next();
});

// ---------------------------------------------------------------------------
// Request logging middleware — logs method, path, status, and duration
// ---------------------------------------------------------------------------
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
    // Apply per-user rate limiting after auth
    rateLimitMiddleware(req, res, next);
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

/** Helper: get all accepted friend user IDs for a user */
async function getAcceptedFriendIdSet(userId: string): Promise<Set<string>> {
  const { data, error } = await getSupabase()
    .from("friendships")
    .select("user_a_id, user_b_id")
    .eq("status", "accepted")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

  if (error || !data) return new Set<string>();

  const ids = new Set<string>();
  for (const f of data as Array<{ user_a_id: string; user_b_id: string }>) {
    ids.add(f.user_a_id === userId ? f.user_b_id : f.user_a_id);
  }
  return ids;
}

/** Helper: true if user is a participant of the given meetup */
async function isMeetupParticipant(meetupId: string, userId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("meetup_participants")
    .select("meetup_id")
    .eq("meetup_id", meetupId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}

// ---------------------------------------------------------------------------
// Health check (public)
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "slotted-api", timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Auto-add meetup to user's calendar (Google + Apple, background, best-effort)
// ---------------------------------------------------------------------------
async function autoAddToCalendar(firebaseUid: string, meetup: {
  id: string;
  title?: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
}) {
  try {
    const dbUser = await getDbUser(firebaseUid);
    if (!dbUser) return;

    const sb = getSupabase();

    // Check if already added (avoid duplicates)
    const { data: existingPart } = await sb
      .from("meetup_participants")
      .select("google_event_id")
      .eq("meetup_id", meetup.id)
      .eq("user_id", dbUser.id)
      .single();

    if (existingPart?.google_event_id) return; // already on calendar

    // Get participant info for the event description
    const { data: parts } = await sb
      .from("meetup_participants")
      .select("user_id")
      .eq("meetup_id", meetup.id);

    const partUserIds = (parts || []).map((p: any) => p.user_id);
    const { data: partUsers } = partUserIds.length > 0
      ? await sb.from("users").select("display_name, email").in("id", partUserIds)
      : { data: [] };

    const attendees = (partUsers || [])
      .filter((u: any) => u.email !== dbUser.email)
      .map((u: any) => ({ email: u.email, displayName: u.display_name }));

    const eventTitle = meetup.title || "Hangout";
    const eventDescription = meetup.description || `Scheduled via Slotted with ${attendees.map((a: any) => a.displayName).join(", ")}`;

    let addedEventId: string | null = null;

    // ─── Try Google Calendar first ───
    if (dbUser.google_refresh_token) {
      try {
        const oauth2 = await getAuthedCalendarClient(firebaseUid);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
          const gcalEvent = await calendarApi.events.insert({
            calendarId: "primary",
            requestBody: {
              summary: eventTitle,
              description: eventDescription,
              location: meetup.location || undefined,
              start: {
                dateTime: meetup.start_time,
                timeZone: dbUser.timezone || "America/New_York",
              },
              end: {
                dateTime: meetup.end_time,
                timeZone: dbUser.timezone || "America/New_York",
              },
              reminders: {
                useDefault: false,
                overrides: [
                  { method: "popup", minutes: 60 },
                  { method: "popup", minutes: 15 },
                ],
              },
            },
          });
          addedEventId = gcalEvent.data.id || null;
          console.log(`📅 Auto-added meetup ${meetup.id} to ${dbUser.email}'s Google Calendar`);
        }
      } catch (err) {
        console.error(`Google auto-add failed for ${dbUser.email}:`, err);
      }
    }

    // ─── Try Apple Calendar if Google didn't work ───
    if (!addedEventId && dbUser.apple_calendar_connected && dbUser.apple_caldav_username && dbUser.apple_caldav_password) {
      try {
        const uid = `slotted-${meetup.id}-${dbUser.id}@slotted-ai.web.app`;
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

        const client = await createDAVClient({
          serverUrl: "https://caldav.icloud.com",
          credentials: {
            username: dbUser.apple_caldav_username,
            password: dbUser.apple_caldav_password,
          },
          authMethod: "Basic",
          defaultAccountType: "caldav",
        });

        await client.createCalendarObject({
          calendar: { url: `https://caldav.icloud.com/${dbUser.apple_caldav_username}/calendars/home/` } as DAVCalendar,
          filename: `${uid}.ics`,
          iCalString: icsContent,
        });

        addedEventId = uid;
        console.log(`🍎 Auto-added meetup ${meetup.id} to ${dbUser.email}'s Apple Calendar`);
      } catch (err) {
        console.error(`Apple auto-add failed for ${dbUser.email}:`, err);
      }
    }

    // ─── Try Outlook Calendar if Google/Apple didn't work ───
    if (!addedEventId && dbUser.outlook_calendar_connected && dbUser.outlook_refresh_token) {
      try {
        const graphClient = await getOutlookGraphClient(firebaseUid);
        if (graphClient) {
          const outlookEvent = await graphClient.api("/me/events").post({
            subject: eventTitle,
            body: { contentType: "text", content: eventDescription },
            start: {
              dateTime: meetup.start_time,
              timeZone: dbUser.timezone || "America/New_York",
            },
            end: {
              dateTime: meetup.end_time,
              timeZone: dbUser.timezone || "America/New_York",
            },
            location: meetup.location ? { displayName: meetup.location } : undefined,
            reminderMinutesBeforeStart: 15,
            isReminderOn: true,
          });
          addedEventId = outlookEvent.id;
          console.log(`📅 Auto-added meetup ${meetup.id} to ${dbUser.email}'s Outlook Calendar`);
        }
      } catch (err) {
        console.error(`Outlook auto-add failed for ${dbUser.email}:`, err);
      }
    }

    // Store the event ID on the participant row
    if (addedEventId) {
      try {
        await sb
          .from("meetup_participants")
          .update({ google_event_id: addedEventId })
          .eq("meetup_id", meetup.id)
          .eq("user_id", dbUser.id);
      } catch { /* column may not exist */ }
    }
  } catch (err) {
    console.error(`Failed to auto-add meetup to calendar for ${firebaseUid}:`, err);
  }
}

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
  // Deduplication: check relatedUserId FIRST (broadest match), then relatedId,
  // then title fallback. This prevents duplicates when different code paths
  // create the same logical notification with/without a relatedId.
  const sb = getSupabase();

  // Primary dedup: same user+type+relatedUserId within 1 hour
  if (opts.relatedUserId) {
    const cutoff = new Date(Date.now() - 60 * 60000).toISOString();
    const { data: recent } = await sb
      .from("notifications")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("type", opts.type)
      .eq("related_user_id", opts.relatedUserId)
      .gte("created_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) {
      console.log(`Skipping duplicate notification: ${opts.type} for user ${opts.userId} (related_user_id=${opts.relatedUserId})`);
      return;
    }
  }

  // Secondary dedup: same user+type+relatedId within 5 minutes (covers retries)
  if (opts.relatedId) {
    const cutoff = new Date(Date.now() - 5 * 60000).toISOString();
    const { data: recent } = await sb
      .from("notifications")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("type", opts.type)
      .eq("related_id", opts.relatedId)
      .gte("created_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) {
      console.log(`Skipping duplicate notification: ${opts.type} for user ${opts.userId} (related_id=${opts.relatedId})`);
      return;
    }
  }

  // Fallback dedup: same user+type+title within 10 minutes
  if (!opts.relatedUserId && !opts.relatedId) {
    const cutoff = new Date(Date.now() - 10 * 60000).toISOString();
    const { data: recent } = await sb
      .from("notifications")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("type", opts.type)
      .eq("title", opts.title)
      .gte("created_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) {
      console.log(`Skipping duplicate notification: ${opts.type} for user ${opts.userId} (title match)`);
      return;
    }
  }

  // Exact-match dedup: same payload within 24h (handles retries/races with identical content)
  {
    const cutoff = new Date(Date.now() - 24 * 60 * 60000).toISOString();
    let query = sb
      .from("notifications")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("type", opts.type)
      .eq("title", opts.title)
      .eq("body", opts.body)
      .gte("created_at", cutoff)
      .limit(1);

    query = opts.relatedUserId
      ? query.eq("related_user_id", opts.relatedUserId)
      : query.is("related_user_id", null);
    query = opts.relatedId
      ? query.eq("related_id", opts.relatedId)
      : query.is("related_id", null);

    const { data: exactRecent } = await query;
    if (exactRecent && exactRecent.length > 0) {
      console.log(`Skipping duplicate notification: ${opts.type} for user ${opts.userId} (exact payload match)`);
      return;
    }
  }

  const { error } = await sb.from("notifications").insert({
    user_id: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    related_user_id: opts.relatedUserId || null,
    related_id: opts.relatedId || null,
  });
  if (error) {
    // Unique index violation = duplicate caught at DB level — not a real error
    if (error.code === "23505") {
      console.log(`Skipping duplicate notification (DB constraint): ${opts.type} for user ${opts.userId}`);
      return;
    }
    console.error("Failed to create notification:", error.message);
    return;
  }

  // Post-insert race-condition cleanup: if concurrent inserts slipped past the
  // pre-check (TOCTOU), keep the oldest and delete extras.
  if (opts.relatedUserId) {
    const cutoff = new Date(Date.now() - 60 * 60000).toISOString();
    const { data: dupes } = await sb
      .from("notifications")
      .select("id, created_at")
      .eq("user_id", opts.userId)
      .eq("type", opts.type)
      .eq("related_user_id", opts.relatedUserId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true });
    if (dupes && dupes.length > 1) {
      const idsToDelete = dupes.slice(1).map((d: any) => d.id);
      await sb.from("notifications").delete().in("id", idsToDelete);
      console.log(`Cleaned up ${idsToDelete.length} duplicate notification(s): ${opts.type} for user ${opts.userId}`);
    }
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

    // For meetup-related notifications, look up the user's current RSVP status
    // and the meetup's current status so we can hide stale notifications
    const notifications = data || [];
    const meetupNotifications = notifications.filter(
      (n: any) => ["meetup_request", "meetup_confirmed", "meetup_reminder"].includes(n.type) && n.related_id,
    );
    if (meetupNotifications.length > 0) {
      const meetupIds = [...new Set(meetupNotifications.map((n: any) => n.related_id))];
      const { data: myRsvps } = await getSupabase()
        .from("meetup_participants")
        .select("meetup_id, rsvp")
        .eq("user_id", me.id)
        .in("meetup_id", meetupIds);

      // Also fetch meetup statuses to filter out cancelled/didnt_happen meetups
      const { data: meetups } = await getSupabase()
        .from("meetups")
        .select("id, status")
        .in("id", meetupIds);

      const rsvpMap = new Map((myRsvps || []).map((r: any) => [r.meetup_id, r.rsvp]));
      const meetupStatusMap = new Map((meetups || []).map((m: any) => [m.id, m.status]));

      for (const n of notifications) {
        if (n.related_id && rsvpMap.has(n.related_id)) {
          (n as any).my_rsvp = rsvpMap.get(n.related_id);
        }
        if (n.type === "meetup_request" && n.related_id && !rsvpMap.has(n.related_id)) {
          (n as any).my_rsvp = "pending";
        }
        if (n.related_id && meetupStatusMap.has(n.related_id)) {
          (n as any).meetup_status = meetupStatusMap.get(n.related_id);
        }
      }
    }

    // Filter out notifications for meetups that have been cancelled/didnt_happen
    // and hide meetup_request notifications when a meetup_confirmed exists for the same meetup
    const confirmedMeetupIds = new Set(
      notifications.filter((n: any) => n.type === "meetup_confirmed" && n.related_id).map((n: any) => n.related_id),
    );
    const filtered = notifications.filter((n: any) => {
      // Hide notifications for cancelled/didnt_happen meetups
      if (["didnt_happen", "cancelled"].includes((n as any).meetup_status)) return false;
      // Hide meetup notifications if I've declined the meetup
      if ((n as any).my_rsvp === "declined" && ["meetup_confirmed", "meetup_request", "meetup_reminder"].includes(n.type)) return false;
      // Hide meetup_request if a meetup_confirmed notification exists for the same meetup
      if (n.type === "meetup_request" && n.related_id && confirmedMeetupIds.has(n.related_id)) return false;
      return true;
    });

    // Collapse accidental duplicates (same content/context) and keep the newest item only
    const seen = new Set<string>();
    const deduped = filtered.filter((n: any) => {
      const key = [
        n.type || "",
        n.related_user_id || "",
        n.related_id || "",
        n.title || "",
        n.body || "",
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json(deduped);
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

/** DELETE /notifications/:id — dismiss/delete a notification */
app.delete("/notifications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { error } = await getSupabase()
      .from("notifications")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", me.id);

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
          .select("inviter_id, group_id")
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

          // Auto-add to any groups from pending invites
          const groupIdsToJoin = [...new Set(
            pendingRows
              .filter((r: any) => r.group_id)
              .map((r: any) => r.group_id)
          )];
          for (const groupId of groupIdsToJoin) {
            try {
              await getSupabase()
                .from("friend_group_members")
                .upsert(
                  { group_id: groupId, user_id: data.id },
                  { onConflict: "group_id,user_id" },
                );
            } catch (groupErr) {
              console.error(`Failed to auto-add user to group ${groupId}:`, groupErr);
            }
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

    // Enrich with hangout cadence data from meetup_logs
    const acceptedFriendIds = friends
      .filter((f: any) => f.status === "accepted")
      .map((f: any) => f.friend.id);

    if (acceptedFriendIds.length > 0) {
      const { data: logs } = await getSupabase()
        .from("meetup_logs")
        .select("friend_id, hangout_date, created_at")
        .eq("user_id", me.id)
        .in("friend_id", acceptedFriendIds)
        .order("hangout_date", { ascending: true, nullsFirst: false });

      if (logs && logs.length > 0) {
        // Group logs by friend_id
        const logsByFriend = new Map<string, string[]>();
        for (const log of logs) {
          const fid = log.friend_id;
          const date = log.hangout_date || log.created_at;
          if (!fid || !date) continue;
          if (!logsByFriend.has(fid)) logsByFriend.set(fid, []);
          logsByFriend.get(fid)!.push(date);
        }

        // Compute cadence per friend
        for (const f of friends as any[]) {
          const dates = logsByFriend.get(f.friend.id);
          if (!dates || dates.length === 0) continue;

          // Sort dates ascending
          const sorted = dates.map((d: string) => new Date(d).getTime()).sort((a: number, b: number) => a - b);
          const lastDate = new Date(sorted[sorted.length - 1]);
          f.lastHangoutDate = lastDate.toISOString();
          f.daysSinceLastHangout = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
          f.totalHangouts = sorted.length;

          // Compute average cadence (days between hangouts) if 2+ hangouts
          if (sorted.length >= 2) {
            const intervals: number[] = [];
            for (let i = 1; i < sorted.length; i++) {
              intervals.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24));
            }
            f.avgCadenceDays = Math.round(intervals.reduce((a: number, b: number) => a + b, 0) / intervals.length);
          }
        }
      }
    }

    res.json({ friends });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /friends/invite — send a friend invite by email or userId */
app.post("/friends/invite", requireAuth, async (req: AuthRequest, res: Response) => {
  const { email, userId, hangoutPref } = req.body;
  if (!email && !userId) {
    res.status(400).json({ error: "Email or userId is required" });
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

    // Find the invitee — by userId or email
    let invitee: any = null;
    if (userId) {
      const { data } = await getSupabase()
        .from("users")
        .select("id, neighborhood, display_name, email")
        .eq("id", userId)
        .single();
      invitee = data;
      if (!invitee) {
        res.status(404).json({ error: "User not found" });
        return;
      }
    } else {
      const { data } = await getSupabase()
        .from("users")
        .select("id, neighborhood")
        .eq("email", email)
        .single();
      invitee = data;
    }

    if (!invitee) {
      if (!email) {
        res.status(404).json({ error: "User not found" });
        return;
      }
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
    const myNeighborhood = (me.neighborhood || '');
    const theirNeighborhood = (invitee.neighborhood || '');
    let defaultFriendshipType = 'local';
    
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
    const myNeighborhood = (me.neighborhood || '');
    const theirNeighborhood = (referrer.neighborhood || '');
    let defaultFriendshipType = 'local';
    
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

    // Notify the referrer — createNotification handles dedup internally
    if (data) {
      await createNotification({
        userId: referrer.id,
        type: "friend_accepted",
        title: "New friend connected!",
        body: `${me.display_name || me.email} joined Slotted via your invite and you're now connected.`,
        relatedUserId: me.id,
        relatedId: data.id,
      });
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

    // Notify the inviter when their invite is accepted — createNotification handles dedup
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

// DELETE /friends/:friendshipId — Remove a friend (with confirmation on frontend)
app.delete("/friends/:friendshipId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { friendshipId } = req.params;
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // Verify the friendship exists and belongs to this user
    const { data: friendship, error: fetchErr } = await getSupabase()
      .from("friendships")
      .select("id, user_a_id, user_b_id")
      .eq("id", friendshipId)
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
      .single();

    if (fetchErr || !friendship) {
      res.status(404).json({ error: "Friendship not found" });
      return;
    }

    const otherUserId = friendship.user_a_id === me.id ? friendship.user_b_id : friendship.user_a_id;

    // Delete the friendship
    const { error: delErr } = await getSupabase()
      .from("friendships")
      .delete()
      .eq("id", friendshipId);

    if (delErr) {
      res.status(500).json({ error: delErr.message });
      return;
    }

    // Remove notifications that are specifically about this friendship/user pair
    await getSupabase()
      .from("notifications")
      .delete()
      .eq("user_id", me.id)
      .eq("related_user_id", otherUserId);

    await getSupabase()
      .from("notifications")
      .delete()
      .eq("user_id", otherUserId)
      .eq("related_user_id", me.id);

    await getSupabase()
      .from("notifications")
      .delete()
      .in("user_id", [me.id, otherUserId])
      .eq("related_id", friendshipId);

    res.json({ success: true });
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
  const syncStart = Date.now();
  const dbUser = await getDbUser(firebaseUid);
  if (!dbUser) return { synced: false, slots: 0 };

  const hasGoogle = !!dbUser.google_refresh_token;
  const hasApple = !!(dbUser.apple_calendar_connected && dbUser.apple_caldav_username && dbUser.apple_caldav_password);
  const hasOutlook = !!(dbUser.outlook_calendar_connected && dbUser.outlook_refresh_token);

  if (!hasGoogle && !hasApple && !hasOutlook) return { synced: false, slots: 0 };

  const sb = getSupabase();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const allBusyBlocks: { start: string; end: string }[] = [];
  const syncProviders: string[] = [];
  if (hasGoogle) syncProviders.push("google");
  if (hasApple) syncProviders.push("apple");
  if (hasOutlook) syncProviders.push("outlook");

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
        const isPrimaryCal = calId === "primary" || calId === dbUser.email;
        const listParams: calendar_v3.Params$Resource$Events$List = {
          calendarId: calId,
          timeMin: now.toISOString(),
          timeMax: windowEnd.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 500,
          fields: "items(start,end,status,transparency),nextSyncToken",
        };

        const fetchEvents = async (useSyncToken: boolean) => {
          const params: calendar_v3.Params$Resource$Events$List = { ...listParams };
          if (useSyncToken && dbUser.calendar_sync_token) {
            params.syncToken = dbUser.calendar_sync_token;
          }
          const eventsRes = await calendarApi.events.list(params);
          if (isPrimaryCal && eventsRes.data.nextSyncToken) {
            await sb
              .from("users")
              .update({ calendar_sync_token: eventsRes.data.nextSyncToken })
              .eq("id", dbUser.id);
          }
          return eventsRes;
        };

        try {
          const eventsRes = await fetchEvents(isPrimaryCal && !!dbUser.calendar_sync_token);

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
        } catch (err: any) {
          if (isPrimaryCal && dbUser.calendar_sync_token && err?.code === 410) {
            await sb
              .from("users")
              .update({ calendar_sync_token: null })
              .eq("id", dbUser.id);
            try {
              const retryRes = await fetchEvents(false);
              for (const event of retryRes.data.items || []) {
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
            } catch (retryErr) {
              console.error(`Failed to fetch Google calendar ${calId}:`, retryErr);
            }
          } else {
            console.error(`Failed to fetch Google calendar ${calId}:`, err);
          }
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

  // --- Outlook Calendar sync ---
  if (hasOutlook) {
    try {
      const graphClient = await getOutlookGraphClient(firebaseUid);
      if (graphClient) {
        const { data: selectedOutlookCals } = await sb
          .from("user_calendars")
          .select("calendar_id")
          .eq("user_id", dbUser.id)
          .eq("is_selected", true)
          .eq("source", "outlook");

        for (const cal of selectedOutlookCals || []) {
          try {
            const eventsRes = await graphClient
              .api(`/me/calendars/${cal.calendar_id}/calendarView`)
              .query({
                startDateTime: now.toISOString(),
                endDateTime: windowEnd.toISOString(),
              })
              .select("subject,start,end,showAs,isCancelled")
              .top(500)
              .get();

            for (const event of eventsRes.value || []) {
              if (event.isCancelled || event.showAs === "free" || event.showAs === "unknown") continue;
              const startDt = event.start?.dateTime;
              const endDt = event.end?.dateTime;
              if (!startDt || !endDt) continue;
              const tz = event.start?.timeZone || "UTC";
              allBusyBlocks.push({
                start: tz === "UTC" ? new Date(startDt + "Z").toISOString() : new Date(startDt).toISOString(),
                end: tz === "UTC" ? new Date(endDt + "Z").toISOString() : new Date(endDt).toISOString(),
              });
            }
          } catch (err) {
            console.error(`Failed to fetch Outlook events for calendar ${cal.calendar_id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("Failed to sync Outlook Calendar:", err);
    }
  }

  // --- Manual busy blocks ---
  {
    const { data: manualBlocks } = await sb
      .from("manual_busy_blocks")
      .select("start_time, end_time")
      .eq("user_id", dbUser.id)
      .gte("end_time", now.toISOString())
      .lte("start_time", windowEnd.toISOString());

    if (manualBlocks && manualBlocks.length > 0) {
      for (const block of manualBlocks) {
        allBusyBlocks.push({
          start: new Date(block.start_time).toISOString(),
          end: new Date(block.end_time).toISOString(),
        });
      }
      console.log(`📝 Added ${manualBlocks.length} manual busy blocks for user ${dbUser.id}`);
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

  // Generate free blocks: invert busy within 8am–9pm each day (user's timezone)
  // Note: 9pm (21:00) not 10pm — most people don't want social plans at 10pm
  const tz = dbUser.timezone || "America/New_York";
  const freeBlocks: { start: string; end: string }[] = [];

  for (let d = 0; d < SYNC_WINDOW_DAYS; d++) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() + d);

    // Calculate 8am and 9pm in the user's timezone
    const dayStr = dayStart.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
    const dayOpen = new Date(`${dayStr}T08:00:00`);
    const dayClose = new Date(`${dayStr}T21:00:00`);

    // Convert to UTC using timezone offset estimation
    const utcOpen = zonedToUtc(dayStr, "08:00", tz);
    const utcClose = zonedToUtc(dayStr, "21:00", tz);

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

  console.log(`📅 Synced ${freeBlocks.length} free blocks for user ${dbUser.id} (${Date.now() - syncStart}ms)`);

  // Log sync outcome per provider
  const durationMs = Date.now() - syncStart;
  for (const provider of syncProviders) {
    sb.from("sync_log").insert({
      user_id: dbUser.id,
      provider,
      status: "success",
      slots_synced: freeBlocks.length,
      duration_ms: durationMs,
    }).then(null, () => { /* best-effort logging */ });
  }

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
// Helpers: Call-Window → Synthetic Free Slots
// ---------------------------------------------------------------------------

/**
 * Generate synthetic free-slot entries from a user's call_windows over the
 * next SYNC_WINDOW_DAYS days.  Returns objects shaped like availability rows
 * ({ start_time, end_time }) so they can be merged directly into calendar-
 * synced free slots before computing overlaps.
 */
function generateCallWindowSlots(
  callWindows: { day: number; start: string; end: string; label?: string }[] | null | undefined,
  timezone: string | null | undefined,
): { start_time: string; end_time: string }[] {
  if (!callWindows || callWindows.length === 0) return [];
  const tz = timezone || "America/New_York";
  const now = new Date();
  const slots: { start_time: string; end_time: string }[] = [];

  for (let d = 0; d < SYNC_WINDOW_DAYS; d++) {
    const day = new Date(now.getTime() + d * 86400000);
    const dayStr = day.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
    const weekdayNum = new Date(
      day.toLocaleString("en-US", { timeZone: tz }),
    ).getDay();

    for (const cw of callWindows) {
      if (cw.day !== weekdayNum) continue;
      const startUtc = zonedToUtc(dayStr, cw.start, tz);
      const endUtc = zonedToUtc(dayStr, cw.end, tz);
      if (startUtc >= endUtc || startUtc < now) continue;
      slots.push({ start_time: startUtc.toISOString(), end_time: endUtc.toISOString() });
    }
  }
  return slots;
}

/**
 * Merge synthetic call-window slots into calendar-synced free slots.
 * Adds windows that don't already overlap with existing free blocks.
 */
function mergeCallWindowSlots(
  calendarSlots: { start_time: string; end_time: string }[],
  cwSlots: { start_time: string; end_time: string }[],
): { start_time: string; end_time: string }[] {
  if (cwSlots.length === 0) return calendarSlots;
  const merged = [...calendarSlots];
  for (const cw of cwSlots) {
    const alreadyCovered = calendarSlots.some(
      (s) => s.start_time <= cw.start_time && s.end_time >= cw.end_time,
    );
    if (!alreadyCovered) {
      merged.push(cw);
    }
  }
  merged.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return merged;
}

// ---------------------------------------------------------------------------
// Helpers: Travel Buffer, Weekly Quota, Planning Horizon
// ---------------------------------------------------------------------------

/**
 * Apply travel buffer to free slots — shrink each slot by `bufferMin` on both ends.
 * If the resulting slot is shorter than `minDurationMin`, discard it.
 */
/**
 * Round a timestamp UP to the next :00 or :30 boundary.
 */
function ceilToHalfHour(iso: string): string {
  const dt = new Date(iso);
  const min = dt.getMinutes();
  if (min === 0 || min === 30) return dt.toISOString();
  if (min < 30) {
    dt.setMinutes(30, 0, 0);
  } else {
    dt.setMinutes(0, 0, 0);
    dt.setHours(dt.getHours() + 1);
  }
  return dt.toISOString();
}

/**
 * Round a timestamp DOWN to the previous :00 or :30 boundary.
 */
function floorToHalfHour(iso: string): string {
  const dt = new Date(iso);
  const min = dt.getMinutes();
  if (min === 0 || min === 30) return dt.toISOString();
  if (min < 30) {
    dt.setMinutes(0, 0, 0);
  } else {
    dt.setMinutes(30, 0, 0);
  }
  return dt.toISOString();
}

/**
 * Round overlaps to clean :00/:30 boundaries and filter out slots < minDuration.
 */
function roundOverlaps(
  overlaps: { start: string; end: string }[],
  minDurationMin = 30,
): { start: string; end: string }[] {
  return overlaps
    .map((o) => ({ start: ceilToHalfHour(o.start), end: floorToHalfHour(o.end) }))
    .filter((o) => {
      const durMin = (new Date(o.end).getTime() - new Date(o.start).getTime()) / 60000;
      return durMin >= minDurationMin;
    });
}

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
    case "night":     return { start: 20, end: 21 }; // narrow: sync engine caps at 9pm
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

// ---------------------------------------------------------------------------
// Default Hangout Windows — restricts suggestions to socially appropriate times
// Adjust these to change when Slotted suggests meetup times.
// Day-of-week: 0=Sun, 1=Mon … 5=Fri, 6=Sat. Empty array = no suggestions.
// ---------------------------------------------------------------------------
const DEFAULT_HANGOUT_WINDOWS: Record<number, { startHour: number; endHour: number }[]> = {
  0: [{ startHour: 9, endHour: 17 }],   // Sunday 9 AM – 5 PM
  1: [],                                  // Monday — none
  2: [],                                  // Tuesday — none
  3: [],                                  // Wednesday — none
  4: [],                                  // Thursday — none
  5: [{ startHour: 17, endHour: 23 }],   // Friday 5 PM – 11 PM
  6: [{ startHour: 9, endHour: 23 }],    // Saturday 9 AM – 11 PM
};

/**
 * Filter overlap slots to only include portions within the default hangout windows.
 * Uses the provided timezone (or America/New_York fallback) to determine day-of-week.
 */
function filterOverlapsToHangoutWindows(
  overlaps: { start: string; end: string }[],
  timezone?: string | null,
): { start: string; end: string }[] {
  const tz = timezone || "America/New_York";
  const result: { start: string; end: string }[] = [];

  for (const slot of overlaps) {
    const startDt = new Date(slot.start);
    const endDt = new Date(slot.end);

    const weekdayNum = new Date(
      startDt.toLocaleString("en-US", { timeZone: tz }),
    ).getDay();

    const windows = DEFAULT_HANGOUT_WINDOWS[weekdayNum];
    if (!windows || windows.length === 0) continue;

    const dateStr = startDt.toLocaleDateString("en-CA", { timeZone: tz });

    for (const win of windows) {
      const winStartUtc = zonedToUtc(dateStr, `${String(win.startHour).padStart(2, "0")}:00`, tz);
      const winEndUtc = zonedToUtc(dateStr, `${String(win.endHour).padStart(2, "0")}:00`, tz);

      const clampedStart = startDt > winStartUtc ? startDt : winStartUtc;
      const clampedEnd = endDt < winEndUtc ? endDt : winEndUtc;

      if (clampedStart < clampedEnd) {
        const durMin = (clampedEnd.getTime() - clampedStart.getTime()) / 60000;
        if (durMin >= 30) {
          result.push({
            start: clampedStart.toISOString(),
            end: clampedEnd.toISOString(),
          });
        }
      }
    }
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
 * Map preferred_duration setting to minutes.
 * Returns { min, ideal, max } in minutes.
 */
function durationToMinutes(pref: string | null | undefined): { min: number; ideal: number; max: number } {
  switch (pref) {
    case "quick":    return { min: 30,  ideal: 45,  max: 60 };
    case "medium":   return { min: 60,  ideal: 90,  max: 120 };
    case "long":     return { min: 120, ideal: 180, max: 240 };
    case "half-day": return { min: 240, ideal: 300, max: 480 };
    default:         return { min: 60,  ideal: 90,  max: 120 }; // default = medium
  }
}

/**
 * Map preferred_call_duration setting to minutes.
 */
function callDurationToMinutes(pref: string | null | undefined): { min: number; ideal: number; max: number } {
  switch (pref) {
    case "quick":  return { min: 10,  ideal: 15,  max: 20 };
    case "medium": return { min: 30,  ideal: 45,  max: 60 };
    case "long":   return { min: 60,  ideal: 90,  max: 120 };
    case "none":   return { min: 0,   ideal: 0,   max: 0 };
    default:       return { min: 30,  ideal: 45,  max: 60 }; // default = medium
  }
}

/**
 * Resolve effective duration preference across multiple participants.
 * If both set → use shorter. If one set → use theirs. If neither → default.
 */
function resolveGroupDuration(
  profiles: (any | null | undefined)[],
  isCallMode: boolean,
): { min: number; ideal: number; max: number } {
  const mapper = isCallMode ? callDurationToMinutes : durationToMinutes;
  const field = isCallMode ? "preferred_call_duration" : "preferred_duration";

  const prefs = profiles
    .map((p) => p?.[field])
    .filter((v): v is string => !!v && v !== "none");

  if (prefs.length === 0) return mapper(undefined); // default

  // Use the shortest preference (most conservative)
  const durations = prefs.map((p) => mapper(p));
  durations.sort((a, b) => a.ideal - b.ideal);
  return durations[0];
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

  // Resolve preferred duration across all participants
  const isCallModeGlobal = mode === "phone" || mode === "video";
  const effectiveDuration = resolveGroupDuration(
    [userProfile, ...friendProfiles],
    isCallModeGlobal,
  );

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

    // 1. Duration scoring — uses participants' preferred duration settings
    //    effectiveDuration = shortest preference among all participants (or default "medium")
    if (isCallMode) {
      if (effectiveDuration.ideal === 0) {
        // Someone prefers no calls
        score -= 20;
        reasons.push("Someone doesn't do calls");
      } else if (durationMin >= effectiveDuration.min && durationMin <= effectiveDuration.max) {
        score += 15;
        reasons.push("Perfect call length");
      } else if (durationMin > effectiveDuration.max) {
        score += 8;
        reasons.push("Plenty of time for a call");
      } else if (durationMin >= effectiveDuration.min * 0.7) {
        score += 5;
        reasons.push("Quick catch-up window");
      }
    } else if (participantIds.length >= 2) {
      // Group hangouts: use preferred duration but with a group floor of 60 min
      const groupIdeal = Math.max(effectiveDuration.ideal, 90);
      const groupMin = Math.max(effectiveDuration.min, 60);
      if (durationMin >= groupIdeal && durationMin <= groupIdeal * 1.5) {
        score += 25;
        reasons.push("Ideal group window");
      } else if (durationMin > groupIdeal * 1.5) {
        score += 20;
        reasons.push("Lots of time");
      } else if (durationMin >= groupMin) {
        score += 12;
        reasons.push(`${Math.round(durationMin / 60 * 10) / 10} hr window`);
      } else if (durationMin >= 45) {
        score += 5;
        reasons.push("Tight for a group");
      } else {
        score -= 15;
        reasons.push("Too short for a group hangout");
      }
    } else {
      // 1-to-1 in-person: score based on preferred duration
      if (durationMin >= effectiveDuration.min && durationMin <= effectiveDuration.max) {
        score += 20;
        reasons.push("Fits your preferred hangout length");
      } else if (durationMin > effectiveDuration.max) {
        score += 12;
        reasons.push("More than enough time");
      } else if (durationMin >= effectiveDuration.min * 0.7) {
        score += 5;
        reasons.push("A bit short but workable");
      } else {
        score -= 10;
        reasons.push("Shorter than preferred");
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
    // Log sync failure
    const dbUser = await getDbUser(req.uid!).catch(() => null);
    if (dbUser) {
      getSupabase().from("sync_log").insert({
        user_id: dbUser.id,
        provider: "google",
        status: "error",
        error_message: String(err.message || err).slice(0, 500),
        duration_ms: 0,
      }).then(null, () => { /* best-effort */ });
    }
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

    if (!friendId || friendId === me.id) {
      res.status(400).json({ error: "Invalid friendId" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    if (!acceptedFriendIds.has(friendId)) {
      res.status(403).json({ error: "You can only view overlap with accepted friends" });
      return;
    }

    // Get the friend's DB user to find their firebase_uid for syncing
    const friendUser = await getDbUserById(friendId);
    if (!friendUser) {
      res.status(404).json({ error: "Friend not found" });
      return;
    }

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

    // Merge call-window slots into calendar-synced availability
    const myMerged = mergeCallWindowSlots(
      mySlots.data || [],
      generateCallWindowSlots(me.call_windows, me.timezone),
    );
    const friendMerged = mergeCallWindowSlots(
      friendSlots.data || [],
      generateCallWindowSlots(friendUser?.call_windows, friendUser?.timezone),
    );

    // Apply travel buffer — skip for phone/video calls
    const myBuffer = isCallMode ? 0 : (me.travel_buffer_min || 0);
    const friendBuffer = isCallMode ? 0 : (friendUser?.travel_buffer_min || 0);
    const myBuffered = applyTravelBuffer(myMerged, myBuffer);
    const friendBuffered = applyTravelBuffer(friendMerged, friendBuffer);

    // Compute overlaps (using buffered slots)
    // Use participants' preferred duration to set minimum overlap length
    const durationPref = resolveGroupDuration([me, friendUser], isCallMode);
    const minDurationMin = isCallMode ? Math.max(10, durationPref.min) : Math.max(30, Math.round(durationPref.min * 0.7));
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
    const clampedOverlaps = clampOverlapsToPreferences(rawOverlaps, [
      { preferred_times: me.preferred_times, timezone: me.timezone },
      { preferred_times: friendUser?.preferred_times, timezone: friendUser?.timezone },
    ]);

    // Restrict to default hangout windows (Fri evening, Sat all day, Sun until 5 PM)
    const hangoutFiltered = filterOverlapsToHangoutWindows(clampedOverlaps, me.timezone);

    // Round to clean :00/:30 boundaries
    const overlaps = roundOverlaps(hangoutFiltered, isCallMode ? 15 : 30);

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

    const requestedFriendIds = [...new Set(
      friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id),
    )];
    if (requestedFriendIds.length === 0) {
      res.status(400).json({ error: "friendIds must include at least one valid friend id" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedFriendIds = requestedFriendIds.filter((fid) => !acceptedFriendIds.has(fid));
    if (unauthorizedFriendIds.length > 0) {
      res.status(403).json({ error: "All friendIds must be accepted friends" });
      return;
    }

    // Fetch all friends' DB records
    const friendUsers = await Promise.all(
      requestedFriendIds.map((fid: string) => getDbUserById(fid)),
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
    const allUserIds = [me.id, ...requestedFriendIds];
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
            const profile = allProfiles[idx];
            const calSlots = r.data || [];
            const cwSlots = generateCallWindowSlots(profile?.call_windows, profile?.timezone);
            const merged = mergeCallWindowSlots(calSlots, cwSlots);
            const buffer = profile?.travel_buffer_min || 0;
            return applyTravelBuffer(merged, buffer);
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

    // Restrict to default hangout windows (Fri evening, Sat all day, Sun until 5 PM)
    currentOverlaps = filterOverlapsToHangoutWindows(currentOverlaps, me.timezone);

    // Round to clean :00/:30 boundaries
    currentOverlaps = roundOverlaps(currentOverlaps, 30);

    // AI-score the group overlaps
    const suggestions = await scoreGroupOverlaps(me.id, requestedFriendIds, currentOverlaps, 8);

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
        id: fu?.id || requestedFriendIds[idx],
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

    // Fetch pending invites for these groups
    const { data: pendingInvites } = await sb
      .from("pending_invites")
      .select("group_id, invited_email")
      .in("group_id", allGroupIds);

    const result = (groups || []).map((g: any) => {
      const members = (allMembers || [])
        .filter((m: any) => m.group_id === g.id && m.user_id !== me.id)
        .map((m: any) => {
          const u = userMap.get(m.user_id);
          return {
            id: m.user_id,
            displayName: u?.display_name || "Unknown",
            email: u?.email || "",
            photoUrl: u?.photo_url || null,
          };
        });
      const pendingEmails = (pendingInvites || [])
        .filter((p: any) => p.group_id === g.id)
        .map((p: any) => p.invited_email);
      return { ...g, members, pendingEmails };
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

    const { name, emoji, memberIds, invitedEmails } = req.body;
    const requestedMemberIds: string[] = Array.isArray(memberIds)
      ? [...new Set(memberIds.filter((id: unknown): id is string => typeof id === "string" && !!id && id !== me.id))]
      : [];
    const hasMemberIds = requestedMemberIds.length > 0;
    const hasInvitedEmails = Array.isArray(invitedEmails) && invitedEmails.length > 0;

    if (!name || (!hasMemberIds && !hasInvitedEmails)) {
      res.status(400).json({ error: "name and at least one member or invited email are required" });
      return;
    }

    const sb = getSupabase();
    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedMemberIds = requestedMemberIds.filter((id) => !acceptedFriendIds.has(id));
    if (unauthorizedMemberIds.length > 0) {
      res.status(403).json({ error: "All direct group members must be accepted friends" });
      return;
    }

    const { data: group, error: gErr } = await sb
      .from("friend_groups")
      .insert({ name, emoji: emoji || "👥", created_by: me.id })
      .select()
      .single();

    if (gErr) { res.status(500).json({ error: gErr.message }); return; }

    // Add creator + all existing members
    const allIds = [me.id, ...requestedMemberIds];
    const rows = allIds.map((uid: string) => ({ group_id: group.id, user_id: uid }));

    const { error: mErr } = await sb
      .from("friend_group_members")
      .insert(rows);

    if (mErr) { res.status(500).json({ error: mErr.message }); return; }

    // Handle invited emails — create pending invites with group_id
    const pendingResults: string[] = [];
    if (hasInvitedEmails) {
      for (const rawEmail of invitedEmails) {
        const email = rawEmail.trim().toLowerCase();
        if (!email) continue;
        try {
          // Check if user already exists on Slotted
          const { data: existingUser } = await sb
            .from("users")
            .select("id")
            .eq("email", email)
            .single();

          if (existingUser) {
            // User exists — only add directly if already an accepted friend
            if (existingUser.id !== me.id && acceptedFriendIds.has(existingUser.id)) {
              await sb.from("friend_group_members")
                .upsert({ group_id: group.id, user_id: existingUser.id }, { onConflict: "group_id,user_id" });
            } else if (existingUser.id !== me.id) {
              // Not an accepted friend yet: create/ensure friendship invite and keep as pending invite
              const [userA, userB] = me.id < existingUser.id ? [me.id, existingUser.id] : [existingUser.id, me.id];
              await sb.from("friendships")
                .upsert({ user_a_id: userA, user_b_id: userB, invited_by: me.id, status: "pending" }, { onConflict: "user_a_id,user_b_id" });
              await sb.from("pending_invites")
                .upsert(
                  { inviter_id: me.id, invited_email: email, group_id: group.id },
                  { onConflict: "inviter_id,invited_email" },
                );
              pendingResults.push(email);
            }
          } else {
            // User doesn't exist — store pending invite with group_id
            await sb.from("pending_invites")
              .upsert(
                { inviter_id: me.id, invited_email: email, group_id: group.id },
                { onConflict: "inviter_id,invited_email" },
              );
            pendingResults.push(email);
          }
        } catch (inviteErr) {
          console.error(`Failed to process invite for ${email}:`, inviteErr);
        }
      }
    }

    res.json({ ...group, pendingInvites: pendingResults });
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
      // Fetch existing members BEFORE replacing, so we can detect removals
      const { data: previousMembers } = await sb
        .from("friend_group_members")
        .select("user_id")
        .eq("group_id", groupId);
      const previousIds = new Set((previousMembers || []).map((m: any) => m.user_id));

      const requestedMemberIds = [...new Set(
        memberIds.filter((id: unknown): id is string => typeof id === "string" && !!id && id !== me.id),
      )];
      const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
      const previousMemberIds = Array.from(previousIds) as string[];
      const allowedIds = new Set<string>([...previousMemberIds, ...Array.from(acceptedFriendIds)]);
      const unauthorizedMemberIds = requestedMemberIds.filter((id) => !allowedIds.has(id));
      if (unauthorizedMemberIds.length > 0) {
        res.status(403).json({ error: "You can only add accepted friends to this group" });
        return;
      }

      // Replace all members
      await sb.from("friend_group_members").delete().eq("group_id", groupId);
      const allIds = [me.id, ...requestedMemberIds];
      const rows = allIds.map((uid: string) => ({ group_id: groupId, user_id: uid }));
      await sb.from("friend_group_members").insert(rows);

      const newIdSet = new Set(allIds);

      // Detect removed members and notify them
      const removedIds = [...previousIds].filter((id) => !newIdSet.has(id) && id !== me.id);
      for (const removedId of removedIds) {
        try {
          await createNotification({
            userId: removedId as string,
            type: "friend_accepted",
            title: `Removed from "${group.name || 'a group'}"`,
            body: `You were removed from the group "${group.name || ''}" by ${me.display_name || "the group owner"}.`,
            relatedUserId: me.id,
            relatedId: groupId,
          });
        } catch { /* ignore notification errors */ }
      }

      // Notify remaining members (excluding the editor) about who was removed
      if (removedIds.length > 0) {
        const removedNames: string[] = [];
        for (const rid of removedIds) {
          const u = await getDbUserById(rid as string);
          if (u?.display_name) removedNames.push(u.display_name.split(" ")[0]);
        }
        const namesStr = removedNames.join(", ") || "someone";
        const remainingIds = allIds.filter((id: string) => id !== me.id);
        for (const remainingId of remainingIds) {
          try {
            await createNotification({
              userId: remainingId,
              type: "friend_accepted",
              title: `${namesStr} left "${group.name || 'your group'}"`,
              body: `${namesStr} ${removedIds.length === 1 ? 'was' : 'were'} removed from "${group.name || ''}" by ${me.display_name || "the group owner"}.`,
              relatedUserId: me.id,
              relatedId: groupId,
            });
          } catch { /* ignore */ }
        }
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /groups/:id/members — add members to a group (any current member can do this) */
app.post("/groups/:id/members", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const sb = getSupabase();
    const groupId = req.params.id;
    const { memberIds } = req.body;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      res.status(400).json({ error: "memberIds must be a non-empty array" });
      return;
    }
    const requestedMemberIds = [...new Set(
      memberIds.filter((id: unknown): id is string => typeof id === "string" && !!id && id !== me.id),
    )];
    if (requestedMemberIds.length === 0) {
      res.status(400).json({ error: "memberIds must include at least one valid user id" });
      return;
    }

    // Verify the requester is a member of this group
    const { data: membership } = await sb
      .from("friend_group_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("user_id", me.id)
      .single();

    if (!membership) {
      res.status(403).json({ error: "You must be a member of this group to add people" });
      return;
    }

    // Get existing members to avoid duplicates
    const { data: existingMembers } = await sb
      .from("friend_group_members")
      .select("user_id")
      .eq("group_id", groupId);

    const existingIds = new Set((existingMembers || []).map((m: any) => m.user_id));
    const newIds = requestedMemberIds.filter((id: string) => !existingIds.has(id));

    if (newIds.length === 0) {
      res.json({ added: 0, message: "All selected members are already in the group" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedMemberIds = newIds.filter((id: string) => !acceptedFriendIds.has(id));
    if (unauthorizedMemberIds.length > 0) {
      res.status(403).json({ error: "You can only add accepted friends to this group" });
      return;
    }

    const rows = newIds.map((uid: string) => ({ group_id: groupId, user_id: uid }));
    const { error } = await sb.from("friend_group_members").insert(rows);

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Get group name for the notification
    const { data: group } = await sb
      .from("friend_groups")
      .select("name")
      .eq("id", groupId)
      .single();

    // Notify newly added members
    for (const uid of newIds) {
      try {
        await createNotification({
          userId: uid,
          type: "friend_accepted",
          title: `Added to "${group?.name || 'a group'}"`,
          body: `${me.display_name || "Someone"} added you to the group "${group?.name || ''}" on Slotted`,
          relatedUserId: me.id,
          relatedId: groupId,
        });
      } catch { /* ignore notification errors */ }
    }

    // Notify existing group members that someone new was added
    const newMemberNames: string[] = [];
    for (const uid of newIds) {
      const u = await getDbUserById(uid);
      if (u?.display_name) newMemberNames.push(u.display_name.split(" ")[0]);
    }
    const namesStr = newMemberNames.join(", ") || "someone";
    const existingMemberIds = [...existingIds].filter((id) => id !== me.id);
    for (const existingId of existingMemberIds) {
      try {
        await createNotification({
          userId: existingId as string,
          type: "friend_accepted",
          title: `${namesStr} joined "${group?.name || 'your group'}"`,
          body: `${me.display_name || "Someone"} added ${namesStr} to the group "${group?.name || ''}"`,
          relatedUserId: me.id,
          relatedId: groupId,
        });
      } catch { /* ignore */ }
    }

    res.json({ added: newIds.length });
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
    const rawParticipantIds: string[] = Array.isArray(friendIds)
      ? friendIds.filter((pid: unknown): pid is string => typeof pid === "string" && !!pid)
      : (typeof friendId === "string" && !!friendId)
        ? [friendId]
        : [];
    const participantIds = [...new Set(rawParticipantIds.filter((pid) => pid !== me.id))];

    if (participantIds.length === 0) {
      res.status(400).json({ error: "At least one friendId is required" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedParticipantIds = participantIds.filter((pid) => !acceptedFriendIds.has(pid));
    if (unauthorizedParticipantIds.length > 0) {
      res.status(403).json({ error: "All participants must be accepted friends" });
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

    // Auto-add to the creator's Google Calendar (background, non-blocking)
    autoAddToCalendar(req.uid!, meetup).catch(() => {});

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
      .update({ rsvp, rsvp_source: "app" })
      .eq("meetup_id", meetupId)
      .eq("user_id", me.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Fetch meetup info + all participant RSVPs
    const { data: meetup } = await getSupabase()
      .from("meetups")
      .select("title, created_by, status, start_time, end_time, description, location")
      .eq("id", meetupId)
      .single();

    const { data: allParticipants } = await getSupabase()
      .from("meetup_participants")
      .select("user_id, rsvp")
      .eq("meetup_id", meetupId);

    // Notify the meetup creator about the RSVP (skip for declines — handled separately below)
    if (meetup && meetup.created_by !== me.id && rsvp !== "declined") {
      const rsvpEmoji = rsvp === "accepted" ? "✅" : "🤔";
      await createNotification({
        userId: meetup.created_by,
        type: rsvp === "accepted" ? "meetup_confirmed" : "meetup_request",
        title: `${rsvpEmoji} ${me.display_name || "Someone"} ${rsvp} your invite`,
        body: meetup.title || "Hangout",
        relatedUserId: me.id,
        relatedId: meetupId,
      });
    }

    // Auto-confirm: if ALL participants have now accepted, update meetup status to "confirmed"
    let meetupConfirmed = false;
    if (rsvp === "accepted" && meetup && meetup.status === "proposed" && allParticipants) {
      const allAccepted = allParticipants.every((p: any) => p.rsvp === "accepted");
      if (allAccepted) {
        await getSupabase()
          .from("meetups")
          .update({ status: "confirmed" })
          .eq("id", meetupId);
        meetupConfirmed = true;

        // Mark all old meetup_request notifications for this meetup as read
        await getSupabase()
          .from("notifications")
          .update({ read: true })
          .eq("related_id", meetupId)
          .in("type", ["meetup_request"]);

        // Notify ALL participants that the hangout is confirmed
        for (const p of allParticipants) {
          await createNotification({
            userId: p.user_id,
            type: "meetup_confirmed",
            title: "🎉 Hangout confirmed!",
            body: `Everyone accepted — ${meetup.title || "Hangout"} is locked in!`,
            relatedId: meetupId,
          });
        }

        // Auto-add to all participants' Google Calendars (background)
        const meetupData = { id: meetupId, title: meetup.title, description: meetup.description, location: meetup.location, start_time: meetup.start_time, end_time: meetup.end_time };
        for (const p of allParticipants) {
          // Look up firebase_uid for each participant
          const { data: pUser } = await getSupabase().from("users").select("firebase_uid").eq("id", p.user_id).single();
          if (pUser?.firebase_uid) {
            autoAddToCalendar(pUser.firebase_uid, meetupData).catch(() => {});
          }
        }
      }
    }

    // If someone declined, cancel the meetup (for 1-on-1) or notify others
    if (rsvp === "declined" && meetup && allParticipants) {
      // For 2-person meetups, auto-cancel the whole meetup
      if (allParticipants.length <= 2) {
        await getSupabase()
          .from("meetups")
          .update({ status: "cancelled" })
          .eq("id", meetupId);
      }

      // Mark all existing notifications for this meetup as read
      await getSupabase()
        .from("notifications")
        .update({ read: true })
        .eq("related_id", meetupId)
        .in("type", ["meetup_request", "meetup_confirmed", "meetup_reminder"]);

      // Notify other participants
      for (const p of allParticipants) {
        if (p.user_id !== me.id) {
          await createNotification({
            userId: p.user_id,
            type: "meetup_request",
            title: `❌ ${me.display_name || "Someone"} can't make it`,
            body: meetup.title || "Hangout",
            relatedUserId: me.id,
            relatedId: meetupId,
          });
        }
      }
    }

    // Return RSVP data with quota warning and confirmation status
    const response: any = { ...data, meetupConfirmed };
    if (quotaWarning) response.quotaWarning = quotaWarning;
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /meetups/:meetupId/counter-propose — decline original + create new meetup with reversed roles */
app.post("/meetups/:meetupId/counter-propose", requireAuth, async (req: AuthRequest, res: Response) => {
  const { meetupId } = req.params;
  const { startTime, endTime } = req.body;

  if (!startTime || !endTime) {
    res.status(400).json({ error: "startTime and endTime are required" });
    return;
  }

  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const participant = await isMeetupParticipant(meetupId, me.id);
    if (!participant) {
      res.status(403).json({ error: "You are not a participant in this meetup" });
      return;
    }

    // Get the original meetup
    const { data: originalMeetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .select("*")
      .eq("id", meetupId)
      .single();

    if (meetupErr || !originalMeetup) {
      res.status(404).json({ error: "Meetup not found" });
      return;
    }

    // Decline the counter-proposer on the original meetup (silently — no notification)
    await getSupabase()
      .from("meetup_participants")
      .update({ rsvp: "declined" })
      .eq("meetup_id", meetupId)
      .eq("user_id", me.id);

    // Get the original creator's ID (the person to receive the counter-proposal)
    const originalCreatorId = originalMeetup.created_by;

    // Get all other participants from the original meetup (excluding counter-proposer)
    const { data: origParticipants } = await getSupabase()
      .from("meetup_participants")
      .select("user_id")
      .eq("meetup_id", meetupId)
      .neq("user_id", me.id);

    const otherParticipantIds = (origParticipants || []).map((p: any) => p.user_id);

    // Create a new meetup with the counter-proposer as creator
    const newTitle = originalMeetup.title || "Hangout";
    const { data: newMeetup, error: newErr } = await getSupabase()
      .from("meetups")
      .insert({
        title: newTitle,
        description: originalMeetup.description,
        location: originalMeetup.location,
        start_time: startTime,
        end_time: endTime,
        created_by: me.id,
      })
      .select()
      .single();

    if (newErr || !newMeetup) {
      res.status(500).json({ error: newErr?.message || "Failed to create counter-proposal" });
      return;
    }

    // Add participants: counter-proposer as accepted, everyone else as pending
    const participants = [
      { meetup_id: newMeetup.id, user_id: me.id, rsvp: "accepted" },
      ...otherParticipantIds.map((pid: string) => ({
        meetup_id: newMeetup.id,
        user_id: pid,
        rsvp: "pending",
      })),
    ];

    await getSupabase().from("meetup_participants").insert(participants);

    // Format original and new times for the notification
    const origDt = new Date(originalMeetup.start_time);
    const origTimeStr = origDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " at " + origDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    const newDt = new Date(startTime);
    const newTimeStr = newDt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
      " at " + newDt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    // Notify each original participant with a single combined notification
    for (const pid of otherParticipantIds) {
      await createNotification({
        userId: pid,
        type: "meetup_request",
        title: `🔄 ${me.display_name || "Someone"} suggested a different time`,
        body: `Can't make ${origTimeStr} — how about ${newTimeStr}? (${newTitle})`,
        relatedUserId: me.id,
        relatedId: newMeetup.id,
      });
    }

    res.json({ ...newMeetup, counterProposedFrom: meetupId });
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

    const participant = await isMeetupParticipant(meetupId, me.id);
    if (!participant) {
      res.status(403).json({ error: "You are not a participant in this meetup" });
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

    // Mark all notifications related to this meetup as read so they disappear
    await getSupabase()
      .from("notifications")
      .update({ read: true })
      .eq("related_id", meetupId)
      .in("type", ["meetup_request", "meetup_confirmed", "meetup_reminder"]);

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
        .select("calendar_id, calendar_color, access_role, source")
        .eq("user_id", me.id)
        .eq("source", "google")
        .eq("is_selected", true)
        .in("access_role", ["owner", "writer"])
        .order("calendar_id");

      // Fetch display names live from Google API (not stored in DB for privacy)
      let googleNameMap = new Map<string, string>();
      try {
        const oauth2 = await getAuthedCalendarClient(req.uid!);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
          const calListRes = await calendarApi.calendarList.list();
          for (const cal of calListRes.data.items || []) {
            if (cal.id) googleNameMap.set(cal.id, cal.summary || cal.id);
          }
        }
      } catch (err) {
        console.error("Failed to fetch Google calendar names for writable-calendars:", err);
      }

      (gcals || []).forEach((c: any) => {
        calendars.push({
          id: c.calendar_id,
          name: googleNameMap.get(c.calendar_id) || c.calendar_id,
          color: c.calendar_color,
          source: "google",
        });
      });
    }

    // Apple calendars (the user has stored via CalDAV)
    if (me.apple_calendar_connected) {
      const { data: acals } = await getSupabase()
        .from("user_calendars")
        .select("calendar_id, calendar_color, source")
        .eq("user_id", me.id)
        .eq("source", "apple")
        .eq("is_selected", true)
        .order("calendar_id");

      // Fetch display names live from Apple CalDAV (not stored in DB for privacy)
      let appleNameMap = new Map<string, string>();
      if (me.apple_caldav_username && me.apple_caldav_password) {
        try {
          const appleCals = await fetchAppleCalendars(me.apple_caldav_username, me.apple_caldav_password);
          for (const cal of appleCals) {
            appleNameMap.set(cal.url, cal.displayName || cal.url.split("/").filter(Boolean).pop() || "Apple Calendar");
          }
        } catch (err) {
          console.error("Failed to fetch Apple calendar names for writable-calendars:", err);
        }
      }

      (acals || []).forEach((c: any) => {
        calendars.push({
          id: c.calendar_id,
          name: appleNameMap.get(c.calendar_id) || "Apple Calendar",
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

    const participant = await isMeetupParticipant(meetupId, me.id);
    if (!participant) {
      res.status(403).json({ error: "You are not a participant in this meetup" });
      return;
    }

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
// Shareable Event Links (public share pages for meetups)
// ---------------------------------------------------------------------------

const shareLookupHits = new Map<string, number[]>();
function isShareLookupRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxHits = 30;
  const hits = shareLookupHits.get(clientKey) || [];
  const recentHits = hits.filter((t) => now - t < windowMs);
  recentHits.push(now);
  shareLookupHits.set(clientKey, recentHits);
  return recentHits.length > maxHits;
}

function generateShareCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** POST /meetups/:meetupId/share — generate a shareable link for a meetup */
app.post("/meetups/:meetupId/share", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { meetupId } = req.params;

    const { data: meetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .select("id, share_code, created_by")
      .eq("id", meetupId)
      .single();

    if (meetupErr || !meetup) {
      res.status(404).json({ error: "Meetup not found" });
      return;
    }

    if (meetup.created_by !== me.id) {
      res.status(403).json({ error: "Only the meetup creator can generate a share link" });
      return;
    }

    if (meetup.share_code) {
      res.json({ shareCode: meetup.share_code, shareUrl: `https://slotted-ai.web.app/e/${meetup.share_code}` });
      return;
    }

    let shareCode = generateShareCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: existing } = await getSupabase()
        .from("meetups")
        .select("id")
        .eq("share_code", shareCode)
        .single();
      if (!existing) break;
      shareCode = generateShareCode();
    }

    const { error: updateErr } = await getSupabase()
      .from("meetups")
      .update({ share_code: shareCode })
      .eq("id", meetupId);

    if (updateErr) {
      res.status(500).json({ error: updateErr.message });
      return;
    }

    res.json({ shareCode, shareUrl: `https://slotted-ai.web.app/e/${shareCode}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /meetups/shared/:code — public: fetch meetup data for share landing page */
app.get("/meetups/shared/:code", async (req: Request, res: Response) => {
  try {
    const forwardedFor = req.headers["x-forwarded-for"];
    const clientKey = typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip || "unknown";
    if (isShareLookupRateLimited(clientKey)) {
      res.status(429).json({ error: "Too many requests. Please try again shortly." });
      return;
    }

    const { code } = req.params;
    const normalizedCode = String(code || "").trim().toLowerCase();
    if (!/^[a-z0-9]{3,32}$/.test(normalizedCode)) {
      res.status(400).json({ error: "Invalid share code format" });
      return;
    }

    const { data: meetup, error } = await getSupabase()
      .from("meetups")
      .select("id, title, description, location, start_time, end_time, created_by")
      .eq("share_code", normalizedCode)
      .single();

    if (error || !meetup) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const { data: creator } = await getSupabase()
      .from("users")
      .select("display_name, photo_url, invite_code")
      .eq("id", meetup.created_by)
      .single();

    res.json({
      title: meetup.title,
      description: meetup.description,
      location: meetup.location,
      startTime: meetup.start_time,
      endTime: meetup.end_time,
      sharer: {
        displayName: creator?.display_name || "A Slotted user",
        photoUrl: creator?.photo_url || null,
        inviteCode: creator?.invite_code || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /meetups/shared/:code/ics — public: download branded .ics file */
app.get("/meetups/shared/:code/ics", async (req: Request, res: Response) => {
  try {
    const forwardedFor = req.headers["x-forwarded-for"];
    const clientKey = typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip || "unknown";
    if (isShareLookupRateLimited(clientKey)) {
      res.status(429).json({ error: "Too many requests. Please try again shortly." });
      return;
    }

    const { code } = req.params;
    const normalizedCode = String(code || "").trim().toLowerCase();
    if (!/^[a-z0-9]{3,32}$/.test(normalizedCode)) {
      res.status(400).json({ error: "Invalid share code format" });
      return;
    }

    const { data: meetup, error } = await getSupabase()
      .from("meetups")
      .select("id, title, description, location, start_time, end_time, created_by")
      .eq("share_code", normalizedCode)
      .single();

    if (error || !meetup) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const { data: creator } = await getSupabase()
      .from("users")
      .select("invite_code")
      .eq("id", meetup.created_by)
      .single();

    const inviteCode = creator?.invite_code || "";
    const inviteUrl = inviteCode ? `https://slotted-ai.web.app/invite/${inviteCode}` : "https://slotted-ai.web.app";

    const fmtIcs = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const now = fmtIcs(new Date().toISOString());
    const dtStart = fmtIcs(meetup.start_time);
    const dtEnd = fmtIcs(meetup.end_time);

    const description = [
      meetup.description || "",
      "",
      "---",
      "📅 Created with Slotted (https://slotted-ai.web.app)",
      "The app that helps friends find time to hang.",
      `Join: ${inviteUrl}`,
    ].join("\\n");

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Slotted//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:slotted-${meetup.id}@slotted-ai.web.app`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${(meetup.title || "Hangout").replace(/[,;\\]/g, " ")}`,
      `DESCRIPTION:${description}`,
      ...(meetup.location ? [`LOCATION:${meetup.location.replace(/[,;\\]/g, " ")}`] : []),
      "BEGIN:VALARM",
      "TRIGGER:-PT60M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${meetup.title || "Hangout"} in 1 hour`,
      "END:VALARM",
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${meetup.title || "Hangout"} in 15 minutes`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${(meetup.title || "event").replace(/[^a-zA-Z0-9 ]/g, "")}.ics"`);
    res.send(ics);
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
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("suggestion_events")
      .update({ outcome, acted_at: new Date().toISOString() })
      .eq("id", suggestionId)
      .eq("user_id", me.id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        res.status(404).json({ error: "Suggestion not found" });
        return;
      }
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

        // Get last completed meetup shared by both users (safe intersection, no interpolated SQL)
        const { data: sharedParticipantRows } = await getSupabase()
          .from("meetup_participants")
          .select("meetup_id, user_id")
          .in("user_id", [me.id, friend.id]);

        const participantSetsByMeetup = new Map<string, Set<string>>();
        for (const row of sharedParticipantRows || []) {
          if (!participantSetsByMeetup.has(row.meetup_id)) {
            participantSetsByMeetup.set(row.meetup_id, new Set<string>());
          }
          participantSetsByMeetup.get(row.meetup_id)!.add(row.user_id);
        }
        const sharedMeetupIds = Array.from(participantSetsByMeetup.entries())
          .filter(([, ids]) => ids.has(me.id) && ids.has(friend.id))
          .map(([meetupId]) => meetupId);

        const { data: lastMeetup } = sharedMeetupIds.length > 0
          ? await getSupabase()
              .from("meetups")
              .select("start_time")
              .eq("status", "completed")
              .in("id", sharedMeetupIds)
              .order("start_time", { ascending: false })
              .limit(1)
              .maybeSingle()
          : { data: null };

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
        // Only show if BOTH users have share_hangouts enabled (mutual opt-in)
        if (!log.user.share_hangouts || !me.share_hangouts) continue;

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
// v2.17.1 — duration-aware scoring

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
    .replace(/\b(the|a|an|at|in|on|of)\b/g, "")
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
  // If one is a substring of the other (at least 8 chars to avoid false positives)
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;
  // Levenshtein-lite: if strings are very similar (differ by < 15% of chars)
  if (a.length > 10 && b.length > 10) {
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))) return true;
  }
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

      // Same or similar title + same venue area
      // For recurring shows (same venue), merge across ALL dates — we'll show the next upcoming one
      const evVenue = (ev.venue || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const repVenue = (rep.venue || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const sameVenue = !evVenue || !repVenue || evVenue === repVenue
        || evVenue.includes(repVenue.slice(0, 10)) || repVenue.includes(evVenue.slice(0, 10));

      // For recurring shows at the same venue, merge across all dates
      // For one-off events, still require same date
      const dateDiff = Math.abs(new Date(evDate).getTime() - new Date(repDate).getTime());
      const sameDate = dateDiff <= 86400000; // within 24h
      const isRecurringShow = sameVenue && evVenue.length > 0;

      if (titlesMatch(normTitle, repNorm) && (sameDate || isRecurringShow)) {
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
    // Sort group by date to pick the earliest upcoming showtime
    const now = Date.now();
    const futureEvents = group.filter((e) => new Date(e.datetime).getTime() >= now);
    const sortedByDate = (futureEvents.length > 0 ? futureEvents : group)
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    // Pick the "best" listing as the primary (prefer Ticketmaster, then image, then lowest price)
    const sorted = [...sortedByDate].sort((a, b) => {
      // Prefer Ticketmaster as primary source
      if (a.source === "ticketmaster" && b.source !== "ticketmaster") return -1;
      if (a.source !== "ticketmaster" && b.source === "ticketmaster") return 1;
      // Then SeatGeek (StubHub) as secondary
      if (a.source === "seatgeek" && b.source !== "seatgeek") return -1;
      if (a.source !== "seatgeek" && b.source === "seatgeek") return 1;
      // Prefer entries with images
      if (a.imageUrl && !b.imageUrl) return -1;
      if (!a.imageUrl && b.imageUrl) return 1;
      // Then prefer lower price
      if ((a.priceMin || Infinity) !== (b.priceMin || Infinity)) {
        return (a.priceMin || Infinity) - (b.priceMin || Infinity);
      }
      return 0;
    });

    const primary = sorted[0];

    // Collect all source URLs — deduplicate by source, prefer Ticketmaster first
    const seenSources = new Set<string>();
    const urls: { source: string; url: string }[] = [];
    // Sort to put ticketmaster first
    const sortedGroup = [...group].sort((a, b) => {
      if (a.source === "ticketmaster") return -1;
      if (b.source === "ticketmaster") return 1;
      return 0;
    });
    for (const ev of sortedGroup) {
      if (!seenSources.has(ev.source)) {
        seenSources.add(ev.source);
        urls.push({ source: ev.source, url: ev.url });
      }
    }
    const sources = [...seenSources];

    // Merge prices — take the lowest min and highest max across sources
    const allMins = group.map((e) => e.priceMin).filter((p): p is number => p !== undefined && p > 0);
    const allMaxes = group.map((e) => e.priceMax).filter((p): p is number => p !== undefined && p > 0);

    // Merge performers — union of all
    const allPerformers = [...new Set(group.flatMap((e) => e.performers || []))];

    // Use best image
    const bestImage = group.find((e) => e.imageUrl)?.imageUrl;

    return {
      ...primary,
      // Use the earliest upcoming date (not the source-preferred one)
      datetime: sortedByDate[0].datetime,
      datetimeLocal: sortedByDate[0].datetimeLocal,
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
    let city = req.query.city as string || "";
    const type = req.query.type as string || "";
    const page = parseInt(req.query.page as string || "1", 10);
    const perPage = Math.min(parseInt(req.query.perPage as string || "20", 10), 50);

    // Load user profile for city fallback and event interests
    const me = await getDbUser(req.uid!);

    if (!city) {
      const userCity = me?.event_city || me?.neighborhood || "";
      if (!userCity) {
        res.json({ events: [], message: "Set your city in Settings to discover local events." });
        return;
      }
      city = userCity;
    }

    // Date range — use query params if provided, otherwise default to next 30 days
    const dateFrom = (req.query.dateFrom as string) || new Date().toISOString().split("T")[0];
    const dateTo = (req.query.dateTo as string) || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    // If no category filter specified, use the user's event interests to personalize results
    const userInterests: string[] = me?.event_interests || [];
    let effectiveType = type;
    let searchQueries: string[] = [];

    if (!type && userInterests.length > 0) {
      // Search for each user interest separately, then merge
      searchQueries = userInterests.slice(0, 4); // limit to 4 interests to control API calls
    } else {
      searchQueries = [type || city];
    }

    // Run searches for each interest category in parallel
    const allResultSets = await Promise.all(
      searchQueries.map(async (q) => {
        const searchParams = {
          q: q || city,
          city,
          type: type || (q !== city ? q : ""),
          dateFrom,
          dateTo,
          perPage: Math.ceil(perPage / Math.max(searchQueries.length, 1)),
        };
        const [sgEvents, tmEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
          searchSeatGeek(searchParams),
          searchTicketmaster(searchParams),
          searchEventbrite(searchParams),
          searchMeetup(searchParams),
          searchNYCOpenData(searchParams),
        ]);
        return [...sgEvents, ...tmEvents, ...ebEvents, ...muEvents, ...nycEvents];
      }),
    );

    const allEvents = allResultSets.flat();
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
      city,
      personalizedByInterests: !type && userInterests.length > 0,
      interests: userInterests,
      sources: {},
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

    const requestedFriendIds = [...new Set(
      friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id),
    )];
    if (requestedFriendIds.length === 0) {
      res.status(400).json({ error: "friendIds must include at least one valid friend id" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedFriendIds = requestedFriendIds.filter((fid) => !acceptedFriendIds.has(fid));
    if (unauthorizedFriendIds.length > 0) {
      res.status(403).json({ error: "All friendIds must be accepted friends" });
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
    for (const friendId of requestedFriendIds) {
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
// GET /events/suggestions — smart event suggestions based on shared interests + availability
// Returns events that match shared interests between you and your friends,
// filtered by when everyone is free. Like "You and Sarah both like theater — Hamilton this Sat?"
// ---------------------------------------------------------------------------
app.get("/events/suggestions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const myInterests: string[] = me.event_interests || [];
    const myCity = me.event_city || me.neighborhood || "";
    if (!myCity) {
      res.json({ suggestions: [], message: "Set your city in Settings to get event suggestions." });
      return;
    }

    const sb = getSupabase();

    // 1. Get all accepted friendships
    const { data: friendshipsA } = await sb.from("friendships")
      .select("user_b_id").eq("user_a_id", me.id).eq("status", "accepted");
    const { data: friendshipsB } = await sb.from("friendships")
      .select("user_a_id").eq("user_b_id", me.id).eq("status", "accepted");

    const friendIds = [
      ...(friendshipsA || []).map((f: any) => f.user_b_id),
      ...(friendshipsB || []).map((f: any) => f.user_a_id),
    ];

    if (friendIds.length === 0) {
      res.json({ suggestions: [], message: "Add friends to get personalized event suggestions!" });
      return;
    }

    // 2. Load friend profiles to find shared interests
    const { data: friendProfiles } = await sb.from("users")
      .select("id, display_name, photo_url, event_interests, event_city, neighborhood")
      .in("id", friendIds);

    // 3. Build friend-interest pairs: which friends share which interests
    const friendPairs: { friendId: string; friendName: string; friendPhoto?: string; sharedInterests: string[] }[] = [];
    for (const friend of (friendProfiles || [])) {
      const friendInterests: string[] = friend.event_interests || [];
      const shared = myInterests.filter((i: string) => friendInterests.includes(i));
      if (shared.length > 0) {
        friendPairs.push({
          friendId: friend.id,
          friendName: friend.display_name?.split(" ")[0] || "Friend",
          friendPhoto: friend.photo_url || undefined,
          sharedInterests: shared,
        });
      }
    }

    // If no shared interests, use your own interests with all friends
    const interestsToSearch = friendPairs.length > 0
      ? [...new Set(friendPairs.flatMap((p) => p.sharedInterests))]
      : myInterests.length > 0
        ? myInterests
        : ["concert", "theater"]; // default fallback

    // 4. Search for events matching shared interests
    const dateFrom = new Date().toISOString().split("T")[0];
    const dateTo = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]; // next 2 weeks

    const allEventSets = await Promise.all(
      interestsToSearch.slice(0, 3).map(async (interest) => {
        const searchParams = { q: interest, city: myCity, type: interest, dateFrom, dateTo, perPage: 10 };
        const [sg, tm] = await Promise.all([
          searchSeatGeek(searchParams),
          searchTicketmaster(searchParams),
        ]);
        return [...sg, ...tm];
      }),
    );
    const allEvents = deduplicateEvents(allEventSets.flat());
    if (allEvents.length === 0) {
      res.json({ suggestions: [], message: `No upcoming events matching your interests in ${myCity}.` });
      return;
    }

    // 5. Check availability for you + friends with shared interests
    const now = new Date().toISOString();
    const mySlots = await sb.from("availability")
      .select("start_time, end_time").eq("user_id", me.id).eq("status", "free").gte("end_time", now)
      .then((r) => applyTravelBuffer(r.data || [], me.travel_buffer_min || 0));

    // For each event, find which friends are free and share that interest
    const suggestions: any[] = [];

    for (const ev of allEvents.slice(0, 20)) {
      if (!ev.datetime) continue;
      const eventStart = new Date(ev.datetime);
      const eventEnd = new Date(eventStart.getTime() + 3 * 3600000); // ~3h event

      // Check if I'm free
      const imFree = mySlots.some((slot: any) => {
        const s = new Date(slot.start_time).getTime();
        const e = new Date(slot.end_time).getTime();
        return Math.min(eventEnd.getTime(), e) - Math.max(eventStart.getTime(), s) >= 2 * 3600000;
      });
      if (!imFree) continue;

      // Find friends who share the interest for this event type AND are free
      const evType = ev.type?.toLowerCase() || "";
      const matchingFriends: { id: string; name: string; photo?: string }[] = [];

      for (const pair of friendPairs) {
        const hasInterest = pair.sharedInterests.some((i) =>
          evType.includes(i) || i.includes(evType) || ev.title.toLowerCase().includes(i),
        );
        if (!hasInterest && friendPairs.length > 0) continue;

        // Check friend's availability
        const { data: friendSlots } = await sb.from("availability")
          .select("start_time, end_time").eq("user_id", pair.friendId).eq("status", "free").gte("end_time", now);

        const friendFree = (friendSlots || []).some((slot: any) => {
          const s = new Date(slot.start_time).getTime();
          const e = new Date(slot.end_time).getTime();
          return Math.min(eventEnd.getTime(), e) - Math.max(eventStart.getTime(), s) >= 2 * 3600000;
        });

        if (friendFree) {
          matchingFriends.push({ id: pair.friendId, name: pair.friendName, photo: pair.friendPhoto });
        }
      }

      if (matchingFriends.length > 0) {
        const friendNames = matchingFriends.map((f) => f.name);
        const interestLabel = interestsToSearch.find((i) =>
          evType.includes(i) || i.includes(evType),
        ) || interestsToSearch[0];

        suggestions.push({
          ...ev,
          matchingFriends,
          sharedInterest: interestLabel,
          reason: matchingFriends.length === 1
            ? `You and ${friendNames[0]} both like ${interestLabel} — and you're both free!`
            : `${friendNames.join(", ")} are all free and love ${interestLabel}!`,
          score: matchingFriends.length * 30 + (imFree ? 40 : 0) + (ev.priceMin === 0 ? 10 : 0),
        });
      }
    }

    // Sort by score
    suggestions.sort((a, b) => b.score - a.score);

    res.json({
      suggestions: suggestions.slice(0, 8),
      friendPairs: friendPairs.map((p) => ({
        friendId: p.friendId,
        friendName: p.friendName,
        friendPhoto: p.friendPhoto,
        sharedInterests: p.sharedInterests,
      })),
      interestsSearched: interestsToSearch,
    });
  } catch (err: any) {
    console.error("Event suggestions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /events/share — share an event with friends (like Instagram DMs)
// Sends a notification to each selected friend with the event details
// ---------------------------------------------------------------------------
app.post("/events/share", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { friendIds, event, message: userMessage } = req.body;
    if (!Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "friendIds must be a non-empty array" });
      return;
    }
    if (!event || !event.title) {
      res.status(400).json({ error: "event object with title is required" });
      return;
    }

    const requestedFriendIds = [...new Set(
      friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id),
    )];
    if (requestedFriendIds.length === 0) {
      res.status(400).json({ error: "friendIds must include at least one valid friend id" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedFriendIds = requestedFriendIds.filter((fid) => !acceptedFriendIds.has(fid));
    if (unauthorizedFriendIds.length > 0) {
      res.status(403).json({ error: "All friendIds must be accepted friends" });
      return;
    }

    const senderName = me.display_name?.split(" ")[0] || "A friend";
    const eventDate = event.datetimeLocal
      ? new Date(event.datetimeLocal).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "";

    // Build notification body with embedded event data for rich rendering
    // Format: [EVENT_SHARE]{json} so the frontend can parse and render a card
    const eventPayload = {
      title: event.title,
      venue: event.venue || "",
      city: event.city || "",
      datetime: event.datetime || "",
      datetimeLocal: event.datetimeLocal || "",
      url: event.url || "",
      urls: event.urls || [],
      imageUrl: event.imageUrl || "",
      type: event.type || "event",
      source: event.source || "",
      priceMin: event.priceMin,
      priceMax: event.priceMax,
      performers: event.performers || [],
      senderMessage: userMessage || "",
    };

    const notifBody = `[EVENT_SHARE]${JSON.stringify(eventPayload)}`;
    const humanTitle = `${senderName} shared an event with you!`;
    const humanPreview = `${event.title}${eventDate ? ` — ${eventDate}` : ""}${event.venue ? ` at ${event.venue}` : ""}`;

    // Determine notification type — try event_shared first, fall back to calendar_match
    let notifType = "event_shared";

    const sentTo: string[] = [];
    const errors: string[] = [];

    for (const friendId of requestedFriendIds) {
      try {
        // Try event_shared type first
        const { error } = await getSupabase().from("notifications").insert({
          user_id: friendId,
          type: notifType,
          title: humanTitle,
          body: notifBody,
          related_user_id: me.id,
        });

        if (error) {
          // If constraint violation, fall back to calendar_match
          if (error.code === "23514" && notifType === "event_shared") {
            notifType = "calendar_match";
            const { error: fallbackErr } = await getSupabase().from("notifications").insert({
              user_id: friendId,
              type: "calendar_match",
              title: humanTitle,
              body: notifBody,
              related_user_id: me.id,
            });
            if (fallbackErr) {
              errors.push(`${friendId}: ${fallbackErr.message}`);
              continue;
            }
          } else {
            errors.push(`${friendId}: ${error.message}`);
            continue;
          }
        }

        sentTo.push(friendId);

        // Also send push notification with human-readable text
        try {
          const { data: tokens } = await getSupabase()
            .from("fcm_tokens")
            .select("token")
            .eq("user_id", friendId);

          if (tokens && tokens.length > 0) {
            await Promise.allSettled(
              tokens.map((t: any) =>
                admin.messaging().send({
                  token: t.token,
                  notification: {
                    title: humanTitle,
                    body: humanPreview,
                  },
                  webpush: {
                    fcmOptions: { link: "https://slotted-ai.web.app/notifications" },
                  },
                }).catch(() => {}),
              ),
            );
          }
        } catch { /* silent push failure */ }
      } catch (err: any) {
        errors.push(`${friendId}: ${err.message}`);
      }
    }

    res.json({
      sent: sentTo.length,
      total: requestedFriendIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
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

    // Notify the app owner via in-app notification
    try {
      const { data: ownerRow } = await getSupabase()
        .from("users")
        .select("id")
        .eq("email", "sharipaltrowitz@gmail.com")
        .single();
      if (ownerRow) {
        await createNotification({
          userId: ownerRow.id,
          type: "feedback",
          title: `Feedback from ${feedbackEntry.display_name}`,
          body: message.trim().slice(0, 500),
          relatedUserId: undefined,
          relatedId: undefined,
        });
      }
    } catch (notifErr) {
      console.error("Failed to notify owner of feedback:", notifErr);
    }

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

    const { friend_id, friend_name, hangout_date, activity_type, duration_min, day_of_week, time_of_day, notice_days, was_spontaneous, rating } = req.body;

    // Validate activity_type against allowed DB values
    const VALID_ACTIVITIES = ["coffee", "meal", "drinks", "walk", "workout", "movie", "game_night", "phone_call", "facetime", "video_call", "other"];
    const cleanActivity = activity_type && VALID_ACTIVITIES.includes(activity_type) ? activity_type : (activity_type ? "other" : null);

    const row: Record<string, any> = {
      user_id: dbUser.id,
      friend_id: friend_id || null,
      friend_name: friend_name || null,
      hangout_date: hangout_date || new Date().toISOString().slice(0, 10),
      duration_min: duration_min || null,
      notice_days: notice_days || null,
      was_spontaneous: was_spontaneous || false,
      rating: rating || null,
    };
    // Only include fields with values — avoids NOT NULL constraint issues for optional columns
    if (cleanActivity) row.activity_type = cleanActivity;
    if (time_of_day) row.time_of_day = time_of_day;
    if (day_of_week !== undefined && day_of_week !== null) row.day_of_week = day_of_week;

    const { data, error } = await getSupabase()
      .from("meetup_logs")
      .insert(row)
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
    process.env.GOOGLE_REDIRECT_URI || "https://slotted-ai.web.app/api/calendar/callback",
  );
}

/** Build an authenticated OAuth2 client for a user who has stored tokens */
async function getAuthedCalendarClient(firebaseUid: string) {
  const user = await getDbUser(firebaseUid);
  const hasRefreshToken = !!user?.google_refresh_token;
  const hasAccessToken = !!user?.google_access_token;
  if (!hasRefreshToken && !hasAccessToken) return null;
  if (!hasRefreshToken && user?.google_token_expires_at) {
    const expiryMs = new Date(user.google_token_expires_at).getTime();
    if (!Number.isNaN(expiryMs) && expiryMs <= Date.now()) return null;
  }

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
// Outlook Calendar (Microsoft Graph) helpers
// ---------------------------------------------------------------------------

const MICROSOFT_SCOPES = [
  "Calendars.Read",
  "Calendars.ReadWrite",
  "offline_access",
  "User.Read",
];

function getMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}`,
    },
  });
}

async function getOutlookGraphClient(firebaseUid: string): Promise<GraphClient | null> {
  const user = await getDbUser(firebaseUid);
  if (!user?.outlook_refresh_token) return null;

  const msalClient = getMsalClient();

  try {
    const result = await msalClient.acquireTokenByRefreshToken({
      refreshToken: user.outlook_refresh_token,
      scopes: MICROSOFT_SCOPES.filter(s => s !== "offline_access"),
    });

    if (!result) return null;

    const updates: Record<string, unknown> = {
      outlook_access_token: result.accessToken,
      outlook_token_expires_at: result.expiresOn?.toISOString() || null,
    };
    await getSupabase()
      .from("users")
      .update(updates)
      .eq("firebase_uid", firebaseUid);

    return GraphClient.init({
      authProvider: (done) => done(null, result.accessToken),
    });
  } catch (err) {
    console.error("Failed to get Outlook Graph client:", err);
    return null;
  }
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
      google_token_expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    };
    if (tokens.refresh_token) {
      updates.google_refresh_token = tokens.refresh_token;
    }

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
              calendar_color: cal.backgroundColor || null,
              is_selected: cal.accessRole === "owner",
              access_role: cal.accessRole || null,
              source: "google",
            });
        }
      }

      // Set up push notification channel for real-time sync
      try {
        const channelId = `slotted-${dbUser.id}-${Date.now()}`;
        const watchRes = await calendar.events.watch({
          calendarId: "primary",
          requestBody: {
            id: channelId,
            type: "web_hook",
            address: `${process.env.WEBHOOK_BASE_URL || "https://slotted-ai.web.app/api"}/webhooks/google-calendar`,
            token: GOOGLE_WEBHOOK_SECRET,
            expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await getSupabase()
          .from("users")
          .update({
            calendar_watch_channel: channelId,
            calendar_watch_expiry: new Date(Number(watchRes.data.expiration)).toISOString(),
            calendar_watch_resource_id: watchRes.data.resourceId,
          })
          .eq("id", dbUser.id);
      } catch (watchErr) {
        console.error("Failed to set up calendar watch:", watchErr);
      }
    }

    // Redirect back to the frontend dashboard (not settings — avoids overwhelming new users)
    const frontendUrl = process.env.FRONTEND_URL || "https://slotted-ai.web.app";
    res.redirect(`${frontendUrl}/dashboard?calendar=connected`);
  } catch (err: any) {
    console.error("Calendar OAuth callback error:", err);
    const frontendUrl = process.env.FRONTEND_URL || "https://slotted-ai.web.app";
    res.redirect(`${frontendUrl}/dashboard?calendar=error`);
  }
});

/** GET /calendar/status — check if user has connected their calendar (Google, Apple, and/or Outlook) */
app.get("/calendar/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await getDbUser(req.uid!);
    const hasGoogleTokens = !!user?.google_refresh_token;
    const appleConnected = !!(user?.apple_calendar_connected && user?.apple_caldav_username);
    const outlookConnected = !!(user?.outlook_calendar_connected && user?.outlook_refresh_token);

    // If ?verify=true, actually test the Google token with a lightweight API call
    let googleConnected = hasGoogleTokens;
    let googleStale = false;
    if (req.query.verify === "true" && hasGoogleTokens) {
      try {
        const oauth2 = await getAuthedCalendarClient(req.uid!);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
          await calendarApi.calendarList.list({ maxResults: 1 });
        } else {
          googleConnected = false;
          googleStale = true;
        }
      } catch (verifyErr: any) {
        const status = verifyErr?.code || verifyErr?.response?.status;
        if (status === 401 || status === 403) {
          googleConnected = false;
          googleStale = true;
        }
      }
    }

    res.json({
      connected: googleConnected || appleConnected || outlookConnected,
      google: googleConnected,
      googleStale,
      apple: appleConnected,
      outlook: outlookConnected,
      appleUsername: user?.apple_caldav_username || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /admin/calendar-health — check token validity for all connected users (admin only) */
app.get("/admin/calendar-health", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    // Simple admin check: only allow the app owner
    if (!me?.email || !["sharipaltrowitz@gmail.com"].includes(me.email)) {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    const { data: users } = await getSupabase()
      .from("users")
      .select("id, email, display_name, google_refresh_token, apple_calendar_connected, apple_caldav_username, outlook_calendar_connected, outlook_refresh_token")
      .or("google_refresh_token.not.is.null,apple_calendar_connected.eq.true,outlook_calendar_connected.eq.true");

    const results: {
      email: string;
      name: string | null;
      google: "valid" | "stale" | "none";
      apple: "connected" | "none";
      outlook: "connected" | "none";
    }[] = [];

    for (const u of users || []) {
      let googleStatus: "valid" | "stale" | "none" = "none";
      if (u.google_refresh_token) {
        // Look up firebase_uid for this user to test their token
        const { data: fullUser } = await getSupabase()
          .from("users")
          .select("firebase_uid")
          .eq("id", u.id)
          .single();

        if (fullUser?.firebase_uid) {
          try {
            const oauth2 = await getAuthedCalendarClient(fullUser.firebase_uid);
            if (oauth2) {
              const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
              await calendarApi.calendarList.list({ maxResults: 1 });
              googleStatus = "valid";
            } else {
              googleStatus = "stale";
            }
          } catch {
            googleStatus = "stale";
          }
        } else {
          googleStatus = "stale";
        }
      }

      results.push({
        email: u.email,
        name: u.display_name,
        google: googleStatus,
        apple: u.apple_calendar_connected ? "connected" : "none",
        outlook: u.outlook_calendar_connected ? "connected" : "none",
      });
    }

    const summary = {
      total: results.length,
      googleValid: results.filter((r) => r.google === "valid").length,
      googleStale: results.filter((r) => r.google === "stale").length,
      appleConnected: results.filter((r) => r.apple === "connected").length,
      outlookConnected: results.filter((r) => r.outlook === "connected").length,
    };

    res.json({ summary, users: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /calendar/disconnect — remove stored Google tokens */
app.post("/calendar/disconnect", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (dbUser?.calendar_watch_channel && dbUser.calendar_watch_resource_id) {
      try {
        const oauth2 = await getAuthedCalendarClient(req.uid!);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
          await calendarApi.channels.stop({
            requestBody: {
              id: dbUser.calendar_watch_channel,
              resourceId: dbUser.calendar_watch_resource_id,
            },
          });
        }
      } catch (stopErr) {
        console.error("Failed to stop calendar watch:", stopErr);
      }
    }

    await getSupabase()
      .from("users")
      .update({
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: null,
        calendar_watch_channel: null,
        calendar_watch_resource_id: null,
        calendar_sync_token: null,
      })
      .eq("firebase_uid", req.uid!);

    // Clear google_event_id from user's meetup_participants
    if (dbUser) {
      await getSupabase()
        .from("meetup_participants")
        .update({ google_event_id: null })
        .eq("user_id", dbUser.id);
    }

    // Only remove Google calendars (not Apple)
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
    console.log("User found:", !!user, "Apple connected:", !!user?.apple_calendar_connected);
    
    if (!user?.apple_caldav_username || !user?.apple_caldav_password) {
      console.error("Apple Calendar credentials missing for user:", req.uid);
      res.status(400).json({ error: "Apple Calendar not connected. Please reconnect in Settings." });
      return;
    }

    console.log("Fetching calendars from Apple CalDAV...");
    const calendars = await fetchAppleCalendars(user.apple_caldav_username, user.apple_caldav_password);
    console.log("Found", calendars.length, "Apple calendars");

    // Upsert fresh calendar metadata
    // Build a name map from the provider API (names are NOT stored in DB)
    const calNameMap = new Map<string, string>();
    const rows = calendars.map((cal) => {
      calNameMap.set(cal.url, cal.displayName || cal.url.split("/").filter(Boolean).pop() || "Apple Calendar");
      return {
        user_id: user.id,
        calendar_id: cal.url,
        calendar_color: null,
        access_role: "owner",
        source: "apple",
      };
    });

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
      .order("calendar_id");

    if (selectError) {
      console.error("Failed to fetch stored Apple calendars:", selectError);
    }

    // Merge provider-sourced names into the response (not stored in DB)
    const enriched = (stored || []).map((row: any) => ({
      ...row,
      calendar_name: calNameMap.get(row.calendar_id) || "Apple Calendar",
    }));

    console.log("Returning", enriched.length, "stored Apple calendars");
    res.json({ calendars: enriched });
  } catch (err: any) {
    console.error("Apple calendar list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Outlook Calendar (Microsoft Graph) routes
// ---------------------------------------------------------------------------

/** GET /calendar/outlook/auth-url — generate the Microsoft OAuth URL */
app.get("/calendar/outlook/auth-url", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const msalClient = getMsalClient();
    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: MICROSOFT_SCOPES,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || "https://slotted-ai.web.app/api/calendar/outlook/callback",
      state: req.uid!,
      prompt: "consent",
    });
    res.json({ url: authUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/outlook/callback — exchange the OAuth code for tokens */
app.get("/calendar/outlook/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }
  try {
    const msalClient = getMsalClient();
    const tokenResponse = await msalClient.acquireTokenByCode({
      code,
      scopes: MICROSOFT_SCOPES,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || "https://slotted-ai.web.app/api/calendar/outlook/callback",
    });

    await getSupabase()
      .from("users")
      .update({
        outlook_access_token: tokenResponse.accessToken,
        outlook_refresh_token: (tokenResponse as any).refreshToken || null,
        outlook_token_expires_at: tokenResponse.expiresOn?.toISOString() || null,
        outlook_calendar_connected: true,
      })
      .eq("firebase_uid", state);

    // Fetch and store user's Outlook calendars
    const graphClient = GraphClient.init({
      authProvider: (done) => done(null, tokenResponse.accessToken),
    });

    const calendarsRes = await graphClient.api("/me/calendars").get();
    const calendars = calendarsRes.value || [];

    const dbUser = await getDbUser(state);
    if (dbUser) {
      for (const cal of calendars) {
        const { data: existing } = await getSupabase()
          .from("user_calendars")
          .select("calendar_id")
          .eq("user_id", dbUser.id)
          .eq("calendar_id", cal.id)
          .single();

        if (existing) {
          await getSupabase()
            .from("user_calendars")
            .update({
              calendar_color: cal.hexColor || null,
              access_role: cal.canEdit ? "owner" : "reader",
            })
            .eq("user_id", dbUser.id)
            .eq("calendar_id", cal.id);
        } else {
          await getSupabase()
            .from("user_calendars")
            .insert({
              user_id: dbUser.id,
              calendar_id: cal.id,
              calendar_color: cal.hexColor || null,
              is_selected: cal.isDefaultCalendar || cal.canEdit,
              access_role: cal.canEdit ? "owner" : "reader",
              source: "outlook",
            });
        }
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || "https://slotted-ai.web.app";
    res.redirect(`${frontendUrl}/dashboard?calendar=connected`);
  } catch (err: any) {
    console.error("Outlook OAuth callback error:", err);
    const frontendUrl = process.env.FRONTEND_URL || "https://slotted-ai.web.app";
    res.redirect(`${frontendUrl}/dashboard?calendar=error`);
  }
});

/** POST /calendar/outlook/disconnect — remove stored Outlook tokens */
app.post("/calendar/outlook/disconnect", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await getSupabase()
      .from("users")
      .update({
        outlook_access_token: null,
        outlook_refresh_token: null,
        outlook_token_expires_at: null,
        outlook_calendar_connected: false,
      })
      .eq("firebase_uid", req.uid!);

    const dbUser = await getDbUser(req.uid!);
    if (dbUser) {
      await getSupabase()
        .from("user_calendars")
        .delete()
        .eq("user_id", dbUser.id)
        .eq("source", "outlook");
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/outlook/list — refresh Outlook calendar list */
app.get("/calendar/outlook/list", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const graphClient = await getOutlookGraphClient(req.uid!);
    if (!graphClient) {
      res.status(400).json({ error: "Outlook Calendar not connected" });
      return;
    }

    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const calendarsRes = await graphClient.api("/me/calendars").get();
    const calendars = calendarsRes.value || [];

    const calNameMap = new Map<string, string>();
    for (const cal of calendars) {
      calNameMap.set(cal.id, cal.name || "Outlook Calendar");

      const { data: existing } = await getSupabase()
        .from("user_calendars")
        .select("calendar_id")
        .eq("user_id", dbUser.id)
        .eq("calendar_id", cal.id)
        .single();

      if (existing) {
        await getSupabase()
          .from("user_calendars")
          .update({
            calendar_color: cal.hexColor || null,
            access_role: cal.canEdit ? "owner" : "reader",
          })
          .eq("user_id", dbUser.id)
          .eq("calendar_id", cal.id);
      } else {
        await getSupabase()
          .from("user_calendars")
          .insert({
            user_id: dbUser.id,
            calendar_id: cal.id,
            calendar_color: cal.hexColor || null,
            is_selected: cal.isDefaultCalendar || cal.canEdit,
            access_role: cal.canEdit ? "owner" : "reader",
            source: "outlook",
          });
      }
    }

    const { data: stored } = await getSupabase()
      .from("user_calendars")
      .select("*")
      .eq("user_id", dbUser.id)
      .eq("source", "outlook")
      .order("calendar_id");

    const enriched = (stored || []).map((row: any) => ({
      ...row,
      calendar_name: calNameMap.get(row.calendar_id) || "Outlook Calendar",
    }));

    res.json({ calendars: enriched });
  } catch (err: any) {
    console.error("Outlook calendar list error:", err);
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
      source: "google" | "apple" | "outlook";
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
            .select("calendar_id, calendar_color")
            .eq("user_id", dbUser.id)
            .eq("is_selected", true)
            .eq("source", "google");

          const googleCals = selectedGoogleCals || [];
          console.log("Google calendars selected:", googleCals.length, googleCals.map((c: any) => c.calendar_id));

          // If no Google calendars selected, check if any exist and auto-select owned ones
          if (googleCals.length === 0) {
            const { data: allGoogleCals } = await sb
              .from("user_calendars")
              .select("calendar_id, calendar_color, is_selected, access_role")
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
              console.log(`Fetching Google events for calendar ${cal.calendar_id}, timeMin=${now.toISOString()}, timeMax=${windowEnd.toISOString()}`);
              const eventsRes = await calendarApi.events.list({
                calendarId: cal.calendar_id,
                timeMin: now.toISOString(),
                timeMax: windowEnd.toISOString(),
                singleEvents: true,
                orderBy: "startTime",
                maxResults: 250,
              });

              const rawItems = eventsRes.data.items || [];
              console.log(`Google cal: ${rawItems.length} raw events`);

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
                  calendarName: "Google Calendar",
                  color: cal.calendar_color || "#4285f4",
                });
              }
            } catch (err) {
              console.error(`Failed to fetch events from Google cal ${cal.calendar_id}:`, err);
            }
          });

          await Promise.all(googlePromises);
        }
      } catch (err: any) {
        const errMsg = err?.response?.data?.error || err?.message || "";
        if (errMsg === "invalid_grant" || errMsg.includes("invalid_grant") || errMsg.includes("Token has been expired or revoked")) {
          // Clear stale tokens
          await getSupabase()
            .from("users")
            .update({
              google_access_token: null,
              google_refresh_token: null,
              google_token_expires_at: null,
            })
            .eq("id", dbUser.id);
          console.warn("Google Calendar token expired (invalid_grant) — cleared tokens for re-auth");
        } else {
          console.error("Google Calendar events fetch error:", err);
        }
      }
    }

    // --- Apple Calendar events ---
    const hasApple = !!(dbUser.apple_calendar_connected && dbUser.apple_caldav_username && dbUser.apple_caldav_password);
    if (hasApple) {
      try {
        const { data: selectedAppleCals } = await sb
          .from("user_calendars")
          .select("calendar_id")
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
                    calendarName: "Apple Calendar",
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

    // --- Outlook Calendar events ---
    const hasOutlookEv = !!(dbUser.outlook_calendar_connected && dbUser.outlook_refresh_token);
    if (hasOutlookEv) {
      try {
        const graphClient = await getOutlookGraphClient(req.uid!);
        if (graphClient) {
          const { data: selectedOutlookCals } = await sb
            .from("user_calendars")
            .select("calendar_id, calendar_color")
            .eq("user_id", dbUser.id)
            .eq("is_selected", true)
            .eq("source", "outlook");

          for (const cal of selectedOutlookCals || []) {
            try {
              const eventsRes = await graphClient
                .api(`/me/calendars/${(cal as any).calendar_id}/calendarView`)
                .query({
                  startDateTime: now.toISOString(),
                  endDateTime: windowEnd.toISOString(),
                })
                .select("id,subject,start,end,isAllDay,location,isCancelled,showAs")
                .top(250)
                .get();

              for (const event of eventsRes.value || []) {
                if (event.isCancelled) continue;

                const startDt = event.start?.dateTime;
                const endDt = event.end?.dateTime;
                if (!startDt || !endDt) continue;

                const isAllDay = !!event.isAllDay;
                let startVal: string;
                let endVal: string;
                if (isAllDay) {
                  startVal = startDt.slice(0, 10);
                  endVal = endDt.slice(0, 10);
                } else {
                  const tz = event.start?.timeZone || "UTC";
                  startVal = tz === "UTC" ? new Date(startDt + "Z").toISOString() : new Date(startDt).toISOString();
                  endVal = tz === "UTC" ? new Date(endDt + "Z").toISOString() : new Date(endDt).toISOString();
                }

                allEvents.push({
                  id: `outlook_${event.id}`,
                  title: event.subject || "Busy",
                  start: startVal,
                  end: endVal,
                  allDay: isAllDay,
                  location: event.location?.displayName || null,
                  source: "outlook",
                  calendarName: "Outlook Calendar",
                  color: (cal as any).calendar_color || "#0078d4",
                });
              }
            } catch (err) {
              console.error(`Failed to fetch events from Outlook cal ${(cal as any).calendar_id}:`, err);
            }
          }
        }
      } catch (err) {
        console.error("Outlook Calendar events fetch error:", err);
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

    // ─── Manual busy blocks: inject as calendar events for display ───
    {
      const { data: manualBlocks } = await sb
        .from("manual_busy_blocks")
        .select("*")
        .eq("user_id", dbUser.id)
        .gte("end_time", now.toISOString())
        .lte("start_time", windowEnd.toISOString());

      if (manualBlocks && manualBlocks.length > 0) {
        for (const block of manualBlocks) {
          allEvents.push({
            id: `manual_${block.id}`,
            title: block.label || "Busy",
            start: new Date(block.start_time).toISOString(),
            end: new Date(block.end_time).toISOString(),
            allDay: false,
            location: null,
            source: "google" as const, // use google source so styling doesn't break
            calendarName: "Slotted",
            color: "#f59e0b", // amber-500 to distinguish manual blocks
          });
        }
        console.log(`Manual busy blocks: injected ${manualBlocks.length} blocks into calendar display`);
      }
    }

    // Deduplicate events that appear across multiple calendars
    // Match on normalized title + start + end (keep the first occurrence)
    const seen = new Set<string>();
    const dedupedEvents: CalEvent[] = [];
    for (const ev of allEvents) {
      // Skip dedup for synthetic events (buffers, manual blocks)
      if (ev.id.startsWith("buffer_") || ev.id.startsWith("manual_")) {
        dedupedEvents.push(ev);
        continue;
      }
      const key = `${ev.title.toLowerCase().trim()}|${ev.start}|${ev.end}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedEvents.push(ev);
      }
    }

    // Sort by start time
    dedupedEvents.sort((a, b) => a.start.localeCompare(b.start));

    const googleCount = dedupedEvents.filter(e => e.source === "google" && !e.id.startsWith("manual_")).length;
    const appleCount = dedupedEvents.filter(e => e.source === "apple").length;
    const bufferCount = dedupedEvents.filter(e => e.id.startsWith("buffer_")).length;
    const manualCount = dedupedEvents.filter(e => e.id.startsWith("manual_")).length;
    const dupCount = allEvents.length - dedupedEvents.length;
    console.log(`Calendar events: ${dedupedEvents.length} total (${googleCount} Google, ${appleCount} Apple, ${bufferCount} trip buffers, ${manualCount} manual blocks${dupCount > 0 ? `, ${dupCount} duplicates removed` : ""})`);

    res.json({
      events: dedupedEvents,
      sources: {
        google: hasGoogle,
        apple: hasApple,
      },
    });

    // Fire-and-forget: sync availability slots in the background
    // so the scheduling engine stays fresh without a separate client call
    if (hasGoogle || hasApple) {
      syncUserCalendar(req.uid!).catch((err) =>
        console.error("Background availability sync error:", err)
      );
    }
  } catch (err: any) {
    console.error("Calendar events error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Manual Busy Blocks — users can mark times as busy on the dashboard calendar
// ---------------------------------------------------------------------------

/** GET /busy-blocks — fetch user's manual busy blocks for a time range */
app.get("/busy-blocks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const daysAhead = parseInt(req.query.days as string) || 30;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const { data: blocks, error } = await getSupabase()
      .from("manual_busy_blocks")
      .select("*")
      .eq("user_id", me.id)
      .gte("end_time", now.toISOString())
      .lte("start_time", windowEnd.toISOString())
      .order("start_time", { ascending: true });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ blocks: blocks || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /busy-blocks — create a manual busy block */
app.post("/busy-blocks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { start_time, end_time, label } = req.body;
    if (!start_time || !end_time) {
      res.status(400).json({ error: "start_time and end_time required" });
      return;
    }
    if (new Date(end_time) <= new Date(start_time)) {
      res.status(400).json({ error: "end_time must be after start_time" });
      return;
    }

    const { data: block, error } = await getSupabase()
      .from("manual_busy_blocks")
      .insert({
        user_id: me.id,
        start_time,
        end_time,
        label: label || "Busy",
      })
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Re-sync availability in the background (don't block the response)
    syncUserCalendar(req.uid!).catch((e) => console.error("Background sync after busy block add:", e));

    res.json({ block });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /busy-blocks/batch — create multiple manual busy blocks at once (for drag-to-select) */
app.post("/busy-blocks/batch", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { blocks } = req.body;
    if (!Array.isArray(blocks) || blocks.length === 0) {
      res.status(400).json({ error: "blocks must be a non-empty array" });
      return;
    }
    if (blocks.length > 50) {
      res.status(400).json({ error: "Maximum 50 blocks per batch" });
      return;
    }

    const rows = blocks
      .filter((b: any) => b.start_time && b.end_time && new Date(b.end_time) > new Date(b.start_time))
      .map((b: any) => ({
        user_id: me.id,
        start_time: b.start_time,
        end_time: b.end_time,
        label: b.label || "Busy",
      }));

    if (rows.length === 0) {
      res.status(400).json({ error: "No valid blocks provided" });
      return;
    }

    const { data: inserted, error } = await getSupabase()
      .from("manual_busy_blocks")
      .insert(rows)
      .select();

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Re-sync in the background
    syncUserCalendar(req.uid!).catch((e) => console.error("Background sync after batch busy block:", e));

    res.json({ blocks: inserted || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /busy-blocks/:blockId — remove a manual busy block */
app.delete("/busy-blocks/:blockId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { blockId } = req.params;
    const { error } = await getSupabase()
      .from("manual_busy_blocks")
      .delete()
      .eq("id", blockId)
      .eq("user_id", me.id);

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Re-sync availability in the background
    syncUserCalendar(req.uid!).catch((e) => console.error("Background sync after busy block delete:", e));

    res.json({ deleted: true });
  } catch (err: any) {
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
    // Build a name map from the provider API (names are NOT stored in DB)
    const calNameMap = new Map<string, string>();
    for (const cal of calendars) {
      calNameMap.set(cal.id!, cal.summary || cal.id!);

      const row = {
        user_id: dbUser.id,
        calendar_id: cal.id!,
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
      .order("calendar_id");

    // Merge provider-sourced names into the response (not stored in DB)
    const enriched = (stored || []).map((row: any) => ({
      ...row,
      calendar_name: calNameMap.get(row.calendar_id) || row.calendar_id,
    }));

    res.json({ calendars: enriched });
  } catch (err: any) {
    console.error("Calendar list error:", err);
    // Detect expired/revoked tokens and tell the client to reconnect
    const errMsg = err?.response?.data?.error || err?.message || "";
    if (errMsg === "invalid_grant" || errMsg.includes("invalid_grant") || errMsg.includes("Token has been expired or revoked")) {
      // Clear stale tokens so user can re-auth
      const dbUser = await getDbUser(req.uid!);
      if (dbUser) {
        await getSupabase()
          .from("users")
          .update({
            google_access_token: null,
            google_refresh_token: null,
            google_token_expires_at: null,
          })
          .eq("id", dbUser.id);
      }
      res.status(401).json({ error: "calendar_reconnect_required", message: "Your Google Calendar connection has expired. Please reconnect." });
      return;
    }
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
      .order("calendar_id");

    res.json({ calendars: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /calendar/selected — update which calendars are selected */
app.put("/calendar/selected", requireAuth, async (req: AuthRequest, res: Response) => {
  const { calendarIds, source = "google" } = req.body; // array of provider calendar IDs to select
  if (!Array.isArray(calendarIds)) {
    res.status(400).json({ error: "calendarIds must be an array" });
    return;
  }
  if (!["google", "apple", "outlook"].includes(source)) {
    res.status(400).json({ error: "source must be google, apple, or outlook" });
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
      .eq("user_id", dbUser.id)
      .eq("source", source);

    if (calendarIds.length > 0) {
      await getSupabase()
        .from("user_calendars")
        .update({ is_selected: true })
        .eq("user_id", dbUser.id)
        .eq("source", source)
        .in("calendar_id", calendarIds);
    }

    // Return updated list
    const { data } = await getSupabase()
      .from("user_calendars")
      .select("*")
      .eq("user_id", dbUser.id)
      .order("calendar_id");

    res.json({ calendars: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Google Calendar change processing (Phase 2)
// ---------------------------------------------------------------------------

async function processCalendarChanges(
  firebaseUid: string,
  changedEvents: calendar_v3.Schema$Event[],
): Promise<void> {
  const sb = getSupabase();
  const dbUser = await getDbUser(firebaseUid);
  if (!dbUser) return;

  for (const event of changedEvents) {
    if (!event.id) continue;

    const { data: participant } = await sb
      .from("meetup_participants")
      .select("id, meetup_id, user_id, rsvp, rsvp_source, gcal_etag, gcal_last_synced_at")
      .eq("google_event_id", event.id)
      .eq("user_id", dbUser.id)
      .single();

    if (!participant) continue;

    if (event.etag && participant.gcal_etag === event.etag) continue;

    // Feedback loop prevention: if an app-sourced RSVP was made very recently,
    // skip overwriting it from a stale webhook but still update the etag
    const isRecentAppChange = participant.rsvp_source === "app"
      && participant.gcal_last_synced_at
      && (Date.now() - new Date(participant.gcal_last_synced_at).getTime()) < 60000;

    const { data: meetup } = await sb
      .from("meetups")
      .select("id, title, status, start_time, end_time, created_by")
      .eq("id", participant.meetup_id)
      .single();

    if (!meetup || ["cancelled", "completed"].includes(meetup.status)) continue;

    if (event.status === "cancelled") {
      if (participant.rsvp !== "declined" && !isRecentAppChange) {
        await updateRsvpFromCalendar(participant, meetup, dbUser, "declined");
      }
      // Always update etag so we don't reprocess this event
      await sb.from("meetup_participants").update({
        gcal_etag: event.etag,
        gcal_last_synced_at: new Date().toISOString(),
      }).eq("id", participant.id);
      continue;
    }

    const myAttendee = (event.attendees || []).find(
      (a) => a.email === dbUser.email || a.self,
    );
    if (myAttendee?.responseStatus) {
      const mappedRsvp = mapGoogleRsvp(myAttendee.responseStatus);
      if (mappedRsvp && mappedRsvp !== participant.rsvp && !isRecentAppChange) {
        await updateRsvpFromCalendar(participant, meetup, dbUser, mappedRsvp);
      }
    }

    // --- TIME CHANGE ---
    if (event.start && event.end) {
      const eventStart = event.start.dateTime || event.start.date;
      const eventEnd = event.end.dateTime || event.end.date;

      if (eventStart && eventEnd) {
        const meetupStart = new Date(meetup.start_time).toISOString();
        const meetupEnd = new Date(meetup.end_time).toISOString();
        const newStart = new Date(eventStart).toISOString();
        const newEnd = new Date(eventEnd).toISOString();

        if (newStart !== meetupStart || newEnd !== meetupEnd) {
          if (participant.user_id === meetup.created_by) {
            // Count participants to determine if this is a group meetup
            const { count: participantCount } = await sb
              .from("meetup_participants")
              .select("id", { count: "exact", head: true })
              .eq("meetup_id", meetup.id);

            const isGroupMeetup = (participantCount || 0) > 2;

            // Notify all other participants
            const { data: allParts } = await sb
              .from("meetup_participants")
              .select("user_id")
              .eq("meetup_id", meetup.id)
              .neq("user_id", participant.user_id);

            if (isGroupMeetup) {
              // Group meetup: don't auto-update time, notify others to consent
              for (const p of (allParts || [])) {
                await createNotification({
                  userId: p.user_id,
                  type: "meetup_time_changed",
                  title: `🕐 ${dbUser.display_name || "Someone"} wants to change the time`,
                  body: `${meetup.title || "Hangout"} — proposed ${new Date(newStart).toLocaleString()}`,
                  relatedUserId: dbUser.id,
                  relatedId: meetup.id,
                });
              }
            } else {
              // 1:1 meetup: auto-update time for both participants
              await sb.from("meetups").update({
                start_time: newStart,
                end_time: newEnd,
              }).eq("id", meetup.id);

              for (const p of (allParts || [])) {
                await createNotification({
                  userId: p.user_id,
                  type: "meetup_time_changed",
                  title: `🕐 ${dbUser.display_name || "Someone"} updated the time`,
                  body: meetup.title || "Hangout",
                  relatedUserId: dbUser.id,
                  relatedId: meetup.id,
                });
              }
            }
          } else {
            // Non-creator moved their calendar event — counter-propose
            await createNotification({
              userId: meetup.created_by,
              type: "meetup_counter_propose",
              title: `💡 ${dbUser.display_name || "Someone"} suggests a different time`,
              body: `${meetup.title || "Hangout"} — they moved it to ${new Date(newStart).toLocaleString()}`,
              relatedUserId: dbUser.id,
              relatedId: meetup.id,
            });
          }
        }
      }
    }

    await sb.from("meetup_participants").update({
      gcal_etag: event.etag,
      gcal_last_synced_at: new Date().toISOString(),
    }).eq("id", participant.id);
  }
}

function mapGoogleRsvp(googleStatus: string): string | null {
  switch (googleStatus) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentative":
      return "maybe";
    case "needsAction":
      return null;
    default:
      return null;
  }
}

async function updateRsvpFromCalendar(
  participant: any,
  meetup: any,
  dbUser: any,
  newRsvp: string,
): Promise<void> {
  const sb = getSupabase();

  await sb.from("meetup_participants").update({
    rsvp: newRsvp,
    rsvp_source: "google_calendar",
  }).eq("id", participant.id);

  if (newRsvp === "declined") {
    const { data: allParticipants } = await sb
      .from("meetup_participants")
      .select("user_id, rsvp")
      .eq("meetup_id", meetup.id);

    if (allParticipants && allParticipants.length <= 2) {
      await sb
        .from("meetups")
        .update({ status: "cancelled" })
        .eq("id", meetup.id);
    }

    for (const p of (allParticipants || [])) {
      if (p.user_id !== dbUser.id) {
        await createNotification({
          userId: p.user_id,
          type: "meetup_rsvp_changed",
          title: `${dbUser.display_name || "Someone"} is no longer available`,
          body: meetup.title || "Hangout",
          relatedUserId: dbUser.id,
          relatedId: meetup.id,
        });
      }
    }
  } else if (newRsvp === "maybe") {
    if (meetup.created_by !== dbUser.id) {
      await createNotification({
        userId: meetup.created_by,
        type: "meetup_rsvp_changed",
        title: `🤔 ${dbUser.display_name || "Someone"} is now a maybe`,
        body: meetup.title || "Hangout",
        relatedUserId: dbUser.id,
        relatedId: meetup.id,
      });
    }
  } else if (newRsvp === "accepted" && meetup.created_by !== dbUser.id) {
    await createNotification({
      userId: meetup.created_by,
      type: "meetup_confirmed",
      title: `✅ ${dbUser.display_name || "Someone"} accepted`,
      body: meetup.title || "Hangout",
      relatedUserId: dbUser.id,
      relatedId: meetup.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Google Calendar webhook receiver (public — Google sends POST here)
// ---------------------------------------------------------------------------
app.post("/webhooks/google-calendar", async (req: Request, res: Response) => {
  if (!GOOGLE_WEBHOOK_SECRET) {
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  const providedSecret =
    (req.headers["x-webhook-secret"] as string | undefined) ||
    (req.headers["x-goog-channel-token"] as string | undefined);
  if (!providedSecret || providedSecret !== GOOGLE_WEBHOOK_SECRET) {
    console.warn("Webhook received with invalid or missing token:", { providedSecret: !!providedSecret });
    res.status(200).send("OK");
    return;
  }

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
        const oauth2 = await getAuthedCalendarClient(user.firebase_uid);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
          const dbUser = await getDbUser(user.firebase_uid);
          try {
            const eventsRes = await calendarApi.events.list({
              calendarId: "primary",
              syncToken: dbUser?.calendar_sync_token || undefined,
              maxResults: 50,
            });
            if (eventsRes.data.items) {
              await processCalendarChanges(user.firebase_uid, eventsRes.data.items);
            }
            if (eventsRes.data.nextSyncToken) {
              await getSupabase()
                .from("users")
                .update({
                  calendar_sync_token: eventsRes.data.nextSyncToken,
                })
                .eq("firebase_uid", user.firebase_uid);
            }
          } catch (syncErr: any) {
            if (syncErr?.code === 410) {
              // Clear stale sync token
              await getSupabase()
                .from("users")
                .update({
                  calendar_sync_token: null,
                })
                .eq("firebase_uid", user.firebase_uid);
              console.warn("Sync token stale (410). Retrying with full sync...");

              // Immediately retry with a full sync (no syncToken)
              try {
                const fullSyncRes = await calendarApi.events.list({
                  calendarId: "primary",
                  maxResults: 50,
                });
                if (fullSyncRes.data.items) {
                  await processCalendarChanges(user.firebase_uid, fullSyncRes.data.items);
                }
                if (fullSyncRes.data.nextSyncToken) {
                  await getSupabase()
                    .from("users")
                    .update({
                      calendar_sync_token: fullSyncRes.data.nextSyncToken,
                    })
                    .eq("firebase_uid", user.firebase_uid);
                }
              } catch (retryErr) {
                console.error("Full sync retry also failed:", retryErr);
              }
            } else {
              console.error("Incremental sync error:", syncErr);
            }
          }
        }
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
app.post("/admin/migrate", requireAdmin, async (_req: Request, res: Response) => {
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

export const renewCalendarWatchChannels = onSchedule("every 6 hours", async () => {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: users } = await sb.from("users")
    .select("id, firebase_uid, calendar_watch_channel, calendar_watch_resource_id")
    .not("google_refresh_token", "is", null)
    .lt("calendar_watch_expiry", cutoff);

  for (const user of (users || [])) {
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

  // ─── Proactive free-time matching: "You and X are both free this weekend" ───
  try {
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
          }
        }
      }
    }
    console.log("Proactive weekend calendar matching complete");
  } catch (calMatchErr) {
    console.error("Error in proactive calendar matching:", calMatchErr);
  }
});

// ===========================================================================
// ADMIN / STAGING ENDPOINTS
// ===========================================================================
// These endpoints let you inspect and manage any user's data for QA/staging
// purposes. Protected by a shared secret sent via X-Admin-Secret header or
// body.secret field.
// ---------------------------------------------------------------------------

const ADMIN_SECRET = process.env.ADMIN_SECRET || "slotted-admin-2026";

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const secret =
    (req.headers["x-admin-secret"] as string) ||
    req.body?.secret;
  if (secret !== ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden — invalid admin secret" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /admin/users — list all users (id, email, display_name, onboarded, created_at)
// ---------------------------------------------------------------------------
app.get("/admin/users", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("users")
      .select("id, firebase_uid, email, display_name, photo_url, onboarded, social_battery, created_at")
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id — full user profile (by Supabase UUID)
// ---------------------------------------------------------------------------
app.get("/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("users")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) { res.status(404).json({ error: "User not found" }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/notifications — view a user's notifications
// ---------------------------------------------------------------------------
app.get("/admin/users/:id/notifications", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("notifications")
      .select("*, related_user:related_user_id(display_name, photo_url)")
      .eq("user_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/notifications — bulk delete all notifications for a user
// Supports optional query params:
//   ?type=meetup_request        — only delete notifications of this type
//   ?olderThan=2026-01-01       — only delete notifications before this date
// ---------------------------------------------------------------------------
app.delete("/admin/users/:id/notifications", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    let query = sb
      .from("notifications")
      .delete()
      .eq("user_id", req.params.id);

    if (req.query.type) {
      query = query.eq("type", req.query.type as string);
    }
    if (req.query.olderThan) {
      query = query.lt("created_at", req.query.olderThan as string);
    }

    const { error, count } = await query.select("id", { count: "exact", head: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ deleted: count ?? 0, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/notifications/:id — delete a single notification by ID
// ---------------------------------------------------------------------------
app.delete("/admin/notifications/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("notifications")
      .delete()
      .eq("id", req.params.id);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/notifications/mark-all-read — mark all as read for a user
// ---------------------------------------------------------------------------
app.post("/admin/users/:id/notifications/mark-all-read", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("notifications")
      .update({ read: true })
      .eq("user_id", req.params.id)
      .eq("read", false);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/fcm-tokens — view push notification tokens for debugging
// ---------------------------------------------------------------------------
app.get("/admin/users/:id/fcm-tokens", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("fcm_tokens")
      .select("*")
      .eq("user_id", req.params.id)
      .order("updated_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/fcm-tokens — clear all FCM tokens for a user (forces re-registration)
// ---------------------------------------------------------------------------
app.delete("/admin/users/:id/fcm-tokens", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("fcm_tokens")
      .delete()
      .eq("user_id", req.params.id);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true, message: "FCM tokens cleared — user will re-register on next visit" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/meetups — view a user's meetups and participation status
// ---------------------------------------------------------------------------
app.get("/admin/users/:id/meetups", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();

    // Get meetup IDs this user is part of
    const { data: participations, error: pErr } = await sb
      .from("meetup_participants")
      .select("meetup_id, rsvp, is_organizer")
      .eq("user_id", req.params.id);

    if (pErr) { res.status(500).json({ error: pErr.message }); return; }
    if (!participations || participations.length === 0) {
      res.json([]);
      return;
    }

    const meetupIds = participations.map((p: any) => p.meetup_id);
    const { data: meetups, error: mErr } = await sb
      .from("meetups")
      .select("id, title, status, start_time, end_time, location, created_at")
      .in("id", meetupIds)
      .order("start_time", { ascending: false })
      .limit(50);

    if (mErr) { res.status(500).json({ error: mErr.message }); return; }

    // Merge RSVP info
    const rsvpMap = new Map(participations.map((p: any) => [p.meetup_id, p]));
    const enriched = (meetups || []).map((m: any) => ({
      ...m,
      my_rsvp: rsvpMap.get(m.id)?.rsvp,
      is_organizer: rsvpMap.get(m.id)?.is_organizer,
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/friendships — view a user's friendships
// ---------------------------------------------------------------------------
app.get("/admin/users/:id/friendships", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const userId = req.params.id;

    const { data, error } = await sb
      .from("friendships")
      .select("*, user_a:user_a_id(id, display_name, email), user_b:user_b_id(id, display_name, email)")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/stats — quick overview of the platform
// ---------------------------------------------------------------------------
app.get("/admin/stats", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const sb = getSupabase();

    const [users, meetups, friendships, notifications] = await Promise.all([
      sb.from("users").select("id", { count: "exact", head: true }),
      sb.from("meetups").select("id", { count: "exact", head: true }),
      sb.from("friendships").select("id", { count: "exact", head: true }),
      sb.from("notifications").select("id", { count: "exact", head: true }),
    ]);

    res.json({
      users: users.count ?? 0,
      meetups: meetups.count ?? 0,
      friendships: friendships.count ?? 0,
      notifications: notifications.count ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /admin/sync-logs — query calendar sync outcomes for monitoring */
app.get("/admin/sync-logs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const hours = parseInt(req.query.hours as string) || 24;
    const status = req.query.status as string;
    const userId = req.query.user_id as string;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    let query = sb
      .from("sync_log")
      .select("*, users!inner(email, display_name)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) query = query.eq("status", status);
    if (userId) query = query.eq("user_id", userId);

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Summary stats
    const total = data?.length ?? 0;
    const errors = data?.filter((r: any) => r.status === "error").length ?? 0;
    const avgDuration = total > 0
      ? Math.round(data!.reduce((sum: number, r: any) => sum + (r.duration_ms || 0), 0) / total)
      : 0;

    res.json({
      summary: { total, errors, avgDurationMs: avgDuration, hoursQueried: hours },
      logs: data,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/friendships — create or fix a friendship between two users
// Body: { userAId, userBId, status? }
// ---------------------------------------------------------------------------
app.post("/admin/friendships", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { userAId, userBId, status } = req.body;
    if (!userAId || !userBId) {
      res.status(400).json({ error: "userAId and userBId are required" });
      return;
    }
    // Canonical ordering
    const [uA, uB] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

    const { data, error } = await sb
      .from("friendships")
      .upsert(
        {
          user_a_id: uA,
          user_b_id: uB,
          invited_by: uA,
          status: status || "accepted",
        },
        { onConflict: "user_a_id,user_b_id" },
      )
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Global error handler — catches unhandled errors in routes
// ---------------------------------------------------------------------------
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[UNHANDLED] ${req.method} ${req.path}: ${err.message}`, err.stack?.split("\n").slice(0, 3).join("\n"));
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Export as Firebase Cloud Function
// ---------------------------------------------------------------------------
export const api = onRequest({ memory: "512MiB" }, app);
