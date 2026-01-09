-- Migration: Add game_sessions table
-- This table stores persistent session records (ledger approach) instead of
-- calculating sessions from deltas on-the-fly. This solves the "snapshot vs ledger"
-- problem where sessions disappear once deltas are reset.

CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  playtime_delta INTEGER NOT NULL DEFAULT 0,
  session_start TIMESTAMPTZ NOT NULL,
  session_end TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('playtime', 'achievement')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

-- Index for efficient queries by user_id and app_id (to check for recent sessions for cooldown merging)
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_app ON game_sessions(user_id, app_id);

-- Index for efficient feed queries (order by session_end DESC)
CREATE INDEX IF NOT EXISTS idx_game_sessions_session_end ON game_sessions(session_end DESC);

-- Index for efficient queries by user_id (to get all sessions for a user)
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_id ON game_sessions(user_id);

-- Index for efficient queries by type (to filter playtime vs achievement sessions)
CREATE INDEX IF NOT EXISTS idx_game_sessions_type ON game_sessions(type);

-- Composite index for feed queries (user_id IN friends, ordered by session_end)
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_end ON game_sessions(user_id, session_end DESC);
