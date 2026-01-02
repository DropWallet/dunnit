-- Dunnit Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Users table
CREATE TABLE IF NOT EXISTS users (
  steam_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  country_code TEXT,
  country_name TEXT,
  join_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ
);

-- Games table (stores user's games)
CREATE TABLE IF NOT EXISTS user_games (
  user_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  playtime_minutes INTEGER NOT NULL DEFAULT 0,
  playtime_2weeks_minutes INTEGER,
  icon_url TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  last_played TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, app_id)
);

-- Achievements table (stores achievement definitions)
CREATE TABLE IF NOT EXISTS achievements (
  app_id INTEGER NOT NULL,
  api_name TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_url TEXT NOT NULL,
  icon_gray_url TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  global_percentage NUMERIC(5, 2),
  PRIMARY KEY (app_id, api_name)
);

-- User achievements table (links users to achievements)
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  achievement_api_name TEXT NOT NULL,
  unlocked BOOLEAN NOT NULL DEFAULT false,
  unlocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, app_id, achievement_api_name),
  FOREIGN KEY (app_id, achievement_api_name) REFERENCES achievements(app_id, api_name) ON DELETE CASCADE
);

-- User statistics table (cached calculated statistics)
-- NOTE: If you already ran the schema before, run this CREATE TABLE statement separately
CREATE TABLE IF NOT EXISTS user_statistics (
  user_id TEXT PRIMARY KEY,
  total_games INTEGER NOT NULL DEFAULT 0,
  started_games INTEGER NOT NULL DEFAULT 0,
  total_achievements INTEGER NOT NULL DEFAULT 0,
  unlocked_achievements INTEGER NOT NULL DEFAULT 0,
  average_completion_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_games_user_id ON user_games(user_id);
CREATE INDEX IF NOT EXISTS idx_user_games_app_id ON user_games(app_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_app_id ON user_achievements(app_id);
CREATE INDEX IF NOT EXISTS idx_achievements_app_id ON achievements(app_id);
