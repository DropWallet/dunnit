-- Migration: Add is_private flag to users table
-- 
-- Reason: Respect user privacy intent. When a profile becomes private (401 from Steam API),
-- we should immediately hide their cached sessions from the feed, even if we have cached data.
-- This prevents "privacy ghosting" where private users' activity is still visible.
--
-- Impact: When a user's profile becomes private, their sessions will be filtered out
-- from the feed immediately, respecting their privacy choice.

-- Add is_private column (defaults to false for existing users)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient filtering of private users
CREATE INDEX IF NOT EXISTS idx_users_is_private ON users(is_private) WHERE is_private = true;

-- Note: The application layer will update this flag when:
-- 1. Steam API returns 401 (private profile)
-- 2. communityVisibilityState indicates private profile
-- 3. User explicitly sets profile to private
