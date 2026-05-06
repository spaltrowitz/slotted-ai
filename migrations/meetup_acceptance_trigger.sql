-- Migration: Meetup auto-confirm trigger
-- When the last participant accepts, atomically transition meetup to 'confirmed'.
-- Replaces application-level race-prone check with DB-level atomic guarantee.

CREATE OR REPLACE FUNCTION check_meetup_all_accepted()
RETURNS TRIGGER AS $$
DECLARE
  total_count INT;
  accepted_count INT;
  meetup_status TEXT;
BEGIN
  -- Only fire when rsvp changes to 'accepted'
  IF NEW.rsvp != 'accepted' OR OLD.rsvp = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Lock the meetup row to serialize concurrent acceptance checks
  SELECT status INTO meetup_status
  FROM meetups
  WHERE id = NEW.meetup_id
  FOR UPDATE;

  -- Skip if meetup is already past 'proposed' state
  IF meetup_status != 'proposed' THEN
    RETURN NEW;
  END IF;

  -- Count total vs accepted participants
  SELECT COUNT(*) INTO total_count
  FROM meetup_participants
  WHERE meetup_id = NEW.meetup_id;

  SELECT COUNT(*) INTO accepted_count
  FROM meetup_participants
  WHERE meetup_id = NEW.meetup_id AND rsvp = 'accepted';

  -- AFTER trigger: NEW row is already visible, so counts are accurate
  IF accepted_count = total_count THEN
    UPDATE meetups SET status = 'confirmed' WHERE id = NEW.meetup_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_meetup_check_all_accepted
  AFTER UPDATE OF rsvp ON meetup_participants
  FOR EACH ROW
  EXECUTE FUNCTION check_meetup_all_accepted();
