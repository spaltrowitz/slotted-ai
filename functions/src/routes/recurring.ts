import express, { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
  getAcceptedFriendIdSet,
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

/** POST /recurring — create a recurring meetup */
router.post("/recurring", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { title, activityType, frequency, preferredDay, preferredTime, durationMin, friendIds } = req.body;

  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!friendIds || !Array.isArray(friendIds) || friendIds.length === 0) {
    res.status(400).json({ error: "friendIds must be a non-empty array" });
    return;
  }

  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Validate all friends are accepted
    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const invalidIds = friendIds.filter((fid: string) => !acceptedFriendIds.has(fid));
    if (invalidIds.length > 0) {
      res.status(403).json({ error: "All participants must be accepted friends" });
      return;
    }

    const validFrequency = ["weekly", "biweekly", "monthly"].includes(frequency) ? frequency : "biweekly";
    const intervalDays = validFrequency === "weekly" ? 7 : validFrequency === "biweekly" ? 14 : 30;

    const sb = getSupabase();
    const { data: recurring, error } = await sb
      .from("recurring_meetups")
      .insert({
        created_by: me.id,
        title,
        activity_type: activityType || null,
        frequency: validFrequency,
        preferred_day: preferredDay ?? null,
        preferred_time: preferredTime || null,
        duration_min: durationMin || 60,
        participant_ids: friendIds,
        next_check_at: new Date(Date.now() + intervalDays * 86400000).toISOString(),
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Notify participants
    for (const friendId of friendIds) {
      const friend = await getDbUserById(friendId);
      if (friend) {
        await createNotification({
          userId: friendId,
          type: "recurring_meetup",
          title: "🔄 New recurring hangout",
          body: `${me.display_name || "A friend"} set up "${title}" — ${validFrequency}`,
          relatedUserId: me.id,
          relatedId: recurring.id,
        });
      }
    }

    res.json({ recurring });
  } catch (err: any) {
    console.error("Create recurring error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /recurring — list user's recurring meetups */
router.get("/recurring", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sb = getSupabase();

    // Find recurring meetups where user is creator or participant
    const { data: asCreator } = await sb
      .from("recurring_meetups")
      .select("*")
      .eq("created_by", me.id)
      .order("created_at", { ascending: false });

    const { data: asParticipant } = await sb
      .from("recurring_meetups")
      .select("*")
      .contains("participant_ids", [me.id])
      .order("created_at", { ascending: false });

    // Merge and deduplicate
    const allMap = new Map<string, any>();
    for (const r of (asCreator || [])) allMap.set(r.id, r);
    for (const r of (asParticipant || [])) allMap.set(r.id, r);
    const all = Array.from(allMap.values());

    // Enrich with participant display names
    const enriched = await Promise.all(
      all.map(async (r) => {
        const participantNames = await Promise.all(
          (r.participant_ids || []).map(async (pid: string) => {
            const u = await getDbUserById(pid);
            return { id: pid, displayName: u?.display_name || "Friend" };
          }),
        );
        return { ...r, participants: participantNames };
      }),
    );

    res.json({ recurring: enriched });
  } catch (err: any) {
    console.error("List recurring error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /recurring/:id — update or deactivate */
router.patch("/recurring/:id", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { isActive, frequency, preferredDay, preferredTime, durationMin, title } = req.body;

  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sb = getSupabase();

    // Verify ownership
    const { data: existing } = await sb
      .from("recurring_meetups")
      .select("created_by")
      .eq("id", id)
      .single();

    if (!existing || existing.created_by !== me.id) {
      res.status(403).json({ error: "Only the creator can update this recurring meetup" });
      return;
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (typeof isActive === "boolean") updates.is_active = isActive;
    if (frequency && ["weekly", "biweekly", "monthly"].includes(frequency)) updates.frequency = frequency;
    if (preferredDay !== undefined) updates.preferred_day = preferredDay;
    if (preferredTime !== undefined) updates.preferred_time = preferredTime;
    if (durationMin !== undefined) updates.duration_min = durationMin;
    if (title !== undefined) updates.title = title;

    const { data: updated, error } = await sb
      .from("recurring_meetups")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ recurring: updated });
  } catch (err: any) {
    console.error("Update recurring error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /recurring/:id — delete a recurring meetup */
router.delete("/recurring/:id", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sb = getSupabase();

    const { data: existing } = await sb
      .from("recurring_meetups")
      .select("created_by")
      .eq("id", id)
      .single();

    if (!existing || existing.created_by !== me.id) {
      res.status(403).json({ error: "Only the creator can delete this recurring meetup" });
      return;
    }

    const { error } = await sb
      .from("recurring_meetups")
      .delete()
      .eq("id", id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Delete recurring error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
