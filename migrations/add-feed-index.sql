-- Index for efficient feed queries
-- This index optimizes queries that fetch recent achievement unlocks for the feed
-- Filters by unlocked=true and unlocked_at IS NOT NULL for better performance

CREATE INDEX IF NOT EXISTS idx_user_achievements_feed 
ON user_achievements(user_id, unlocked_at DESC) 
WHERE unlocked = true AND unlocked_at IS NOT NULL;
