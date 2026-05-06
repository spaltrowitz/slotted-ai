-- Migration: Event-Anchored Friend Invite Links
-- Run this in the Supabase SQL Editor

-- 1. Create the friend_invites table
CREATE TABLE friend_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_schedule_id TEXT,
  event_title TEXT NOT NULL,
  friend_ids UUID[] DEFAULT '{}',
  invited_email TEXT,
  invited_phone TEXT,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Index for fast token lookups (primary access pattern)
CREATE UNIQUE INDEX idx_friend_invites_token ON friend_invites(token);

-- 3. Index for listing invites by inviter
CREATE INDEX idx_friend_invites_inviter ON friend_invites(inviter_id);

-- 4. RLS: Enable row-level security
ALTER TABLE friend_invites ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Anyone can read by token (needed for unauthenticated GET validation)
CREATE POLICY "friend_invites_select_by_token"
  ON friend_invites FOR SELECT
  USING (true);

-- Inviter can insert
CREATE POLICY "friend_invites_insert_inviter"
  ON friend_invites FOR INSERT
  WITH CHECK (inviter_id = (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));

-- Inviter or accepter can update
CREATE POLICY "friend_invites_update"
  ON friend_invites FOR UPDATE
  USING (
    inviter_id = (SELECT id FROM users WHERE firebase_uid = auth.uid()::text)
    OR accepted_by = (SELECT id FROM users WHERE firebase_uid = auth.uid()::text)
  );

-- Service role bypasses all (API uses service_role key)
-- No explicit policy needed — service_role bypasses RLS by default
