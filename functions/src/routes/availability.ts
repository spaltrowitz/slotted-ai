import express, { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
  getAcceptedFriendIdSet,
  syncUserCalendar,
  generateCallWindowSlots,
  mergeCallWindowSlots,
  applyTravelBuffer,
  clampOverlapsToPreferences,
  filterOverlapsToHangoutWindows,
  roundOverlaps,
  resolveGroupDuration,
  scoreOverlaps,
  scoreGroupOverlaps,
  strictCalendarCheck,
  createNotification,
} from "../utils/helpers";
import { getSupabase } from "../supabase";

const router = express.Router();

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

/** POST /calendar/sync — trigger a calendar sync for the current user */
router.post("/calendar/sync", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/availability", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/availability/overlap/:friendId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { friendId } = req.params;
  const mode = (req.query.mode as string) || "in_person"; // "in_person" | "call" | "phone" | "video"
  const isCallMode = mode === "call" || mode === "phone" || mode === "video";
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
      } catch (err) { console.error("Suggestion insert failed:", err); }
    }

    const friendCalendarConnected = await strictCalendarCheck(friendId);

    // Calendar nudge: if 0 suggestions and friend hasn't connected calendar, send one-time nudge (max 1/week per pair)
    if (suggestions.length === 0 && !friendCalendarConnected) {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentNudge } = await getSupabase()
        .from("notifications")
        .select("id")
        .eq("user_id", friendId)
        .eq("type", "calendar_match")
        .eq("related_user_id", me.id)
        .ilike("title", "📅 Connect your calendar%")
        .gte("created_at", oneWeekAgo)
        .limit(1);

      if (!recentNudge || recentNudge.length === 0) {
        await createNotification({
          userId: friendId,
          type: "calendar_match",
          title: "📅 Connect your calendar",
          body: `${me.display_name || "A friend"} wants to find a time to hang — connect your calendar so Slotted can help!`,
          relatedUserId: me.id,
        });
      }
    }

    // Include friend-specific pattern from AI suggestions
    let friendPattern = null;
    try {
      const { analyzeFriendPatterns } = await import("../utils/aiSuggestions");
      const patterns = await analyzeFriendPatterns(me.id);
      friendPattern = patterns.find(p => p.friendId === friendId) || null;
    } catch { /* non-critical */ }

    // Privacy: friend's calendar sync status / free-slot count is NEVER returned
    // to other users. Auto-nudge (above) handles the connect-prompt server-side.
    // Marketing claim: "Friends never see your battery, your free blocks, or your sync status."
    res.json({
      overlaps,
      suggestions,
      friendPattern,
      syncStatus: {
        me: { synced: mySync.synced, freeSlots: mySync.slots },
      },
    });
  } catch (err: any) {
    console.error("Overlap error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Shared handler for multi-friend overlap */
async function handleMultiFriendOverlap(req: AuthRequest, res: Response) {
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

    // Build sync status. Privacy: per-friend sync state and free-slot counts
    // are NEVER returned. We only surface whether ALL calendars are ready so the
    // UI can show a generic "still finding times" message if not.
    const calConnectedResults = await Promise.all(
      friendUsers.map((fu) => fu?.id ? strictCalendarCheck(fu.id) : Promise.resolve(false)),
    );

    const mySyncResult = syncResults[0];
    const mySync = mySyncResult?.status === "fulfilled"
      ? mySyncResult.value as { synced: boolean; slots: number }
      : { synced: false, slots: 0 };

    const friendsAllSynced = calConnectedResults.every(Boolean) &&
      syncResults.slice(1).every((r) => r.status === "fulfilled" && (r.value as { synced: boolean }).synced);
    // Aggregate must reflect requester's own sync too; otherwise the UI can
    // show "everyone's pretty busy!" when really the user themselves needs
    // to reconnect.
    const everyoneSynced = mySync.synced && friendsAllSynced;

    // Group auto-nudge: if 0 suggestions and at least one friend hasn't
    // connected, send a one-time connect-prompt to each unsynced friend
    // (max 1/week per pair, per-friend dedupe). Same privacy posture as the
    // 1:1 endpoint — the requester never sees who got nudged.
    if (suggestions.length === 0) {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      for (let i = 0; i < friendUsers.length; i++) {
        const fu = friendUsers[i];
        if (!fu?.id) continue;
        if (calConnectedResults[i]) continue; // already connected, skip

        const { data: recentNudge } = await getSupabase()
          .from("notifications")
          .select("id")
          .eq("user_id", fu.id)
          .eq("type", "calendar_match")
          .eq("related_user_id", me.id)
          .ilike("title", "📅 Connect your calendar%")
          .gte("created_at", oneWeekAgo)
          .limit(1);

        if (!recentNudge || recentNudge.length === 0) {
          await createNotification({
            userId: fu.id,
            type: "calendar_match",
            title: "📅 Connect your calendar",
            body: `${me.display_name || "A friend"} is trying to find a time to hang with a group — connect your calendar so Slotted can help!`,
            relatedUserId: me.id,
          });
        }
      }
    }

    res.json({
      overlaps: currentOverlaps,
      suggestions,
      syncStatus: {
        me: { synced: mySync.synced, freeSlots: mySync.slots },
        everyoneSynced,
      },
    });
  } catch (err: any) {
    console.error("Multi-friend overlap error:", err);
    res.status(500).json({ error: err.message });
  }
}

/** POST /availability/group-overlap — alias for multi-friend-overlap (frontend compat) */
router.post("/availability/group-overlap", authWithRateLimit, (req: AuthRequest, res: Response) => handleMultiFriendOverlap(req, res));

/** POST /availability/multi-friend-overlap — find mutual free slots among multiple friends */
router.post("/availability/multi-friend-overlap", authWithRateLimit, (req: AuthRequest, res: Response) => handleMultiFriendOverlap(req, res));

export default router;
