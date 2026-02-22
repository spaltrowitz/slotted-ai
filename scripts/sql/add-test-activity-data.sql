-- Quick test data to populate your activity feed
-- Run this in Supabase SQL Editor

-- First, get your user info (you and your friends)
SELECT id, display_name, email FROM users ORDER BY created_at DESC LIMIT 5;

-- ========================================
-- STEP 1: Add share_hangouts for your friends (so their logs show in your feed)
-- Replace with actual user IDs from above
-- ========================================
UPDATE users 
SET share_hangouts = true 
WHERE email IN ('josh@example.com', 'mike@example.com');
-- Or by ID:
-- WHERE id IN ('JOSH_USER_ID', 'MIKE_USER_ID');

-- ========================================
-- STEP 2: Create recent meetup logs (triggers "recent activity" feed)
-- ========================================
-- Josh had coffee 2 days ago
INSERT INTO meetup_logs (id, user_id, activity_type, duration_min, time_of_day, day_of_week, rating, created_at)
VALUES (
  uuid_generate_v4(),
  (SELECT id FROM users WHERE email = 'josh@example.com'),
  'coffee',
  60,
  'morning',
  EXTRACT(DOW FROM NOW() - INTERVAL '2 days')::INT,
  5,
  NOW() - INTERVAL '2 days'
);

-- Mike had drinks 3 days ago
INSERT INTO meetup_logs (id, user_id, activity_type, duration_min, time_of_day, day_of_week, rating, created_at)
VALUES (
  uuid_generate_v4(),
  (SELECT id FROM users WHERE email = 'mike@example.com'),
  'drinks',
  90,
  'evening',
  EXTRACT(DOW FROM NOW() - INTERVAL '3 days')::INT,
  4,
  NOW() - INTERVAL '3 days'
);

-- ========================================
-- STEP 3: Create an old completed meetup (triggers "overdue friends" activity)
-- This creates a hangout from 35 days ago with Josh
-- ========================================
WITH new_meetup AS (
  INSERT INTO meetups (id, title, start_time, end_time, status, created_by)
  VALUES (
    uuid_generate_v4(),
    'Coffee catch-up',
    NOW() - INTERVAL '35 days',
    NOW() - INTERVAL '35 days' + INTERVAL '1 hour',
    'completed',
    (SELECT id FROM users WHERE email = 'sharipaltrowitz@gmail.com')
  )
  RETURNING id
)
INSERT INTO meetup_participants (meetup_id, user_id, rsvp)
SELECT 
  new_meetup.id,
  users.id,
  'accepted'
FROM new_meetup
CROSS JOIN (
  SELECT id FROM users WHERE email = 'sharipaltrowitz@gmail.com'
  UNION ALL
  SELECT id FROM users WHERE email = 'josh@example.com'
) users;

-- ========================================
-- STEP 4: Verify the data was created
-- ========================================
SELECT 'Meetup Logs Count' as check_type, COUNT(*)::TEXT as result
FROM meetup_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
UNION ALL
SELECT 'Completed Meetups Count', COUNT(*)::TEXT
FROM meetups
WHERE status = 'completed'
UNION ALL
SELECT 'Users with share_hangouts', COUNT(*)::TEXT
FROM users
WHERE share_hangouts = true;
