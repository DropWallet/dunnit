-- Script to fix playtime session timestamps
-- This corrects sessions that were created with incorrect session_end timestamps
-- (set to sync time instead of actual playtime end)

-- Strategy:
-- 1. For sessions with recent last_played in user_games, use that as session_end
-- 2. For sessions without recent last_played, use session_start + playtime_delta as session_end
-- 3. Only update sessions created after the bug was introduced (e.g., after 2026-01-09)

BEGIN;

-- Step 1: Update sessions where we have a recent last_played from user_games
-- Use last_played if it's within 24 hours of the session_start
UPDATE game_sessions gs
SET 
  session_end = ug.last_played,
  updated_at = NOW()
FROM user_games ug
WHERE 
  gs.type = 'playtime'
  AND gs.user_id = ug.user_id
  AND gs.app_id = ug.app_id
  AND ug.last_played IS NOT NULL
  AND ug.last_played >= gs.session_start
  AND ug.last_played <= gs.session_start + INTERVAL '24 hours'
  AND gs.session_end >= '2026-01-09'::timestamptz  -- Only fix sessions created after the bug
  AND gs.session_end > gs.session_start + INTERVAL '1 hour';  -- Only fix if session_end seems wrong (too far from start)

-- Step 2: For remaining sessions without valid last_played, calculate session_end from session_start + playtime_delta
-- Cap the duration at 4 hours (same as achievement sessions)
UPDATE game_sessions gs
SET 
  session_end = LEAST(
    gs.session_start + (LEAST(gs.playtime_delta, 240) || ' minutes')::INTERVAL,  -- Cap at 4 hours (240 min)
    gs.session_end  -- Don't make it later than current session_end
  ),
  updated_at = NOW()
WHERE 
  gs.type = 'playtime'
  AND gs.session_end >= '2026-01-09'::timestamptz  -- Only fix sessions created after the bug
  AND gs.session_end > gs.session_start + INTERVAL '1 hour'  -- Only fix if session_end seems wrong
  AND NOT EXISTS (
    -- Don't update if we already fixed it in step 1
    SELECT 1 FROM user_games ug
    WHERE ug.user_id = gs.user_id
      AND ug.app_id = gs.app_id
      AND ug.last_played IS NOT NULL
      AND ug.last_played >= gs.session_start
      AND ug.last_played <= gs.session_start + INTERVAL '24 hours'
  );

-- Show summary of what was updated
SELECT 
  'Updated sessions' as action,
  COUNT(*) as count,
  MIN(session_end) as earliest_session_end,
  MAX(session_end) as latest_session_end
FROM game_sessions
WHERE type = 'playtime'
  AND updated_at >= NOW() - INTERVAL '1 minute';  -- Sessions just updated

COMMIT;

-- Optional: Show some examples of fixed sessions
-- SELECT 
--   gs.user_id,
--   gs.app_id,
--   ug.name as game_name,
--   gs.session_start,
--   gs.session_end,
--   gs.playtime_delta,
--   gs.updated_at
-- FROM game_sessions gs
-- LEFT JOIN user_games ug ON gs.user_id = ug.user_id AND gs.app_id = ug.app_id
-- WHERE gs.type = 'playtime'
--   AND gs.updated_at >= NOW() - INTERVAL '1 minute'
-- ORDER BY gs.session_end DESC
-- LIMIT 20;
