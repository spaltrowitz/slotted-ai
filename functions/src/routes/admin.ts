import express, { Request, Response, NextFunction } from "express";
import { requireAdmin } from "../middleware/auth";
import { getSupabase } from "../supabase";

const router = express.Router();

// ---------------------------------------------------------------------------
// One-time migration endpoint
// ---------------------------------------------------------------------------
router.post("/admin/migrate", requireAdmin, async (_req: Request, res: Response) => {
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

// ===========================================================================
// ADMIN / STAGING ENDPOINTS
// ===========================================================================
// These endpoints let you inspect and manage any user's data for QA/staging
// purposes. Protected by a shared secret sent via X-Admin-Secret header or
// body.secret field.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// GET /admin/users — list all users (id, email, display_name, onboarded, created_at)
// ---------------------------------------------------------------------------
router.get("/admin/users", requireAdmin, async (_req: Request, res: Response) => {
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
router.get("/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("users")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) { res.status(404).json({ error: "User not found" }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/notifications — view a user's notifications
// ---------------------------------------------------------------------------
router.get("/admin/users/:id/notifications", requireAdmin, async (req: Request, res: Response) => {
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
router.delete("/admin/users/:id/notifications", requireAdmin, async (req: Request, res: Response) => {
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
router.delete("/admin/notifications/:id", requireAdmin, async (req: Request, res: Response) => {
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
router.post("/admin/users/:id/notifications/mark-all-read", requireAdmin, async (req: Request, res: Response) => {
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
router.get("/admin/users/:id/fcm-tokens", requireAdmin, async (req: Request, res: Response) => {
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
router.delete("/admin/users/:id/fcm-tokens", requireAdmin, async (req: Request, res: Response) => {
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
router.get("/admin/users/:id/meetups", requireAdmin, async (req: Request, res: Response) => {
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
router.get("/admin/users/:id/friendships", requireAdmin, async (req: Request, res: Response) => {
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
router.get("/admin/stats", requireAdmin, async (_req: Request, res: Response) => {
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
router.get("/admin/sync-logs", requireAdmin, async (req: Request, res: Response) => {
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
router.post("/admin/friendships", requireAdmin, async (req: Request, res: Response) => {
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
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
