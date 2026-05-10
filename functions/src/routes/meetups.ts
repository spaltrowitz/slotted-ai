import express, { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware, getClientIp } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
  isMeetupParticipant,
  createNotification,
  autoAddToCalendar,
  removeCalendarEventsForMeetup,
  removeCalendarEventForParticipant,
  getAuthedCalendarClient,
  getOutlookGraphClient,
  getWeeklyMeetupStatus,
  getAcceptedFriendIdSet,
  isBlocked,
  fetchAppleCalendars,
} from "../utils/helpers";
import { getSupabase } from "../supabase";
import { google } from "googleapis";
import { createDAVClient, DAVCalendar } from "tsdav";

const router = express.Router();

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

/** POST /meetups — create a new meetup proposal */
router.post("/meetups", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { title, friendId, friendIds, friend_ids, startTime, start_time, endTime, end_time, location, description, activity } = req.body;

    // Support both camelCase and snake_case, and single friendId vs multiple friendIds
    const resolvedFriendIds = friendIds || friend_ids;
    const rawParticipantIds: string[] = Array.isArray(resolvedFriendIds)
      ? resolvedFriendIds.filter((pid: unknown): pid is string => typeof pid === "string" && !!pid)
      : (typeof friendId === "string" && !!friendId)
        ? [friendId]
        : [];
    const participantIds = [...new Set(rawParticipantIds.filter((pid) => pid !== me.id))];
    const resolvedStartTime = startTime || start_time;
    const resolvedEndTime = endTime || end_time;

    if (participantIds.length === 0) {
      res.status(400).json({ error: "At least one friendId is required" });
      return;
    }

    // Validate time constraints
    if (resolvedStartTime) {
      const startDate = new Date(resolvedStartTime);
      const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
      if (startDate < fiveMinFromNow) {
        res.status(400).json({ error: "The proposed time has already passed — pick a future time." });
        return;
      }
    }
    if (resolvedStartTime && resolvedEndTime) {
      if (new Date(resolvedEndTime) <= new Date(resolvedStartTime)) {
        res.status(400).json({ error: "End time must be after start time." });
        return;
      }
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedParticipantIds = participantIds.filter((pid) => !acceptedFriendIds.has(pid));
    if (unauthorizedParticipantIds.length > 0) {
      // Check if unauthorized participants are deleted users vs just not friends
      const { data: existingUsers } = await getSupabase()
        .from("users")
        .select("id")
        .in("id", unauthorizedParticipantIds);
      const existingIds = new Set((existingUsers || []).map((u: any) => u.id));
      const deletedIds = unauthorizedParticipantIds.filter((pid) => !existingIds.has(pid));
      if (deletedIds.length > 0) {
        res.status(410).json({ error: "One or more friends are no longer on Slotted" });
        return;
      }
      res.status(403).json({ error: "All participants must be accepted friends" });
      return;
    }

    // Check for blocks between creator and any participant
    for (const pid of participantIds) {
      if (await isBlocked(me.id, pid)) {
        res.status(403).json({ error: "Unable to schedule with one or more participants" });
        return;
      }
    }

    // Duplicate meetup detection: check for existing proposed/confirmed meetups with overlapping time + same participants
    if (resolvedStartTime && resolvedEndTime) {
      const { data: existingMeetups } = await getSupabase()
        .from("meetups")
        .select("id, start_time, end_time, created_by")
        .in("status", ["proposed", "confirmed"])
        .lt("start_time", resolvedEndTime)
        .gt("end_time", resolvedStartTime);

      if (existingMeetups && existingMeetups.length > 0) {
        for (const existing of existingMeetups) {
          const { data: existingParts } = await getSupabase()
            .from("meetup_participants")
            .select("user_id")
            .eq("meetup_id", existing.id);
          const existingPartIds = new Set((existingParts || []).map((p: any) => p.user_id));
          // Check if current participant set is a subset of (or equals) existing meetup's participants
          const allCurrentIds = [me.id, ...participantIds];
          const isSubset = allCurrentIds.every((id) => existingPartIds.has(id));
          if (isSubset) {
            res.status(409).json({ error: "A similar meetup already exists for this time", existingMeetupId: existing.id });
            return;
          }
        }
      }
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
        start_time: resolvedStartTime,
        end_time: resolvedEndTime,
        created_by: me.id,
      })
      .select()
      .maybeSingle();

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
    const startDt = new Date(resolvedStartTime);
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
router.get("/meetups", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.patch("/meetups/:meetupId/rsvp", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

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
          const { data: pUser } = await getSupabase().from("users").select("firebase_uid").eq("id", p.user_id).maybeSingle();
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
        // Remove calendar events for ALL participants (meetup is dead)
        removeCalendarEventsForMeetup(meetupId).catch(() => {});
      } else {
        // For 3+ person meetups: check if all non-creator participants have declined
        const nonCreatorParticipants = allParticipants.filter((p: any) => p.user_id !== meetup.created_by);
        const { data: currentRsvps } = await getSupabase()
          .from("meetup_participants")
          .select("user_id, rsvp")
          .eq("meetup_id", meetupId)
          .neq("user_id", meetup.created_by);

        const allDeclined = (currentRsvps || []).every((p: any) => p.rsvp === "declined");
        if (allDeclined && nonCreatorParticipants.length > 0) {
          await getSupabase()
            .from("meetups")
            .update({ status: "cancelled" })
            .eq("id", meetupId);
          // Remove calendar events for ALL participants (meetup is dead)
          removeCalendarEventsForMeetup(meetupId).catch(() => {});
        } else {
          // Meetup continues — only remove the declining user's calendar event
          removeCalendarEventForParticipant(meetupId, me.id).catch(() => {});
        }
      }

      // Mark all existing notifications for this meetup as read
      await getSupabase()
        .from("notifications")
        .update({ read: true })
        .eq("related_id", meetupId)
        .in("type", ["meetup_request", "meetup_confirmed", "meetup_reminder", "meetup_counter_proposed"]);

      // Notify other participants
      for (const p of allParticipants) {
        if (p.user_id !== me.id) {
          await createNotification({
            userId: p.user_id,
            type: "meetup_declined",
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
router.post("/meetups/:meetupId/counter-propose", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { meetupId } = req.params;
  const { startTime, endTime } = req.body;

  if (!startTime || !endTime) {
    res.status(400).json({ error: "startTime and endTime are required" });
    return;
  }

  // Validate time constraints
  const cpStartDate = new Date(startTime);
  const cpFiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (cpStartDate < cpFiveMinFromNow) {
    res.status(400).json({ error: "The proposed time has already passed — pick a future time." });
    return;
  }
  if (new Date(endTime) <= new Date(startTime)) {
    res.status(400).json({ error: "End time must be after start time." });
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
      .maybeSingle();

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

    // Mark the original meetup as superseded so it doesn't show as active
    await getSupabase()
      .from("meetups")
      .update({ status: "counter_proposed" })
      .eq("id", meetupId);

    // Get the original creator's ID (the person to receive the counter-proposal)
    const originalCreatorId = originalMeetup.created_by;

    // Get all other participants from the original meetup (excluding counter-proposer)
    const { data: origParticipants } = await getSupabase()
      .from("meetup_participants")
      .select("user_id")
      .eq("meetup_id", meetupId)
      .neq("user_id", me.id);

    // Filter to only include participants who are accepted friends of counter-proposer
    const counterProposerFriends = await getAcceptedFriendIdSet(me.id);
    const otherParticipantIds = (origParticipants || [])
      .map((p: any) => p.user_id)
      .filter((pid: string) => counterProposerFriends.has(pid));

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
      .maybeSingle();

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
        type: "meetup_counter_proposed",
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
router.patch("/meetups/:meetupId/didnt-happen", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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

    // Remove calendar events for all participants
    removeCalendarEventsForMeetup(meetupId).catch(() => {});

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
router.get("/meetups/:meetupId/writable-calendars", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.post("/meetups/:meetupId/add-to-calendar", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

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
    const { data: existingCalendarPart } = await getSupabase()
      .from("meetup_participants")
      .select("google_event_id")
      .eq("meetup_id", meetupId)
      .eq("user_id", me.id)
      .maybeSingle();
    const existingEventId = existingCalendarPart?.google_event_id || null;

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
      const requestBody = {
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
      };

      let eventId = existingEventId;
      let eventLink: string | null | undefined = null;
      if (existingEventId) {
        try {
          const updatedEvent = await calendarApi.events.patch({
            calendarId: targetCalendar,
            eventId: existingEventId,
            sendUpdates: "all",
            requestBody,
          });
          eventLink = updatedEvent.data.htmlLink;
        } catch (updateErr: any) {
          const status = updateErr?.code || updateErr?.response?.status;
          if (status !== 404 && status !== 410) throw updateErr;
          eventId = null;
        }
      }

      if (!eventId) {
        const gcalEvent = await calendarApi.events.insert({
          calendarId: targetCalendar,
          sendUpdates: "all",
          requestBody,
        });
        eventId = gcalEvent.data.id || null;
        eventLink = gcalEvent.data.htmlLink;
      }

      // Store the Google event ID on the meetup_participant row for reference
      // (google_event_id column may need migration — see migrations/add_google_event_id.sql)
      try {
        await getSupabase()
          .from("meetup_participants")
          .update({ google_event_id: eventId })
          .eq("meetup_id", meetupId)
          .eq("user_id", me.id);
      } catch (err) {
        console.error(err);
        // Column may not exist yet — safe to ignore
      }

      res.json({
        success: true,
        source: "google",
        calendarId: targetCalendar,
        eventId,
        eventLink,
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

        try {
          await getSupabase()
            .from("meetup_participants")
            .update({ google_event_id: uid })
            .eq("meetup_id", meetupId)
            .eq("user_id", me.id);
        } catch (err) {
          console.error(err);
        }

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
router.post("/meetups/:meetupId/share", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { meetupId } = req.params;

    const { data: meetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .select("id, share_code, created_by")
      .eq("id", meetupId)
      .maybeSingle();

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
        .maybeSingle();
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
router.get("/meetups/shared/:code", async (req: Request, res: Response) => {
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
      .maybeSingle();

    if (error || !meetup) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const { data: creator } = await getSupabase()
      .from("users")
      .select("display_name, photo_url, invite_code")
      .eq("id", meetup.created_by)
      .maybeSingle();

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
router.get("/meetups/shared/:code/ics", async (req: Request, res: Response) => {
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
      .maybeSingle();

    if (error || !meetup) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const { data: creator } = await getSupabase()
      .from("users")
      .select("invite_code")
      .eq("id", meetup.created_by)
      .maybeSingle();

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


export default router;
