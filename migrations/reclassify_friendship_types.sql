-- Reclassify all friendships based on current user neighborhoods.
-- Fixes friendships created before neighborhood detection existed,
-- or created via auto-connect (POST /users/me) which skipped detection.

-- Update user_a's side when cities differ
UPDATE friendships f
SET user_a_friendship_type = 'long_distance'
FROM users ua, users ub
WHERE f.user_a_id = ua.id
  AND f.user_b_id = ub.id
  AND f.status = 'accepted'
  AND ua.neighborhood IS NOT NULL AND ua.neighborhood != ''
  AND ub.neighborhood IS NOT NULL AND ub.neighborhood != ''
  AND LOWER(TRIM(
    CASE WHEN POSITION(',' IN ua.neighborhood) > 0
      THEN SUBSTRING(ua.neighborhood FROM POSITION(',' IN ua.neighborhood) + 1)
      ELSE ua.neighborhood
    END
  )) != LOWER(TRIM(
    CASE WHEN POSITION(',' IN ub.neighborhood) > 0
      THEN SUBSTRING(ub.neighborhood FROM POSITION(',' IN ub.neighborhood) + 1)
      ELSE ub.neighborhood
    END
  ))
  AND (f.user_a_friendship_type IS NULL OR f.user_a_friendship_type = 'local');

-- Update user_b's side when cities differ
UPDATE friendships f
SET user_b_friendship_type = 'long_distance'
FROM users ua, users ub
WHERE f.user_a_id = ua.id
  AND f.user_b_id = ub.id
  AND f.status = 'accepted'
  AND ua.neighborhood IS NOT NULL AND ua.neighborhood != ''
  AND ub.neighborhood IS NOT NULL AND ub.neighborhood != ''
  AND LOWER(TRIM(
    CASE WHEN POSITION(',' IN ua.neighborhood) > 0
      THEN SUBSTRING(ua.neighborhood FROM POSITION(',' IN ua.neighborhood) + 1)
      ELSE ua.neighborhood
    END
  )) != LOWER(TRIM(
    CASE WHEN POSITION(',' IN ub.neighborhood) > 0
      THEN SUBSTRING(ub.neighborhood FROM POSITION(',' IN ub.neighborhood) + 1)
      ELSE ub.neighborhood
    END
  ))
  AND (f.user_b_friendship_type IS NULL OR f.user_b_friendship_type = 'local');
