import express, { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
  getAuthedCalendarClient,
  getOAuth2Client,
  getOutlookGraphClient,
  getMsalClient,
  signOAuthState,
  verifyOAuthState,
  overlayOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
  syncUserCalendar,
  GOOGLE_WEBHOOK_SECRET,
  MICROSOFT_SCOPES,
  createNotification,
  autoAddToCalendar,
  isMeetupParticipant,
} from "../utils/helpers";
import { getSupabase } from "../supabase";
import { google } from "googleapis";
import { createDAVClient, DAVCalendar, DAVObject } from "tsdav";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import type { calendar_v3 } from "googleapis";

const router = express.Router();

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

// Google Calendar OAuth routes + Apple + Outlook + calendar events + busy blocks + calendar list/selected + sync helpers
// ---------------------------------------------------------------------------
// Google Calendar OAuth routes
// ---------------------------------------------------------------------------

/** GET /calendar/auth-url — generate the OAuth URL so the client can redirect */
router.get("/calendar/auth-url", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      state: signOAuthState(req.uid!),
    });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/callback — exchange the OAuth code for tokens */
router.get("/calendar/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }
  const { uid: firebaseUid, valid } = verifyOAuthState(state);
  if (!valid) {
    res.status(403).json({ error: "Invalid or expired OAuth state" });
    return;
  }
  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    // Store tokens in Vault
    const dbUserForTokens = await getDbUser(firebaseUid);
    if (dbUserForTokens) {
      await saveOAuthTokens(dbUserForTokens.id, "google", {
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || undefined,
        token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : undefined,
      });
    }

    // After storing tokens, auto-fetch the user's calendar list and store defaults
    oauth2.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const calListRes = await calendar.calendarList.list();
    const calendars = calListRes.data.items || [];

    const dbUser = await getDbUser(firebaseUid);
    if (dbUser) {
      for (const cal of calendars) {
        const { data: existing } = await getSupabase()
          .from("user_calendars")
          .select("calendar_id")
          .eq("user_id", dbUser.id)
          .eq("calendar_id", cal.id!)
          .maybeSingle();

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
router.get("/calendar/status", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/admin/calendar-health", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    // Simple admin check: only allow the app owner
    if (!me?.email || !["sharipaltrowitz@gmail.com"].includes(me.email)) {
      res.status(403).json({ error: "Admin only" });
      return;
    }

    // Get users with any calendar connection (check both boolean flags and oauth_tokens table)
    const { data: oauthUserIds } = await getSupabase().rpc("users_with_oauth_provider", { p_provider: "google" });
    const oauthIds = new Set((oauthUserIds || []).map((r: any) => r.user_id));

    const { data: users } = await getSupabase()
      .from("users")
      .select("id, email, display_name, apple_calendar_connected, outlook_calendar_connected")
      .or("apple_calendar_connected.eq.true,outlook_calendar_connected.eq.true");

    // Merge: include users with oauth tokens even if boolean flags are false
    const allUserIds = new Set((users || []).map((u: any) => u.id));
    const missingOauthUsers: any[] = [];
    for (const oId of oauthIds) {
      if (!allUserIds.has(oId)) {
        const { data: u } = await getSupabase()
          .from("users")
          .select("id, email, display_name, apple_calendar_connected, outlook_calendar_connected")
          .eq("id", oId)
          .maybeSingle();
        if (u) missingOauthUsers.push(u);
      }
    }
    const allUsers = [...(users || []), ...missingOauthUsers];

    const results: {
      email: string;
      name: string | null;
      google: "valid" | "stale" | "none";
      apple: "connected" | "none";
      outlook: "connected" | "none";
    }[] = [];

    for (const u of allUsers) {
      // Overlay tokens from vault for this user
      await overlayOAuthTokens(u);
      let googleStatus: "valid" | "stale" | "none" = "none";
      if ((u as any).google_refresh_token) {
        // Look up firebase_uid for this user to test their token
        const { data: fullUser } = await getSupabase()
          .from("users")
          .select("firebase_uid")
          .eq("id", u.id)
          .maybeSingle();

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
          } catch (err) { console.error(err);
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
router.post("/calendar/disconnect", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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

    // Clear tokens from Vault
    if (dbUser) {
      await deleteOAuthTokens(dbUser.id, "google");
    }

    await getSupabase()
      .from("users")
      .update({
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
router.post("/calendar/apple/connect", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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

    // Store credentials in Vault
    await saveOAuthTokens(dbUser.id, "apple", {
      caldav_username: username,
      caldav_password: password,
    });

    await getSupabase()
      .from("users")
      .update({
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
router.get("/calendar/apple/status", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.post("/calendar/apple/disconnect", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);

    // Clear Apple tokens from Vault
    if (dbUser) {
      await deleteOAuthTokens(dbUser.id, "apple");
    }

    await getSupabase()
      .from("users")
      .update({
        apple_calendar_connected: false,
      })
      .eq("firebase_uid", req.uid!);

    // Remove Apple calendars
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
router.get("/calendar/apple/list", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/calendar/outlook/auth-url", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const msalClient = getMsalClient();
    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: MICROSOFT_SCOPES,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || "https://slotted-ai.web.app/api/calendar/outlook/callback",
      state: signOAuthState(req.uid!),
      prompt: "consent",
    });
    res.json({ url: authUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/outlook/callback — exchange the OAuth code for tokens */
router.get("/calendar/outlook/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }
  const { uid: firebaseUid, valid } = verifyOAuthState(state);
  if (!valid) {
    res.status(403).json({ error: "Invalid or expired OAuth state" });
    return;
  }
  try {
    const msalClient = getMsalClient();
    const tokenResponse = await msalClient.acquireTokenByCode({
      code,
      scopes: MICROSOFT_SCOPES,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || "https://slotted-ai.web.app/api/calendar/outlook/callback",
    });

    // Store tokens in Vault
    const dbUserForOutlook = await getDbUser(firebaseUid);
    if (dbUserForOutlook) {
      await saveOAuthTokens(dbUserForOutlook.id, "outlook", {
        access_token: tokenResponse.accessToken,
        refresh_token: (tokenResponse as any).refreshToken || undefined,
        token_expires_at: tokenResponse.expiresOn?.toISOString() || undefined,
      });
    }

    await getSupabase()
      .from("users")
      .update({
        outlook_calendar_connected: true,
      })
      .eq("firebase_uid", firebaseUid);

    // Fetch and store user's Outlook calendars
    const graphClient = GraphClient.init({
      authProvider: (done) => done(null, tokenResponse.accessToken),
    });

    const calendarsRes = await graphClient.api("/me/calendars").get();
    const calendars = calendarsRes.value || [];

    const dbUser = await getDbUser(firebaseUid);
    if (dbUser) {
      for (const cal of calendars) {
        const { data: existing } = await getSupabase()
          .from("user_calendars")
          .select("calendar_id")
          .eq("user_id", dbUser.id)
          .eq("calendar_id", cal.id)
          .maybeSingle();

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
router.post("/calendar/outlook/disconnect", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);

    // Clear Outlook tokens from Vault
    if (dbUser) {
      await deleteOAuthTokens(dbUser.id, "outlook");
    }

    await getSupabase()
      .from("users")
      .update({
        outlook_calendar_connected: false,
      })
      .eq("firebase_uid", req.uid!);

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
router.get("/calendar/outlook/list", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
        .maybeSingle();

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
router.get("/calendar/events", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
          // Clear stale tokens from Vault
          await deleteOAuthTokens(dbUser.id, "google");
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

      // Build a set of every calendar day occupied by a trip.
      // This prevents creating "pre-trip" or "recovery" markers while the user is still traveling.
      const tripDays = new Set<string>();
      for (const trip of trips) {
        const cursor = new Date(trip.start + "T00:00:00");
        const endExclusive = new Date(trip.end + "T00:00:00");
        while (cursor < endExclusive) {
          tripDays.add(cursor.toISOString().slice(0, 10));
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      for (const trip of trips) {
        if (tripBufferBefore) {
          const dayBefore = new Date(trip.start + "T00:00:00");
          dayBefore.setDate(dayBefore.getDate() - 1);
          const bufferDate = dayBefore.toISOString().slice(0, 10);
          if (tripDays.has(bufferDate)) {
            // Already traveling this day; skip pre-trip buffer.
            continue;
          }
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
          if (tripDays.has(recoveryDate)) {
            // Still traveling this day due to another overlapping/adjacent trip.
            continue;
          }
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
    // Also collapse synthetic trip buffers to max 1 per day+type.
    const seen = new Set<string>();
    const seenBufferDay = new Set<string>();
    const dedupedEvents: CalEvent[] = [];
    for (const ev of allEvents) {
      if (ev.id.startsWith("buffer_")) {
        const key = `${ev.title.toLowerCase().trim()}|${ev.start.slice(0, 10)}`;
        if (!seenBufferDay.has(key)) {
          seenBufferDay.add(key);
          dedupedEvents.push(ev);
        }
        continue;
      }
      // Skip dedup for manual blocks
      if (ev.id.startsWith("manual_")) {
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
router.get("/busy-blocks", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.post("/busy-blocks", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Re-sync availability in the background (don't block the response)
    syncUserCalendar(req.uid!).catch((e) => console.error("Background sync after busy block add:", e));

    res.json({ block });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /busy-blocks/batch — create multiple manual busy blocks at once (for drag-to-select) */
router.post("/busy-blocks/batch", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.delete("/busy-blocks/:blockId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/calendar/list", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
        .maybeSingle();

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
        await deleteOAuthTokens(dbUser.id, "google");
      }
      res.status(401).json({ error: "calendar_reconnect_required", message: "Your Google Calendar connection has expired. Please reconnect." });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/** GET /calendar/selected — get only the selected calendar IDs */
router.get("/calendar/selected", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.put("/calendar/selected", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

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
      .maybeSingle();

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


// Google Calendar webhook receiver (public — Google sends POST here)
// ---------------------------------------------------------------------------
// Google Calendar webhook receiver (public — Google sends POST here)
// ---------------------------------------------------------------------------
router.post("/webhooks/google-calendar", async (req: Request, res: Response) => {
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
        .maybeSingle();

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

export default router;
