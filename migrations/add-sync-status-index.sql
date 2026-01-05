-- Migration: Add index for sync-status queries
-- This index makes the 'sync-status' query much faster by optimizing lookups
-- on user_id, app_id, and last_synced_at columns

-- Create composite index for sync status checks
-- This index makes queries like "get all achievement metadata for a user" 
-- much faster, especially as the database grows
CREATE INDEX IF NOT EXISTS idx_user_achievements_sync_check 
ON user_achievements (user_id, app_id, last_synced_at);
