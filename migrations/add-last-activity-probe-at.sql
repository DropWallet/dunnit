-- Migration: Add last_activity_probe_at column to users table
-- Friend Activity Discovery: Track when we last probed each friend for recent activity (GetRecentlyPlayedGames)
-- Run this SQL in your Supabase SQL Editor

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_activity_probe_at TIMESTAMPTZ;

COMMENT ON COLUMN users.last_activity_probe_at IS 'When we last probed this user for recent activity via GetRecentlyPlayedGames. Used to round-robin discovery so we catch all friends who played in the last 14 days.';

-- Optional: index for "oldest probe first" queries
CREATE INDEX IF NOT EXISTS idx_users_last_activity_probe ON users(last_activity_probe_at NULLS FIRST);
