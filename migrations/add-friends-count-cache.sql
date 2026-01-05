-- Add friends_count caching to users table
-- This allows us to cache friend count to reduce Steam API calls

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS friends_count INTEGER,
ADD COLUMN IF NOT EXISTS friends_count_synced_at TIMESTAMPTZ;

-- Add index for faster lookups (optional, but helpful if we query by friends_count)
-- CREATE INDEX IF NOT EXISTS idx_users_friends_count ON users(friends_count) WHERE friends_count IS NOT NULL;
