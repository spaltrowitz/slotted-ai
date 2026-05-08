import express, { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
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

/** POST /couples/link — send link request to partner */
router.post("/couples/link", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { partnerId, displayName } = req.body;
  if (!partnerId || typeof partnerId !== "string") {
    res.status(400).json({ error: "partnerId is required" });
    return;
  }

  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (partnerId === me.id) {
      res.status(400).json({ error: "Cannot link with yourself" });
      return;
    }

    const partner = await getDbUserById(partnerId);
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }

    // Ensure consistent ordering for the unique constraint
    const [userAId, userBId] = me.id < partnerId ? [me.id, partnerId] : [partnerId, me.id];

    const sb = getSupabase();

    // Check for existing link
    const { data: existing } = await sb
      .from("couple_links")
      .select("id, status")
      .eq("user_a_id", userAId)
      .eq("user_b_id", userBId)
      .limit(1)
      .single();

    if (existing) {
      if (existing.status === "accepted") {
        res.status(409).json({ error: "Already linked as a couple" });
        return;
      }
      if (existing.status === "pending") {
        res.status(409).json({ error: "Link request already pending" });
        return;
      }
      // If unlinked, allow re-linking by updating
      const { data: relinked, error } = await sb
        .from("couple_links")
        .update({
          status: "pending",
          invited_by: me.id,
          display_name: displayName || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      await createNotification({
        userId: partnerId,
        type: "couple_link",
        title: "💕 Couple link request",
        body: `${me.display_name || "Someone"} wants to link as a couple on Slotted`,
        relatedUserId: me.id,
        relatedId: relinked.id,
      });

      res.json({ coupleLink: relinked });
      return;
    }

    const { data: coupleLink, error } = await sb
      .from("couple_links")
      .insert({
        user_a_id: userAId,
        user_b_id: userBId,
        status: "pending",
        invited_by: me.id,
        display_name: displayName || null,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await createNotification({
      userId: partnerId,
      type: "couple_link",
      title: "💕 Couple link request",
      body: `${me.display_name || "Someone"} wants to link as a couple on Slotted`,
      relatedUserId: me.id,
      relatedId: coupleLink.id,
    });

    res.json({ coupleLink });
  } catch (err: any) {
    console.error("Couple link error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /couples/:coupleId — accept, decline, or unlink */
router.patch("/couples/:coupleId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { coupleId } = req.params;
  const { action } = req.body;

  if (!action || !["accept", "decline", "unlink"].includes(action)) {
    res.status(400).json({ error: "action must be 'accept', 'decline', or 'unlink'" });
    return;
  }

  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sb = getSupabase();

    const { data: couple, error: fetchError } = await sb
      .from("couple_links")
      .select("*")
      .eq("id", coupleId)
      .single();

    if (fetchError || !couple) {
      res.status(404).json({ error: "Couple link not found" });
      return;
    }

    // Verify the user is part of this couple
    if (couple.user_a_id !== me.id && couple.user_b_id !== me.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    if (action === "accept") {
      if (couple.status !== "pending") {
        res.status(400).json({ error: "Can only accept pending requests" });
        return;
      }
      // Only the non-inviter can accept
      if (couple.invited_by === me.id) {
        res.status(400).json({ error: "Cannot accept your own request" });
        return;
      }

      const { error: updateError } = await sb
        .from("couple_links")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", coupleId);

      if (updateError) {
        res.status(500).json({ error: updateError.message });
        return;
      }

      // Compute combined availability
      await computeCoupleAvailability(coupleId, couple.user_a_id, couple.user_b_id);

      // Notify the inviter
      await createNotification({
        userId: couple.invited_by,
        type: "couple_link",
        title: "💕 Couple link accepted!",
        body: `${me.display_name || "Your partner"} accepted the couple link`,
        relatedUserId: me.id,
        relatedId: coupleId,
      });

      res.json({ success: true, status: "accepted" });
      return;
    }

    if (action === "decline") {
      if (couple.status !== "pending") {
        res.status(400).json({ error: "Can only decline pending requests" });
        return;
      }

      // Delete the link rather than keeping declined records
      await sb.from("couple_links").delete().eq("id", coupleId);

      res.json({ success: true, status: "declined" });
      return;
    }

    if (action === "unlink") {
      if (couple.status !== "accepted") {
        res.status(400).json({ error: "Can only unlink accepted couples" });
        return;
      }

      // Clear cached availability
      await sb.from("couple_availability").delete().eq("couple_id", coupleId);

      const { error: updateError } = await sb
        .from("couple_links")
        .update({ status: "unlinked", updated_at: new Date().toISOString() })
        .eq("id", coupleId);

      if (updateError) {
        res.status(500).json({ error: updateError.message });
        return;
      }

      const partnerId = couple.user_a_id === me.id ? couple.user_b_id : couple.user_a_id;
      await createNotification({
        userId: partnerId,
        type: "couple_link",
        title: "Couple link updated",
        body: `${me.display_name || "Your partner"} has unlinked the couple mode`,
        relatedUserId: me.id,
        relatedId: coupleId,
      });

      res.json({ success: true, status: "unlinked" });
      return;
    }
  } catch (err: any) {
    console.error("Couple action error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /couples/me — get current couple link (if any) */
router.get("/couples/me", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sb = getSupabase();

    const { data: links } = await sb
      .from("couple_links")
      .select("*")
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (!links || links.length === 0) {
      res.json({ coupleLink: null });
      return;
    }

    const link = links[0];
    const partnerId = link.user_a_id === me.id ? link.user_b_id : link.user_a_id;
    const partner = await getDbUserById(partnerId);

    // Get availability stats if accepted
    let availabilityCount = 0;
    if (link.status === "accepted") {
      const { count } = await sb
        .from("couple_availability")
        .select("id", { count: "exact", head: true })
        .eq("couple_id", link.id)
        .gte("end_time", new Date().toISOString());
      availabilityCount = count || 0;
    }

    res.json({
      coupleLink: {
        ...link,
        partner: {
          id: partner?.id,
          displayName: partner?.display_name,
          photoUrl: partner?.photo_url,
        },
        availabilitySlots: availabilityCount,
        isInviter: link.invited_by === me.id,
      },
    });
  } catch (err: any) {
    console.error("Couple me error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /couples/:coupleId/sync — recompute combined availability */
router.post("/couples/:coupleId/sync", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { coupleId } = req.params;
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const sb = getSupabase();

    const { data: couple } = await sb
      .from("couple_links")
      .select("*")
      .eq("id", coupleId)
      .eq("status", "accepted")
      .single();

    if (!couple) {
      res.status(404).json({ error: "Active couple link not found" });
      return;
    }

    if (couple.user_a_id !== me.id && couple.user_b_id !== me.id) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    const slots = await computeCoupleAvailability(coupleId, couple.user_a_id, couple.user_b_id);

    res.json({ success: true, slots: slots.length });
  } catch (err: any) {
    console.error("Couple sync error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Compute intersected free slots for a couple and store in couple_availability */
async function computeCoupleAvailability(
  coupleId: string,
  userAId: string,
  userBId: string,
): Promise<{ start_time: string; end_time: string }[]> {
  const sb = getSupabase();
  const now = new Date().toISOString();

  const [slotsA, slotsB] = await Promise.all([
    sb
      .from("availability")
      .select("start_time, end_time")
      .eq("user_id", userAId)
      .eq("status", "free")
      .gte("end_time", now)
      .order("start_time"),
    sb
      .from("availability")
      .select("start_time, end_time")
      .eq("user_id", userBId)
      .eq("status", "free")
      .gte("end_time", now)
      .order("start_time"),
  ]);

  // Intersect free slots
  const overlaps: { start_time: string; end_time: string }[] = [];
  for (const a of slotsA.data || []) {
    for (const b of slotsB.data || []) {
      const start = a.start_time > b.start_time ? a.start_time : b.start_time;
      const end = a.end_time < b.end_time ? a.end_time : b.end_time;
      if (start < end) {
        const durMin = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
        if (durMin >= 30) {
          overlaps.push({ start_time: start, end_time: end });
        }
      }
    }
  }

  // Replace existing availability
  await sb.from("couple_availability").delete().eq("couple_id", coupleId);

  if (overlaps.length > 0) {
    await sb.from("couple_availability").insert(
      overlaps.map((o) => ({
        couple_id: coupleId,
        start_time: o.start_time,
        end_time: o.end_time,
      })),
    );
  }

  return overlaps;
}

export default router;
