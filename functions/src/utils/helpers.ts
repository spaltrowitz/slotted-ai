import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import { createDAVClient, DAVCalendar, DAVObject } from "tsdav";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import { createHmac } from "crypto";
import { getSupabase } from "../supabase";

// Slotted's calendar identity — added as a guest to all meetup events
export const SLOTTED_CALENDAR_GUEST = {
  email: "slotted.ai@gmail.com",
  displayName: "Slotted.ai",
  responseStatus: "accepted",
};

// ---------------------------------------------------------------------------
// OAuth State helpers (CSRF protection for OAuth callbacks)
// ---------------------------------------------------------------------------
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || "";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function signOAuthState(uid: string): string {
  if (!OAUTH_STATE_SECRET) throw new Error("OAUTH_STATE_SECRET not configured");
  const timestamp = Date.now().toString();
  const hmac = createHmac("sha256", OAUTH_STATE_SECRET)
    .update(`${uid}:${timestamp}`)
    .digest("hex");
  return `${uid}:${timestamp}:${hmac}`;
}

export function verifyOAuthState(state: string): { uid: string; valid: boolean } {
  if (!OAUTH_STATE_SECRET) return { uid: "", valid: false };
  const parts = state.split(":");
  if (parts.length !== 3) return { uid: "", valid: false };
  const [uid, timestamp, receivedHmac] = parts;
  const expectedHmac = createHmac("sha256", OAUTH_STATE_SECRET)
    .update(`${uid}:${timestamp}`)
    .digest("hex");
  if (expectedHmac !== receivedHmac) return { uid: "", valid: false };
  const age = Date.now() - parseInt(timestamp, 10);
  if (age > OAUTH_STATE_MAX_AGE_MS || age < 0) return { uid: "", valid: false };
  return { uid, valid: true };
}

export const GOOGLE_WEBHOOK_SECRET = process.env.GOOGLE_WEBHOOK_SECRET || "";

// ---------------------------------------------------------------------------
// Async route handler wrapper — catches unhandled promise rejections
// ---------------------------------------------------------------------------
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Overlay decrypted OAuth tokens from Vault onto a user row */
export async function overlayOAuthTokens(user: Record<string, any>): Promise<void> {
  if (!user?.id) return;
  const { data: tokens } = await getSupabase().rpc("get_all_user_oauth_tokens", {
    p_user_id: user.id,
  });
  if (!tokens) return;
  for (const t of tokens as any[]) {
    if (t.provider === "google") {
      user.google_access_token = t.access_token || null;
      user.google_refresh_token = t.refresh_token || null;
      user.google_token_expires_at = t.token_expires_at || null;
    } else if (t.provider === "outlook") {
      user.outlook_access_token = t.access_token || null;
      user.outlook_refresh_token = t.refresh_token || null;
      user.outlook_token_expires_at = t.token_expires_at || null;
    } else if (t.provider === "apple") {
      user.apple_caldav_username = t.caldav_username || null;
      user.apple_caldav_password = t.caldav_password || null;
    }
  }
}

/** Store or update OAuth tokens in Vault for a user+provider */
export async function saveOAuthTokens(
  userId: string,
  provider: "google" | "outlook" | "apple",
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    token_expires_at?: string | null;
    caldav_username?: string | null;
    caldav_password?: string | null;
  },
): Promise<void> {
  await getSupabase().rpc("upsert_oauth_tokens", {
    p_user_id: userId,
    p_provider: provider,
    p_access_token: tokens.access_token || null,
    p_refresh_token: tokens.refresh_token || null,
    p_token_expires_at: tokens.token_expires_at || null,
    p_caldav_username: tokens.caldav_username || null,
    p_caldav_password: tokens.caldav_password || null,
  });
}

/** Remove all OAuth tokens for a user+provider from Vault */
export async function deleteOAuthTokens(
  userId: string,
  provider: "google" | "outlook" | "apple",
): Promise<void> {
  await getSupabase().rpc("clear_oauth_tokens", {
    p_user_id: userId,
    p_provider: provider,
  });
}

