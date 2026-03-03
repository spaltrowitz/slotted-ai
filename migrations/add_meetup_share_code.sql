-- Add share_code to meetups for shareable event links
ALTER TABLE meetups ADD COLUMN share_code TEXT UNIQUE;
CREATE INDEX idx_meetups_share_code ON meetups (share_code) WHERE share_code IS NOT NULL;
