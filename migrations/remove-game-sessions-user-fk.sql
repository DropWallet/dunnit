-- Migration: Remove foreign key constraint from game_sessions.user_id
-- 
-- Reason: Allow sessions to be created for friends who haven't signed up for the service.
-- This matches the behavior of feed_comments, which also allows comments from non-users.
-- 
-- The constraint prevents creating sessions for friends not in the users table, even though:
-- 1. ensureUserExists() creates user records during sync
-- 2. Sessions can be created before user records exist (race condition)
-- 3. Friends may have private profiles that prevent user record creation
--
-- Impact: Sessions can now exist without corresponding user records. The application
-- already handles missing user data gracefully (see app/api/feed/route.ts lines 194-197, 391-393).
-- User records will be created on-demand when needed via ensureUserExists().

-- Drop the foreign key constraint
-- PostgreSQL typically names foreign keys as: table_column_fkey
-- If this fails, check the actual constraint name with:
-- SELECT constraint_name FROM information_schema.table_constraints 
-- WHERE table_name = 'game_sessions' AND constraint_type = 'FOREIGN KEY';
ALTER TABLE game_sessions 
DROP CONSTRAINT IF EXISTS game_sessions_user_id_fkey;

-- Note: We keep the user_id column as TEXT NOT NULL to maintain data integrity.
-- The application layer (ensureUserExists) handles user record creation.
