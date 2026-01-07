-- Migration: Add playtime tracking columns to user_games table
-- This enables detection of playtime-only sessions (sessions without achievements)
-- by tracking previous playtime values to calculate deltas

-- Add previous_playtime_minutes column (stores the playtime from the last sync)
ALTER TABLE user_games 
ADD COLUMN IF NOT EXISTS previous_playtime_minutes INTEGER;

-- Add playtime_last_synced_at column (tracks when playtime was last synced)
ALTER TABLE user_games 
ADD COLUMN IF NOT EXISTS playtime_last_synced_at TIMESTAMPTZ;

-- Add index for faster queries when filtering by playtime_last_synced_at
CREATE INDEX IF NOT EXISTS idx_user_games_playtime_last_synced_at 
ON user_games(playtime_last_synced_at) 
WHERE playtime_last_synced_at IS NOT NULL;
