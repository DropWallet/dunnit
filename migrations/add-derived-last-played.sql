-- Migration: Add derived_last_played columns to user_games table
-- This enables caching of achievement-based "last played" dates for better sorting performance

-- Add derived_last_played column (stores the latest achievement unlock time)
ALTER TABLE user_games 
ADD COLUMN IF NOT EXISTS derived_last_played TIMESTAMPTZ;

-- Add derived_last_played_calculated_at column (tracks when the derived date was calculated)
ALTER TABLE user_games 
ADD COLUMN IF NOT EXISTS derived_last_played_calculated_at TIMESTAMPTZ;

-- Add index for faster queries when sorting by derived_last_played
CREATE INDEX IF NOT EXISTS idx_user_games_derived_last_played 
ON user_games(derived_last_played) 
WHERE derived_last_played IS NOT NULL;
