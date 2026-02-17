-- ============================================
-- Slotted Beta Funnel Report
-- Run this against Supabase SQL Editor
-- ============================================

-- 1. Overall funnel counts
SELECT 
  'Total accounts created' AS step,
  COUNT(*) AS count
FROM users

UNION ALL

SELECT 
  'Calendar connected (Google or Apple)' AS step,
  COUNT(*) AS count
FROM users
WHERE google_refresh_token IS NOT NULL 
   OR apple_calendar_connected = TRUE

UNION ALL

SELECT 
  'Onboarding completed' AS step,
  COUNT(*) AS count
FROM users
WHERE onboarded = TRUE

UNION ALL

SELECT
  'Settings customized (non-default preferences)' AS step,
  COUNT(*) AS count
FROM users
WHERE preferred_times IS NOT NULL
   OR social_goal IS NOT NULL
   OR preferred_duration IS NOT NULL
   OR preferred_call_duration IS NOT NULL

UNION ALL

SELECT 
  'Has at least 1 accepted friend' AS step,
  COUNT(DISTINCT u.id) AS count
FROM users u
WHERE EXISTS (
  SELECT 1 FROM friendships f 
  WHERE (f.user_a_id = u.id OR f.user_b_id = u.id)
    AND f.status = 'accepted'
)

UNION ALL

SELECT 
  'Scheduled at least 1 meetup' AS step,
  COUNT(DISTINCT m.organizer_id) AS count
FROM meetups m

ORDER BY count DESC;


-- ============================================
-- 2. Per-user funnel detail
-- ============================================
SELECT 
  u.display_name,
  u.email,
  u.created_at::date AS signed_up,
  CASE WHEN u.google_refresh_token IS NOT NULL OR u.apple_calendar_connected THEN '✅' ELSE '❌' END AS calendar,
  CASE WHEN u.onboarded THEN '✅' ELSE '❌' END AS onboarded,
  CASE WHEN u.preferred_times IS NOT NULL OR u.social_goal IS NOT NULL THEN '✅' ELSE '❌' END AS settings,
  COALESCE(friends.cnt, 0) AS friends,
  COALESCE(meetups.cnt, 0) AS meetups
FROM users u
LEFT JOIN (
  SELECT user_id, COUNT(*) AS cnt FROM (
    SELECT user_a_id AS user_id FROM friendships WHERE status = 'accepted'
    UNION ALL
    SELECT user_b_id AS user_id FROM friendships WHERE status = 'accepted'
  ) f GROUP BY user_id
) friends ON friends.user_id = u.id
LEFT JOIN (
  SELECT organizer_id, COUNT(*) AS cnt 
  FROM meetups 
  GROUP BY organizer_id
) meetups ON meetups.organizer_id = u.id
ORDER BY u.created_at;


-- ============================================
-- 3. Pending invites that haven't signed up yet
-- ============================================
SELECT 
  pi.invited_email,
  u.display_name AS invited_by,
  pi.created_at::date AS invited_on,
  CASE WHEN EXISTS (
    SELECT 1 FROM users u2 WHERE u2.email = pi.invited_email
  ) THEN '✅ Signed up' ELSE '⏳ Pending' END AS status
FROM pending_invites pi
JOIN users u ON u.id = pi.inviter_id
ORDER BY pi.created_at DESC;
