-- Likes table for feed sessions
-- This table stores which users have liked which feed sessions

CREATE TABLE IF NOT EXISTS feed_likes (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

-- Index for efficient queries by session_id (to get like counts)
CREATE INDEX IF NOT EXISTS idx_feed_likes_session_id ON feed_likes(session_id);

-- Index for efficient queries by user_id (to get user's likes)
CREATE INDEX IF NOT EXISTS idx_feed_likes_user_id ON feed_likes(user_id);
