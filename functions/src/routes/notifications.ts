import express, { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import { getDbUser } from "../utils/helpers";
import { getSupabase } from "../supabase";

const router = express.Router();

// Apply rate limiting after auth
function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

/** GET /notifications — list current user's notifications */
router.get("/notifications", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      if (["didnt_happen", "cancelled", "counter_proposed"].includes((n as any).meetup_status)) return false;
      // Hide meetup notifications if I've declined the meetup
      if ((n as any).my_rsvp === "declined" && ["meetup_confirmed", "meetup_request", "meetup_reminder", "meetup_counter_proposed", "meetup_declined"].includes(n.type)) return false;
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
router.get("/notifications/unread-count", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.patch("/notifications/:id/read", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.post("/notifications/mark-all-read", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.delete("/notifications/:id", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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


// Removed: POST /notifications/nudge-calendar
// Why: it accepted an arbitrary friendId without validating that an accepted
// friendship exists, and had no rate-limit/dedupe — so it was spam-callable
// and could be used to enumerate user existence. The 1:1 and group overlap
// endpoints already auto-send the connect-calendar nudge (max 1/week per
// pair) when overlap returns 0 suggestions. That path is privacy-safe and
// covers every legitimate case.


export default router;
