import express, { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
  extractCity,
  createNotification,
  getAcceptedFriendIdSet,
  strictCalendarCheck,
} from "../utils/helpers";
import { getSupabase } from "../supabase";

const router = express.Router();

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

/** GET /friends — list current user's friendships with friend details */
router.get("/friends", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
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

    const rows = friendships || [];
    const friendIds = rows.map((f: any) => (f.user_a_id === me.id ? f.user_b_id : f.user_a_id));
    const uniqueFriendIds = [...new Set(friendIds)];

    // Strict calendar "connected" signal:
    // - has at least one selected provider calendar
    // - has at least one recently-synced busy block in the active sync window
    // This avoids showing "connected" for stale tokens/reconnect-required states.
    const selectedCalendarUsers = new Set<string>();
    const usersWithRecentBusy = new Set<string>();
    if (uniqueFriendIds.length > 0) {
      const { data: selectedRows } = await getSupabase()
        .from("user_calendars")
        .select("user_id")
        .in("user_id", uniqueFriendIds)
        .eq("is_selected", true);
      for (const row of selectedRows || []) {
        selectedCalendarUsers.add((row as any).user_id);
      }

      const nowIso = new Date().toISOString();
      const windowEndIso = new Date(Date.now() + 14 * 86400000).toISOString();
      const recentSyncCutoffIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      const { data: busyRows } = await getSupabase()
        .from("availability")
        .select("user_id")
        .in("user_id", uniqueFriendIds)
        .eq("status", "busy")
        .gte("end_time", nowIso)
        .lte("start_time", windowEndIso)
        .gte("created_at", recentSyncCutoffIso);
      for (const row of busyRows || []) {
        usersWithRecentBusy.add((row as any).user_id);
      }
    }

    // Flatten: return the *other* user as "friend"
    const friends = rows.map((f: any) => {
      const iAmA = f.user_a.id === me.id;
      const friend = iAmA ? f.user_b : f.user_a;
      const strictCalendarConnected =
        selectedCalendarUsers.has(friend.id) && usersWithRecentBusy.has(friend.id);
      // hangoutPref is MY private preference for this friend
      const hangoutPref = iAmA ? (f.user_a_hangout_pref || "both") : (f.user_b_hangout_pref || "both");
      const friendshipType = iAmA ? (f.user_a_friendship_type || "local") : (f.user_b_friendship_type || "local");
      const visitDurationHours = iAmA ? f.user_a_visit_duration_hours : f.user_b_visit_duration_hours;
      return {
        id: f.id,
        friendshipId: f.id,
        user_a_id: f.user_a_id,
        user_b_id: f.user_b_id,
        status: f.status,
        invited_by: f.invited_by,
        invitedBy: f.invited_by,
        hangoutPref,
        friendshipType,
        visitDurationHours,
        friend: {
          id: friend.id,
          displayName: friend.display_name,
          photoUrl: friend.photo_url,
          neighborhood: friend.neighborhood,
          timezone: friend.timezone,
          calendarConnected: strictCalendarConnected,
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
router.post("/friends/invite", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
        .maybeSingle();
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
        .maybeSingle();
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

    // Check if either user has blocked the other
    if (await isBlocked(me.id, invitee.id)) {
      res.status(403).json({ error: "Unable to send request" });
      return;
    }

    // Check for declined friendship with cooldown (7 days)
    const iAmACheck = me.id < invitee.id;
    const [checkA, checkB] = iAmACheck ? [me.id, invitee.id] : [invitee.id, me.id];
    const { data: existingFriendship } = await getSupabase()
      .from("friendships")
      .select("status, updated_at, invited_by")
      .eq("user_a_id", checkA)
      .eq("user_b_id", checkB)
      .maybeSingle();

    if (existingFriendship?.status === "declined") {
      const declinedAt = new Date(existingFriendship.updated_at).getTime();
      const cooldownMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - declinedAt < cooldownMs) {
        res.status(429).json({ error: "You can send another invite soon" });
        return;
      }
    }

    // FIX: If the other user already sent us a pending request, auto-accept both
    if (existingFriendship?.status === "pending" && existingFriendship.invited_by !== me.id) {
      // The other user invited us — they clearly want to be friends too, auto-accept
      const { data: accepted, error: acceptErr } = await getSupabase()
        .from("friendships")
        .update({ status: "accepted" })
        .eq("user_a_id", checkA)
        .eq("user_b_id", checkB)
        .select()
        .single();

      if (acceptErr) {
        res.status(500).json({ error: acceptErr.message });
        return;
      }

      // Notify both users
      await createNotification({
        userId: invitee.id,
        type: "friend_accepted",
        title: "You're now friends!",
        body: `${me.display_name || me.email} also sent you a request — you're now connected on Slotted!`,
        relatedUserId: me.id,
        relatedId: accepted.id,
      });
      await createNotification({
        userId: me.id,
        type: "friend_accepted",
        title: "You're now friends!",
        body: `${invitee.display_name || invitee.email || "Your friend"} already invited you — you're now connected!`,
        relatedUserId: invitee.id,
        relatedId: accepted.id,
      });

      res.json(accepted);
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
router.post("/friends/connect-referral", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
        .maybeSingle();
      referrer = data;
    } else if (referrerEmail) {
      const { data } = await getSupabase()
        .from("users")
        .select("id, neighborhood")
        .eq("email", referrerEmail)
        .maybeSingle();
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
      .maybeSingle();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Notification intentionally omitted here: POST /users/me already notifies the referrer
    // via the pending_invites auto-connect loop, making this a second write for the same event.
    // Removing it prevents duplicate friend_accepted notifications on signup-via-referral.
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /friends/:friendshipId — accept or decline a friendship, update prefs */
router.patch("/friends/:friendshipId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { friendshipId } = req.params;
  const { action: rawAction, status, hangoutPref, friendshipType, visitDurationHours } = req.body;

  // Accept "status" as an alias for "action" (e.g., { status: "accepted" } → action: "accept")
  const statusToAction: Record<string, string> = { accepted: "accept", declined: "decline" };
  const action = rawAction || (status ? statusToAction[status] : undefined);

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
      const { data: friendship, error: lookupError } = await getSupabase()
        .from("friendships")
        .select("user_a_id, user_b_id")
        .eq("id", friendshipId)
        .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
        .maybeSingle();
      if (lookupError || !friendship) {
        console.error(`Friendship lookup failed for ${friendshipId}, user ${me.id}:`, lookupError?.message);
        res.status(404).json({ error: "Friendship not found" });
        return;
      }
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

    if (Object.keys(updatePayload).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
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
router.delete("/friends/:friendshipId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

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
// Block / Unblock Users
// ---------------------------------------------------------------------------

/** Helper: check if either user has blocked the other */
async function isBlocked(userA: string, userB: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from("blocked_users")
    .select("id")
    .or(`and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`)
    .limit(1);
  return !!(data && data.length > 0);
}

/** POST /users/block/:userId — block a user */
router.post("/users/block/:userId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { userId: targetId } = req.params;
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }
    if (targetId === me.id) { res.status(400).json({ error: "Cannot block yourself" }); return; }

    // Insert block
    const { error: blockErr } = await getSupabase()
      .from("blocked_users")
      .upsert({ blocker_id: me.id, blocked_id: targetId }, { onConflict: "blocker_id,blocked_id" });

    if (blockErr) { res.status(500).json({ error: blockErr.message }); return; }

    // Remove any existing friendship between the two users
    const [smallId, bigId] = me.id < targetId ? [me.id, targetId] : [targetId, me.id];
    await getSupabase()
      .from("friendships")
      .delete()
      .eq("user_a_id", smallId)
      .eq("user_b_id", bigId);

    res.json({ success: true, blocked: targetId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /users/block/:userId — unblock a user */
router.delete("/users/block/:userId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  const { userId: targetId } = req.params;
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { error } = await getSupabase()
      .from("blocked_users")
      .delete()
      .eq("blocker_id", me.id)
      .eq("blocked_id", targetId);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true, unblocked: targetId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /users/blocked — list users I have blocked */
router.get("/users/blocked", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { data, error } = await getSupabase()
      .from("blocked_users")
      .select("id, blocked_id, created_at")
      .eq("blocker_id", me.id)
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Fetch display info for blocked users
    const blockedIds = (data || []).map((b: any) => b.blocked_id);
    let blockedUsers: any[] = [];
    if (blockedIds.length > 0) {
      const { data: users } = await getSupabase()
        .from("users")
        .select("id, display_name, photo_url")
        .in("id", blockedIds);
      blockedUsers = users || [];
    }

    const result = (data || []).map((b: any) => {
      const user = blockedUsers.find((u: any) => u.id === b.blocked_id);
      return { id: b.id, blockedId: b.blocked_id, displayName: user?.display_name, photoUrl: user?.photo_url, createdAt: b.created_at };
    });

    res.json({ blocked: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
