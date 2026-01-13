-- Migration: Add last_feed_sync_attempt column to users table
-- OPTIMIZATION #5: Prevents refresh spamming by tracking last sync attempt
-- Run this SQL in your Supabase SQL Editor

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_feed_sync_attempt TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN users.last_feed_sync_attempt IS 'Tracks last time a feed sync was attempted for this user. Used to prevent refresh spamming (only sync if last attempt was >15 minutes ago).';