/** Helper: get the Supabase user row for a Firebase UID */
export async function getDbUser(firebaseUid: string) {
  const { data } = await getSupabase()
    .from("users")
    .select("*")
    .eq("firebase_uid", firebaseUid)
    .maybeSingle();
  if (data) await overlayOAuthTokens(data);
  return data;
}

/** Helper: get the Supabase user row by internal UUID */
export async function getDbUserById(userId: string) {
  const { data } = await getSupabase()
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (data) await overlayOAuthTokens(data);
  return data;
}

/** Helper: get all accepted friend user IDs for a user */
export async function getAcceptedFriendIdSet(userId: string): Promise<Set<string>> {
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

export async function strictCalendarCheck(userId: string): Promise<boolean> {
  const sb = getSupabase();
  const { data: selectedRows } = await sb
    .from("user_calendars")
    .select("user_id")
    .eq("user_id", userId)
    .eq("is_selected", true)
    .limit(1);
  if (!selectedRows || selectedRows.length === 0) return false;

  const nowIso = new Date().toISOString();
  const windowEndIso = new Date(Date.now() + 14 * 86400000).toISOString();
  const recentSyncCutoffIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const { data: busyRows } = await sb
    .from("availability")
    .select("user_id")
    .eq("user_id", userId)
    .eq("status", "busy")
    .gte("end_time", nowIso)
    .lte("start_time", windowEndIso)
    .gte("created_at", recentSyncCutoffIso)
    .limit(1);
  return !!(busyRows && busyRows.length > 0);
}

/** Helper: true if user is a participant of the given meetup */
export async function isMeetupParticipant(meetupId: string, userId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("meetup_participants")
    .select("meetup_id")
    .eq("meetup_id", meetupId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}

export function formatDateTimeForTimeZone(iso: string, timeZone?: string | null): string {
  const dt = new Date(iso);
  const resolvedTimeZone = timeZone || "America/New_York";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedTimeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(dt);
}

export async function autoAddToCalendar(firebaseUid: string, meetup: {
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
    const quickLinks = [
      `Need to reschedule? https://slottedapp.com/quick/reschedule/${meetup.id}`,
      `Can't make it? https://slottedapp.com/quick/cancel/${meetup.id}`,
    ].join("\n");

    const eventDescription = [
      meetup.description || `Hangout with ${attendees.map((a: any) => a.displayName).join(", ")}`,
      "",
      "───────────",
      quickLinks,
      "",
      "Managed by Slotted.ai — https://slottedapp.com",
    ].join("\n");

    let addedEventId: string | null = null;
    let addedSource: "apple" | "google" | "outlook" | null = null;

    const { data: selectedCalendarRows } = await sb
      .from("user_calendars")
      .select("calendar_id, source")
      .eq("user_id", dbUser.id)
      .eq("is_selected", true);
    const selectedAppleCalendars = (selectedCalendarRows || []).filter((cal: any) => cal.source === "apple");
    const selectedGoogleCalendars = (selectedCalendarRows || []).filter((cal: any) => cal.source === "google");

    // ─── Prefer selected Apple calendars when the user chose them in Settings ───
    if (selectedAppleCalendars.length > 0 && dbUser.apple_calendar_connected && dbUser.apple_caldav_username && dbUser.apple_caldav_password) {
      try {
        const uid = `slotted-${meetup.id}-${dbUser.id}@slotted-ai.web.app`;
        const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const dtStart = new Date(meetup.start_time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const dtEnd = new Date(meetup.end_time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const icsContent = [
          "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Slotted//EN", "BEGIN:VEVENT",
          `UID:${uid}`, `DTSTAMP:${now}`, `DTSTART:${dtStart}`, `DTEND:${dtEnd}`, `SUMMARY:${eventTitle}`,
          `DESCRIPTION:${eventDescription}`, meetup.location ? `LOCATION:${meetup.location}` : "",
          ...attendees.map((a: any) => `ATTENDEE;CN=${a.displayName}:mailto:${a.email}`),
          `ATTENDEE;CN=Slotted.ai;RSVP=FALSE:mailto:${SLOTTED_CALENDAR_GUEST.email}`,
          "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", `DESCRIPTION:${eventTitle} in 1 hour`, "END:VALARM",
          "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${eventTitle} in 15 minutes`, "END:VALARM",
          "END:VEVENT", "END:VCALENDAR",
        ].filter(Boolean).join("\r\n");
        const client = await createDAVClient({
          serverUrl: "https://caldav.icloud.com",
          credentials: { username: dbUser.apple_caldav_username, password: dbUser.apple_caldav_password },
          authMethod: "Basic",
          defaultAccountType: "caldav",
        });
        const targetCalendar = selectedAppleCalendars[0].calendar_id;
        await client.createCalendarObject({
          calendar: { url: targetCalendar } as DAVCalendar,
          filename: `${uid}.ics`,
          iCalString: icsContent,
        });
        addedEventId = uid;
        addedSource = "apple";
        console.log(`🍎 Auto-added meetup ${meetup.id} to ${dbUser.email}'s selected Apple Calendar`);
      } catch (err) {
        console.error(`Selected Apple auto-add failed for ${dbUser.email}:`, err);
      }
    }

    // ─── Try Google Calendar next ───
    if (!addedEventId && dbUser.google_refresh_token) {
      try {
        const oauth2 = await getAuthedCalendarClient(firebaseUid);
        if (oauth2) {
          const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
          const targetCalendar = selectedGoogleCalendars[0]?.calendar_id || "primary";
          const gcalEvent = await calendarApi.events.insert({
            calendarId: targetCalendar,
            requestBody: {
              summary: eventTitle,
              description: eventDescription,
              colorId: "9",
              location: meetup.location || undefined,
              start: {
                dateTime: meetup.start_time,
                timeZone: dbUser.timezone || "America/New_York",
              },
              end: {
                dateTime: meetup.end_time,
                timeZone: dbUser.timezone || "America/New_York",
              },
              attendees: [
                ...attendees,
                { email: SLOTTED_CALENDAR_GUEST.email, displayName: SLOTTED_CALENDAR_GUEST.displayName, responseStatus: "accepted" },
              ],
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
          addedSource = "google";
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
          ...attendees.map((a: any) => `ATTENDEE;CN=${a.displayName}:mailto:${a.email}`),
          `ATTENDEE;CN=Slotted.ai;RSVP=FALSE:mailto:${SLOTTED_CALENDAR_GUEST.email}`,
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
        addedSource = "apple";
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
            attendees: [
              ...attendees.map((a: any) => ({ emailAddress: { address: a.email, name: a.displayName }, type: "required" })),
              { emailAddress: { address: SLOTTED_CALENDAR_GUEST.email, name: SLOTTED_CALENDAR_GUEST.displayName }, type: "required" },
            ],
            reminderMinutesBeforeStart: 15,
            isReminderOn: true,
          });
          addedEventId = outlookEvent.id;
          addedSource = "outlook";
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
        const { data: existingCalendarNotifications } = await sb
          .from("notifications")
          .select("id")
          .eq("user_id", dbUser.id)
          .eq("related_id", meetup.id)
          .eq("type", "meetup_confirmed")
          .ilike("body", "%Added to your calendar%")
          .limit(1);
        if (!existingCalendarNotifications || existingCalendarNotifications.length === 0) {
          await createNotification({
            userId: dbUser.id,
            type: "meetup_confirmed",
            title: `${eventTitle} is on your calendar`,
            body: `Added to your ${addedSource || "connected"} calendar.`,
            relatedId: meetup.id,
          });
        }
      } catch (err) { console.error("Column update failed:", err); }
    }
  } catch (err) {
    console.error(`Failed to auto-add meetup to calendar for ${firebaseUid}:`, err);
  }
}

export async function removeCalendarEvent(user: any, googleEventId: string): Promise<void> {
  if (!user || !googleEventId) return;

  let removed = false;

  // ─── Try Google Calendar ───
  if (user.google_refresh_token && user.firebase_uid) {
    try {
      const oauth2 = await getAuthedCalendarClient(user.firebase_uid);
      if (oauth2) {
        const calendarApi = google.calendar({ version: "v3", auth: oauth2 });
        await calendarApi.events.delete({ calendarId: "primary", eventId: googleEventId });
        removed = true;
        console.log(`🗑️ Removed Google Calendar event ${googleEventId} for ${user.email}`);
      }
    } catch (err: any) {
      if (err?.code === 404 || err?.code === 410) {
        removed = true; // already gone
      } else {
        console.warn(`Google calendar delete failed for ${user.email}:`, err?.message || err);
      }
    }
  }

  // ─── Try Outlook Calendar ───
  if (!removed && user.outlook_calendar_connected && user.outlook_refresh_token && user.firebase_uid) {
    try {
      const graphClient = await getOutlookGraphClient(user.firebase_uid);
      if (graphClient) {
        await graphClient.api(`/me/events/${googleEventId}`).delete();
        removed = true;
        console.log(`🗑️ Removed Outlook Calendar event ${googleEventId} for ${user.email}`);
      }
    } catch (err: any) {
      if (err?.statusCode === 404) {
        removed = true;
      } else {
        console.warn(`Outlook calendar delete failed for ${user.email}:`, err?.message || err);
      }
    }
  }

  // ─── Try Apple Calendar (CalDAV) ───
  if (!removed && user.apple_calendar_connected && user.apple_caldav_username && user.apple_caldav_password) {
    try {
      const client = await createDAVClient({
        serverUrl: "https://caldav.icloud.com",
        credentials: {
          username: user.apple_caldav_username,
          password: user.apple_caldav_password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });
      await client.deleteCalendarObject({
        calendarObject: {
          url: `https://caldav.icloud.com/${user.apple_caldav_username}/calendars/home/${googleEventId}.ics`,
        } as DAVObject,
      });
      console.log(`🗑️ Removed Apple Calendar event ${googleEventId} for ${user.email}`);
    } catch (err: any) {
      console.warn(`Apple calendar delete failed for ${user.email}:`, err?.message || err);
    }
  }
}

/**
 * Remove calendar events for all participants of a meetup and clear their google_event_id.
 * @param meetupId The meetup ID
 * @param excludeUserId Optional user ID to skip (e.g. the deleted user whose account is being removed)
 */
export async function removeCalendarEventsForMeetup(meetupId: string, excludeUserId?: string): Promise<void> {
  const sb = getSupabase();
  let query = sb
    .from("meetup_participants")
    .select("user_id, google_event_id")
    .eq("meetup_id", meetupId)
    .not("google_event_id", "is", null);

  if (excludeUserId) {
    query = query.neq("user_id", excludeUserId);
  }

  const { data: participants } = await query;
  if (!participants || participants.length === 0) return;

  for (const p of participants) {
    if (!p.google_event_id) continue;
    const user = await getDbUserById(p.user_id);
    if (user) {
      await removeCalendarEvent(user, p.google_event_id);
    }
    // Clear the google_event_id regardless of success
    await sb
      .from("meetup_participants")
      .update({ google_event_id: null })
      .eq("meetup_id", meetupId)
      .eq("user_id", p.user_id);
  }
}

/**
 * Remove calendar event for a single participant and clear google_event_id.
 */
export async function removeCalendarEventForParticipant(meetupId: string, userId: string): Promise<void> {
  const sb = getSupabase();
  const { data: participant } = await sb
    .from("meetup_participants")
    .select("google_event_id")
    .eq("meetup_id", meetupId)
    .eq("user_id", userId)
    .single();

  if (!participant?.google_event_id) return;

  const user = await getDbUserById(userId);
  if (user) {
    await removeCalendarEvent(user, participant.google_event_id);
  }

  await sb
    .from("meetup_participants")
    .update({ google_event_id: null })
    .eq("meetup_id", meetupId)
    .eq("user_id", userId);
}

export async function createNotification(opts: {
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

/** Generate an invite code from a display name (e.g. "Shari Paltrowitz" → "shari123") */
export async function generateInviteCode(displayName: string): Promise<string> {
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
    const { data } = await sb.from("users").select("id").eq("invite_code", code).maybeSingle();
    if (!data) return code; // unique — use it
  }
  // Fallback: base + full UUID fragment (guaranteed unique)
  const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base}${uuid}`;
}

/** Fields that must NEVER be sent to the client */
export const SENSITIVE_FIELDS = [
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

export function stripSensitive(user: Record<string, any>) {
  const safe = { ...user };
  for (const field of SENSITIVE_FIELDS) {
    delete safe[field];
  }
  return safe;
}

/** Extract city from neighborhood string (e.g., "West Village, NYC" → "nyc") */
export function extractCity(neighborhood: string): string {
  return neighborhood.toLowerCase().split(',').pop()?.trim() || '';
}

/** Re-evaluate friendship types for all of a user's friendships based on current neighborhoods */
export async function reclassifyFriendships(userId: string, myNeighborhood: string) {
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

/** Helper: check if either user has blocked the other */
export async function isBlocked(userA: string, userB: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from("blocked_users")
    .select("id")
    .or(`and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`)
    .limit(1);
  return !!(data && data.length > 0);
}

export const SYNC_WINDOW_DAYS = 14;

/**
 * Sync a single user's Google Calendar + Apple Calendar events → `availability` table.
 * Reads events from all selected calendars (both sources), writes busy blocks, then
 * computes the inverse as free blocks within 8am–10pm each day.
 */
export async function syncUserCalendar(firebaseUid: string): Promise<{ synced: boolean; slots: number }> {
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

  // Upsert availability — insert/update new records, then remove stale ones (avoids zero-availability window)
  if (freeBlocks.length > 0) {
    const rows = freeBlocks.map((f) => ({
      user_id: dbUser.id,
      start_time: f.start,
      end_time: f.end,
      status: "free",
    }));

    // Upsert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await sb.from("availability").upsert(batch, { onConflict: "user_id,start_time,end_time" });
    }

    // Delete stale records that are no longer in the calendar
    const validTimeKeys = new Set(freeBlocks.map((f) => `${f.start}|${f.end}`));
    const { data: existingSlots } = await sb
      .from("availability")
      .select("id, start_time, end_time")
      .eq("user_id", dbUser.id);

    if (existingSlots && existingSlots.length > 0) {
      const staleIds = existingSlots
        .filter((s: any) => !validTimeKeys.has(`${s.start_time}|${s.end_time}`))
        .map((s: any) => s.id);
      if (staleIds.length > 0) {
        await sb.from("availability").delete().in("id", staleIds);
      }
    }
  } else {
    // No free blocks at all — clear everything
    await sb.from("availability").delete().eq("user_id", dbUser.id);
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
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
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
  } catch (err) { console.error(err);
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
export function generateCallWindowSlots(
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
export function mergeCallWindowSlots(
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
export function ceilToHalfHour(iso: string): string {
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
export function floorToHalfHour(iso: string): string {
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
export function roundOverlaps(
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

export function applyTravelBuffer(
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
export async function getWeeklyMeetupStatus(userId: string) {
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
export function getPlanningHorizon(planningStyle: string | null | undefined) {
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
export function timeSlotToHourRange(slot: string): { start: number; end: number } | null {
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
export function clampOverlapsToPreferences(
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
export const DEFAULT_HANGOUT_WINDOWS: Record<number, { startHour: number; endHour: number }[]> = {
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
export function filterOverlapsToHangoutWindows(
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

export interface ScoredSlot {
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
export function durationToMinutes(pref: string | null | undefined): { min: number; ideal: number; max: number } {
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
export function callDurationToMinutes(pref: string | null | undefined): { min: number; ideal: number; max: number } {
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
export function resolveGroupDuration(
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
export async function scoreOverlaps(
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
export async function scoreGroupOverlaps(
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
      sb.from("user_preferences").select("*").eq("user_id", id).maybeSingle().then((r) => r.data),
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

export const shareLookupHits = new Map<string, number[]>();
export function isShareLookupRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxHits = 30;
  const hits = shareLookupHits.get(clientKey) || [];
  const recentHits = hits.filter((t) => now - t < windowMs);
  recentHits.push(now);
  shareLookupHits.set(clientKey, recentHits);
  return recentHits.length > maxHits;
}

export function generateShareCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Google Calendar OAuth helpers
// ---------------------------------------------------------------------------
export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "https://slottedapp.com/api/calendar/callback",
  );
}

/** Build an authenticated OAuth2 client for a user who has stored tokens */
export async function getAuthedCalendarClient(firebaseUid: string) {
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

  // Auto-refresh: listen for new tokens and persist them in Vault
  oauth2.on("tokens", async (tokens) => {
    if (user?.id && (tokens.access_token || tokens.refresh_token || tokens.expiry_date)) {
      await saveOAuthTokens(user.id, "google", {
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || undefined,
        token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : undefined,
      });
    }
  });

  return oauth2;
}

// ---------------------------------------------------------------------------
// Outlook Calendar (Microsoft Graph) helpers
// ---------------------------------------------------------------------------

export const MICROSOFT_SCOPES = [
  "Calendars.Read",
  "Calendars.ReadWrite",
  "offline_access",
  "User.Read",
];

export function getMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || "common"}`,
    },
  });
}

export async function getOutlookGraphClient(firebaseUid: string): Promise<GraphClient | null> {
  const user = await getDbUser(firebaseUid);
  if (!user?.outlook_refresh_token) return null;

  const msalClient = getMsalClient();

  try {
    const result = await msalClient.acquireTokenByRefreshToken({
      refreshToken: user.outlook_refresh_token,
      scopes: MICROSOFT_SCOPES.filter(s => s !== "offline_access"),
    });

    if (!result) return null;

    if (user?.id) {
      await saveOAuthTokens(user.id, "outlook", {
        access_token: result.accessToken,
        token_expires_at: result.expiresOn?.toISOString() || undefined,
      });
    }

    return GraphClient.init({
      authProvider: (done) => done(null, result.accessToken),
    });
  } catch (err) {
    console.error("Failed to get Outlook Graph client:", err);
    return null;
  }
}

/** Recompute learned preferences from meetup_logs */
export async function recomputePreferences(userId: string) {
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
// Apple Calendar helpers
// ---------------------------------------------------------------------------
export async function createAppleCalDAVClient(username: string, password: string) {
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
export async function fetchAppleCalendars(username: string, password: string): Promise<DAVCalendar[]> {
  const client = await createAppleCalDAVClient(username, password);
  const calendars = await client.fetchCalendars();
  return calendars;
}

/** Parse iCalendar VEVENT data to extract events with details (title, location, allDay) */
export function parseICalEventsWithDetails(
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
export function parseICalEvents(icalData: string, timeMin: Date, timeMax: Date): { start: Date; end: Date }[] {
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
export function parseICalDateTime(dtStr: string): Date {
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
export async function fetchAppleBusyBlocks(
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

export async function scheduleEmailFallback(
  _userId: string,
  _notificationId: string,
  _title: string,
  _body: string,
): Promise<void> {
  // No-op placeholder — the sendEmailFallbacks scheduled function
  // handles checking for unread notifications older than 24 hours.
  // Plug in SendGrid/SES here when ready.
}
