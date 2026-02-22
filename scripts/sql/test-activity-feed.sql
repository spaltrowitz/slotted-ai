-- Test data to populate activity feed
-- Run this in Supabase SQL Editor to see sample activities in your dashboard

-- First, get your user IDs (you'll need these for the next steps)
SELECT id, display_name, email 
FROM users 
ORDER BY created_at DESC 
LIMIT 5;

-- ========================================
-- Option 1: Create a completed meetup with Josh (to trigger "overdue friends" activity)
-- Replace YOUR_USER_ID and JOSH_USER_ID with actual UUIDs from query above
-- ========================================
/*
-- Create a meetup from 45 days ago (overdue threshold is 30 days)
INSERT INTO meetups (id, title, start_time, end_time, status, created_by)
VALUES (
  uuid_generate_v4(),
  'Coffee catch-up',
  NOW() - INTERVAL '45 days',
  NOW() - INTERVAL '45 days' + INTERVAL '1 hour',
  'completed',
  'YOUR_USER_ID'
) RETURNING id;

-- Add participants (copy the meetup ID from above)
INSERT INTO meetup_participants (meetup_id, user_id, rsvp)
VALUES 
  ('MEETUP_ID_FROM_ABOVE', 'YOUR_USER_ID', 'accepted'),
  ('MEETUP_ID_FROM_ABOVE', 'JOSH_USER_ID', 'accepted');
*/

-- ========================================
-- Option 2: Create a recent meetup log (to trigger "recent activity" feed)
-- This requires Josh to have share_hangouts = true
-- ========================================
/*
-- First enable share_hangouts for Josh
UPDATE users 
SET share_hangouts = true 
WHERE id = 'JOSH_USER_ID';

-- Create a recent log entry for Josh
INSERT INTO meetup_logs (user_id, activity_type, created_at)
VALUES ('JOSH_USER_ID', 'coffee', NOW() - INTERVAL '2 days');
*/

-- ========================================
-- Option 3: Quick test with fake "overdue" entry for testing
-- ========================================
/*
-- This creates a completed meetup with a friend from 35 days ago
WITH your_friendship AS (
  SELECT 
    CASE WHEN user_a_id = (SELECT id FROM users WHERE email = 'YOUR_EMAIL') THEN user_b_id
         ELSE user_a_id 
    END as friend_id
  FROM friendships
  WHERE status = 'accepted'
  AND (user_a_id = (SELECT id FROM users WHERE email = 'YOUR_EMAIL') 
       OR user_b_id = (SELECT id FROM users WHERE email = 'YOUR_EMAIL'))
  LIMIT 1
),
new_meetup AS (
  INSERT INTO meetups (title, start_time, end_time, status, created_by)
  SELECT 
    'Old hangout',
    NOW() - INTERVAL '35 days',
    NOW() - INTERVAL '35 days' + INTERVAL '1 hour',
    'completed',
    (SELECT id FROM users WHERE email = 'YOUR_EMAIL')
  RETURNING id
)
INSERT INTO meetup_participants (meetup_id, user_id, rsvp)
SELECT 
  new_meetup.id,
  u.id,
  'accepted'
FROM new_meetup
CROSS JOIN (
  SELECT id FROM users WHERE email = 'YOUR_EMAIL'
  UNION ALL
  SELECT friend_id FROM your_friendship
) u;
*/
