-- Comments table for feed sessions
-- This table stores comments on feed sessions, similar to the likes pattern
-- Comments are keyed by sessionId (deterministic ID) rather than a persisted post
-- Note: user_id does NOT have a foreign key constraint to allow comments on
-- sessions from friends who haven't signed up yet. User data will be fetched
-- from Steam API when needed (same pattern as feed sessions).

CREATE TABLE IF NOT EXISTS feed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL, -- Steam ID (no foreign key - allows comments on non-users)
  content TEXT NOT NULL,
  is_edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_feed_comments_session_id ON feed_comments(session_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_user_id ON feed_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_created_at ON feed_comments(created_at DESC);

-- Composite index for session comments ordered by date (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_feed_comments_session_created ON feed_comments(session_id, created_at DESC);
