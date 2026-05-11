import express, { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rateLimiter";
import {
  getDbUser,
  getAcceptedFriendIdSet,
  strictCalendarCheck,
  createNotification,
} from "../utils/helpers";
import { getSupabase } from "../supabase";
import * as admin from "firebase-admin";
import { generateSmartSuggestions, analyzeFriendPatterns, updateUserPreferences } from "../utils/aiSuggestions";

const router = express.Router();

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

// ---------------------------------------------------------------------------
// Suggestions routes (AI scoring — placeholder logic for now)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Smart AI-powered suggestions based on meetup history
// (MUST be registered before /suggestions/:friendId to avoid being shadowed)
// ---------------------------------------------------------------------------
router.get("/suggestions/smart", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) { res.status(404).json({ error: "User not found" }); return; }

    const [suggestions, patterns] = await Promise.all([
      generateSmartSuggestions(dbUser.id),
      analyzeFriendPatterns(dbUser.id),
    ]);

    res.json({
      suggestions,
      patterns: patterns.slice(0, 10),
      hasEnoughData: patterns.some(p => p.totalHangouts >= 3),
    });
  } catch (err: any) {
    console.error("Smart suggestions error:", err?.stack || err?.message || err);
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

/** GET /suggestions/:friendId — get suggested meeting times */
router.get("/suggestions/:friendId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.post("/suggestions/:suggestionId/act", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/dashboard", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // 1. Get accepted friends
    const { data: friendships } = await getSupabase()
      .from("friendships")
      .select("*, user_a:users!friendships_user_a_id_fkey(id,display_name,photo_url,neighborhood,timezone), user_b:users!friendships_user_b_id_fkey(id,display_name,photo_url,neighborhood,timezone)")
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
router.get("/activity-feed", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
          .maybeSingle();

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
router.post("/activity-feed/dismiss", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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

router.post("/feedback", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { category, summary, details, message } = req.body;

    // Support both new format (category+summary+details) and legacy (message)
    const feedbackCategory = category || "idea";
    const feedbackSummary = summary || message || "";
    const feedbackDetails = details || "";

    if (!feedbackSummary || typeof feedbackSummary !== "string" || !feedbackSummary.trim()) {
      res.status(400).json({ error: "Summary/message is required" });
      return;
    }

    const firebaseUser = await admin.auth().getUser(req.uid!);
    const feedbackEntry = {
      firebase_uid: req.uid,
      email: firebaseUser.email ?? "unknown",
      display_name: firebaseUser.displayName ?? "unknown",
      category: feedbackCategory,
      message: feedbackSummary.trim(),
      details: feedbackDetails.trim(),
      created_at: new Date().toISOString(),
    };

    // Store in Supabase
    const { error } = await getSupabase()
      .from("feedback")
      .insert(feedbackEntry);

    if (error) {
      console.error("Failed to store feedback in Supabase:", error);
    }

    console.log("📬 USER FEEDBACK:", JSON.stringify(feedbackEntry));

    // Create GitHub issue for automatic triage
    const ghToken = process.env.GITHUB_TOKEN;
    if (ghToken) {
      try {
        const categoryLabel: Record<string, string> = {
          bug: "bug",
          idea: "enhancement",
          love: "love",
        };
        const categoryEmoji: Record<string, string> = {
          bug: "Bug",
          idea: "Idea",
          love: "Love",
        };
        const issueTitle = `[${categoryEmoji[feedbackCategory] || "Feedback"}] ${feedbackSummary.trim().slice(0, 100)}`;
        const issueBody = [
          `**Category:** ${feedbackCategory}`,
          `**From:** ${feedbackEntry.display_name} (${feedbackEntry.email})`,
          `**Submitted:** ${feedbackEntry.created_at}`,
          "",
          `### Summary`,
          feedbackSummary.trim(),
          feedbackDetails.trim() ? `\n### Details\n${feedbackDetails.trim()}` : "",
        ].join("\n");

        const labels = ["feedback"];
        if (categoryLabel[feedbackCategory]) {
          labels.push(categoryLabel[feedbackCategory]);
        }

        const ghRes = await fetch("https://api.github.com/repos/spaltrowitz/slotted.ai/issues", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: issueTitle,
            body: issueBody,
            labels,
            assignees: ["copilot"],
          }),
        });

        if (!ghRes.ok) {
          console.error("GitHub issue creation failed:", ghRes.status, await ghRes.text());
        } else {
          console.log("✅ GitHub issue created for feedback");
        }
      } catch (ghErr) {
        console.error("Failed to create GitHub issue:", ghErr);
      }
    }

    // Notify the app owner via in-app notification
    try {
      const { data: ownerRow } = await getSupabase()
        .from("users")
        .select("id")
        .eq("email", "sharipaltrowitz@gmail.com")
        .maybeSingle();
      if (ownerRow) {
        await createNotification({
          userId: ownerRow.id,
          type: "feedback",
          title: `Feedback from ${feedbackEntry.display_name}`,
          body: feedbackSummary.trim().slice(0, 500),
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
router.post("/meetup-logs", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
    await updateUserPreferences(dbUser.id);

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
router.get("/meetup-logs", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
router.get("/preferences/learned", authWithRateLimit, async (req: AuthRequest, res: Response) => {
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
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error; // PGRST116 = not found
    res.json(data || { total_meetups_logged: 0 });
  } catch (err) {
    console.error("Preferences fetch error:", err);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

export default router;
