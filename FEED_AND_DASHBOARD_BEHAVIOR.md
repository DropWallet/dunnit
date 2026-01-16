# Feed and Dashboard Behavior Documentation

This document describes the intended behavior for the Feed, Dashboard, and Friend Dashboard pages, including all sync scenarios, API usage, and fallback logic.

## Table of Contents

1. [Feed Page (`/feed`)](#feed-page-feed)
2. [Dashboard Page (`/dashboard`)](#dashboard-page-dashboard)
3. [Friend Dashboard Page (`/user/[steamId]`)](#friend-dashboard-page-usersteamid)
4. [Common Concepts](#common-concepts)

---

## Feed Page (`/feed`)

### Purpose
Displays a chronological feed of recent gaming activity from the logged-in user and their Steam friends.

### API Endpoint
`GET /api/feed`

### Acceptance Criteria

#### First Time Load (New User)
**Scenario**: User has never used the app before, or their friends have never been synced.

**Expected Behavior**:
1. ✅ Feed should populate with sessions from friends who have recent activity (within 14 days)
2. ✅ Friends not in the database should be synced (up to 20 friends on first load to prevent API overload)
3. ✅ User records should be created for friends during sync (`ensureUserExists`)
4. ✅ Sessions should be created for friends' recent playtime and achievements
5. ✅ Feed should return populated results (not empty) after sync completes

**API Flow**:
```
1. GET /api/feed
2. Get friend list from Steam API
3. Identify friends needing sync:
   - Friends not in users table (first 20)
   - Friends with recent playtime in user_games (within 14 days)
   - Friends never synced or last synced >14 days ago
4. Sync friends BEFORE querying sessions (ensures feed is populated)
   - Create user records for friends not in DB
   - Sync playtime and achievements
   - Create sessions in game_sessions table
5. Query game_sessions for all friends (now has data)
6. Apply 30-minute cooldown filter
7. Return feed with sessions
```

**Fallback Logic**:
- If friend sync fails for a friend, continue with other friends
- If friend has no games in DB, still attempt sync
- If Steam API fails, use cached data if available
- Sessions are created even if user record doesn't exist (FK constraint removed)

#### Stale Sync Scenario
**Scenario**: Friend was last synced >2 hours ago (stale) or >14 days ago (very stale).

**Expected Behavior**:
1. ✅ Stale friends (>2 hours) should always sync, bypassing 15-minute cooldown
2. ✅ Very stale friends (>14 days) should sync
3. ✅ Fresh friends (<2 hours) respect 15-minute cooldown to prevent API spam
4. ✅ Feed should show new sessions from stale friends after sync

**API Flow**:
```
1. GET /api/feed
2. Check friend staleness:
   - Stale threshold: 2 hours
   - Very stale threshold: 14 days
3. Stale friends (>2 hours): Always sync (bypass 15-min cooldown)
4. Fresh friends (<2 hours): Only sync if last_feed_sync_attempt >15 minutes ago
5. Sync stale friends BEFORE querying sessions
6. Query sessions (includes newly synced data)
7. Return feed
```

**Fallback Logic**:
- If sync times out (5 seconds), continue with cached data
- If friend sync fails, skip that friend but continue with others
- Background sync continues even if timeout exceeded

#### Cached Sync Scenario
**Scenario**: Friend was synced recently (<2 hours ago) and within 15-minute cooldown.

**Expected Behavior**:
1. ✅ Friend should NOT be synced again (respects cooldown)
2. ✅ Feed should use existing sessions from database
3. ✅ No unnecessary Steam API calls
4. ✅ Fast response time (no sync delay)

**API Flow**:
```
1. GET /api/feed
2. Check friend sync status:
   - lastSyncAt < 2 hours ago: Fresh
   - lastFeedSyncAttempt < 15 minutes ago: Within cooldown
3. Skip sync for fresh friends
4. Query existing sessions from game_sessions
5. Apply 30-minute cooldown filter
6. Return feed immediately
```

**Fallback Logic**:
- If no sessions exist but friend is fresh, return empty feed (friend hasn't played recently)
- If friend has sessions but they're outside 14-day window, they won't appear

### Session Cooldown
**30-Minute Cooldown**: Sessions only appear in the feed 30 minutes after they end. This prevents showing incomplete or rapidly changing data and allows achievement sessions to be properly grouped.

**Logic**:
- `sessionEnd <= (now - 30 minutes)` → Session appears in feed
- `sessionEnd > (now - 30 minutes)` → Session hidden (too recent)

### Session Creation Rules

#### Playtime Sessions
- Created when `playtimeDelta >= 3 minutes` (increase in total playtime)
- Created when `delta=0` but `playtime_2weeks >= 3 minutes` AND:
  - No existing session within 14 days, OR
  - `playtime_2weeks` increased since existing session was created
- When `playtime_2weeks` increased: Uses current time as `sessionEnd` (not stale `lastPlayed`)
- When no increase: Uses `lastPlayed` if available

#### Achievement Sessions
- Created when new achievements are unlocked
- Grouped into sessions within 30-minute windows
- Merged with playtime sessions if they overlap

---

## Dashboard Page (`/dashboard`)

### Purpose
Displays the logged-in user's own game library, achievements, and statistics.

### API Endpoints
- `GET /api/user` - User profile data
- `GET /api/games` - User's game library
- `GET /api/user/statistics` - User statistics
- `GET /api/achievements/all` - All user achievements
- `GET /api/achievements?appId=X` - Achievements for specific game

### Acceptance Criteria

#### First Time Load (New User)
**Scenario**: User has never synced their games before.

**Expected Behavior**:
1. ✅ Games should be fetched from Steam API
2. ✅ All games should be saved to `user_games` table
3. ✅ Sessions should be created for games with recent playtime (within 14 days)
4. ✅ Baseline playtime should be set for all games
5. ✅ User's `lastSyncAt` should be updated
6. ✅ Games should appear sorted by "last played" correctly

**API Flow**:
```
1. GET /api/games
2. Check cache:
   - No games in DB → Refresh
   - No user record → Refresh
   - lastSyncAt > 1 hour ago → Refresh
3. If refresh needed:
   - Fetch from Steam API (GetOwnedGames + GetRecentlyPlayedGames)
   - Transform to Game format
   - Calculate derived_last_played for games without lastPlayed
   - Save to user_games table
   - Create sessions for games with playtimeDelta >= 3 minutes
   - Update user.lastSyncAt
4. Return games
```

**Fallback Logic**:
- If `GetRecentlyPlayedGames` fails, use `GetOwnedGames` only
- If `rtime_last_played` is missing, use `lastPlayed` from full library
- If both are missing, calculate `derived_last_played` from achievement unlock times
- If achievements not cached, game appears without lastPlayed (will be calculated later)

#### Stale Sync Scenario
**Scenario**: User's games were last synced >1 hour ago.

**Expected Behavior**:
1. ✅ Games should be refreshed from Steam API
2. ✅ New playtime sessions should be created for games with increased playtime
3. ✅ Baseline should be updated for all games
4. ✅ Games should be re-sorted by "last played" with updated data

**API Flow**:
```
1. GET /api/games
2. Check: lastSyncAt < 1 hour ago → Refresh
3. Fetch from Steam API
4. Compare playtime:
   - playtimeDelta = currentPlaytime - previousPlaytimeMinutes
   - If delta >= 3 minutes: Create session
   - If delta = 0 but playtime_2weeks increased: Create session (use current time)
   - Update baseline
5. Save games and update lastSyncAt
6. Return games
```

**Fallback Logic**:
- If Steam API fails, return cached games
- If playtime decreased (rare), keep existing baseline
- If `playtime_2weeks` is missing, use `playtime_forever` (capped at 4 hours)

#### Cached Sync Scenario
**Scenario**: User's games were synced <1 hour ago.

**Expected Behavior**:
1. ✅ Games should load from cache (fast)
2. ✅ No Steam API calls
3. ✅ Games should appear immediately
4. ✅ "Last played" sorting should work correctly

**API Flow**:
```
1. GET /api/games
2. Check: lastSyncAt >= 1 hour ago → Use cache
3. Load games from user_games table
4. Calculate derived_last_played for games missing it (if achievements cached)
5. Return games immediately
```

**Fallback Logic**:
- If cache is empty but user exists, trigger refresh
- If `derived_last_played` calculation fails, game appears without it (will be calculated on next sync)

### Session Creation for Own Games

#### When Sessions Are Created
1. **Playtime increased** (`playtimeDelta >= 3 minutes`):
   - Uses `playtimeDelta` as session duration
   - Uses `lastPlayed` or current time as `sessionEnd`

2. **Delta = 0 but recent activity**:
   - `playtime_2weeks >= 3 minutes` AND
   - No existing session within 14 days, OR
   - `playtime_2weeks` increased since existing session
   - Uses current time as `sessionEnd` if `playtime_2weeks` increased
   - Uses `lastPlayed` if no increase

#### Session Timestamps
- **Normal case**: `sessionEnd = lastPlayed`, `sessionStart = lastPlayed - duration`
- **playtime_2weeks increased**: `sessionEnd = now`, `sessionStart = now - duration`
- **No lastPlayed**: `sessionEnd = now - duration`, `sessionStart = now - 2*duration`

---

## Friend Dashboard Page (`/user/[steamId]`)

### Purpose
Displays a friend's game library, achievements, and statistics (if their profile is public).

### API Endpoints
- `GET /api/user/[steamId]` - Friend's profile data
- `GET /api/user/[steamId]/games` - Friend's game library
- `GET /api/user/[steamId]/statistics` - Friend's statistics
- `GET /api/user/[steamId]/achievements/all` - All friend's achievements
- `GET /api/achievements?appId=X` - Achievements for specific game

### Acceptance Criteria

#### First Time Load (Friend Never Synced)
**Scenario**: Friend has never been synced before (not in `users` table or no games in `user_games`).

**Expected Behavior**:
1. ✅ Friend's games should be fetched from Steam API
2. ✅ Friend's user record should be created if missing
3. ✅ Games should be saved to `user_games` table
4. ✅ Sessions should be created for games with recent playtime
5. ✅ Friend's `lastSyncAt` should be updated
6. ✅ Games should appear sorted correctly

**API Flow**:
```
1. GET /api/user/[steamId]/games
2. Check cache:
   - No games in DB → Refresh
   - No user record → Refresh
   - lastSyncAt > 1 hour ago → Refresh
3. If refresh needed:
   - Fetch from Steam API (GetOwnedGames + GetRecentlyPlayedGames)
   - Create user record if missing (ensureUserExists)
   - Transform to Game format
   - Calculate derived_last_played
   - Save to user_games table
   - Create sessions for games with playtimeDelta >= 3 minutes
   - Update user.lastSyncAt
4. Return games
```

**Fallback Logic**:
- If `GetRecentlyPlayedGames` fails (private profile), use `GetOwnedGames` only
- If Steam API returns 401 (private profile), return empty games array
- If user record creation fails, continue with games sync (user will be created later)
- If `rtime_last_played` missing, use `lastPlayed` from full library or calculate from achievements

#### Stale Sync Scenario
**Scenario**: Friend's games were last synced >1 hour ago.

**Expected Behavior**:
1. ✅ Games should be refreshed from Steam API
2. ✅ New sessions should be created for games with increased playtime
3. ✅ Baseline should be updated
4. ✅ Games should be re-sorted with updated data

**API Flow**:
```
1. GET /api/user/[steamId]/games
2. Check: lastSyncAt < 1 hour ago → Refresh
3. Fetch from Steam API
4. Compare playtime and create sessions (same logic as own dashboard)
5. Save games and update lastSyncAt
6. Return games
```

**Fallback Logic**:
- If Steam API fails, return cached games
- If profile became private, return cached games (last known state)
- If playtime decreased, keep existing baseline

#### Cached Sync Scenario
**Scenario**: Friend's games were synced <1 hour ago.

**Expected Behavior**:
1. ✅ Games should load from cache (fast)
2. ✅ No Steam API calls
3. ✅ Games should appear immediately
4. ✅ Privacy state should be respected (if profile is private, show privacy message)

**API Flow**:
```
1. GET /api/user/[steamId]/games
2. Check: lastSyncAt >= 1 hour ago → Use cache
3. Load games from user_games table
4. Calculate derived_last_played if needed
5. Return games immediately
```

**Fallback Logic**:
- If cache is empty but user exists, trigger refresh
- If privacy state changed, detect and show privacy message
- If `derived_last_played` calculation fails, continue without it

### Privacy Handling
- **Public Profile**: Games and achievements are visible
- **Private Profile**: Steam API returns 401 or empty data
- **Detection**: If Steam API fails with 401, immediately mark user as `is_private = true` in database
- **Privacy Ghosting Fix**: When a profile becomes private, cached sessions are immediately filtered out from the feed
- **Respect Privacy Intent**: Private users' sessions are never shown, even if cached data exists
- **Automatic Privacy Flagging**: Users are marked as private when:
  - Steam API returns 401 (unauthorized)
  - `communityVisibilityState` indicates private (1) or friends-only (2)
  - Player summary cannot be fetched
- **Public Flagging**: Users are marked as public when successfully synced (even if no games found)

---

## Common Concepts

### Sync Timing Thresholds

| Threshold | Duration | Purpose |
|-----------|---------|---------|
| **Stale Friend** | 2 hours | Friends with `lastSyncAt` >2 hours ago always sync (bypass cooldown) |
| **Very Stale Friend** | 14 days | Friends with `lastSyncAt` >14 days ago should sync |
| **Fresh Friend** | <2 hours | Friends with `lastSyncAt` <2 hours ago respect 15-minute cooldown |
| **Feed Sync Cooldown** | 15 minutes | Prevents refreshing same friend multiple times in short period |
| **Dashboard Cache** | 1 hour | Games are cached for 1 hour before refreshing |
| **Session Cooldown** | 30 minutes | Sessions only appear 30 minutes after they end |
| **Lookback Window** | 14 days | Only sessions within 14 days appear in feed |

### Session Creation Thresholds

| Threshold | Value | Purpose |
|-----------|-------|---------|
| **Minimum Playtime Delta** | 3 minutes | Only create sessions for meaningful playtime increases |
| **Minimum playtime_2weeks** | 3 minutes | Only create sessions when recent playtime is significant |
| **Maximum Session Duration** | 4 hours | Cap session duration to prevent unrealistic sessions |

### Fallback Logic Summary

#### Steam API Failures
- **GetRecentlyPlayedGames fails**: Use `GetOwnedGames` only
- **GetOwnedGames fails**: Return cached data if available
- **401 Unauthorized**: Profile is private, return empty data or cached data
- **Rate limiting**: Respect rate limits, use cached data

#### Missing Data
- **`rtime_last_played` missing**: Use `lastPlayed` from full library
- **`lastPlayed` missing**: Calculate `derived_last_played` from achievement unlock times
- **Achievements not cached**: Game appears without `lastPlayed` (calculated on next sync)
- **User record missing**: Create user record during sync (`ensureUserExists`)

#### Database Failures
- **User not in DB**: Create user record before syncing games
- **Games not in DB**: Trigger full sync from Steam API
- **Sessions not in DB**: Query returns empty, sync will create them
- **Foreign key constraint**: Removed for `game_sessions.user_id` to allow sessions for non-users

### Key Architectural Decisions

1. **Sync-on-Read Pattern**: Friends are synced when the feed is loaded, not on a schedule
2. **Sync Before Query**: Feed syncs friends BEFORE querying sessions to ensure data is available
3. **Staleness Over Cooldown**: Stale friends (>2 hours) always sync, bypassing 15-minute cooldown
4. **30-Minute Session Cooldown**: Sessions only appear 30 minutes after completion to allow grouping
5. **No Foreign Key for Sessions**: `game_sessions.user_id` has no FK constraint to allow sessions for friends not in DB
6. **playtime_2weeks Logic**: When `delta=0` but `playtime_2weeks` increased, verify `lastPlayed` is recent (<2 hours) before using current time to avoid phantom sessions
7. **First Sync Limiting**: Only sync first 20 friends on initial load to prevent API overload
8. **Privacy Ghosting Prevention**: Private users' sessions are immediately filtered from feed when 401 detected, respecting user privacy intent
9. **Circuit Breaker Pattern**: After 5 consecutive 5xx errors, circuit opens and all API calls are blocked for 5 minutes to protect API key and server resources

### Error Handling

All sync operations should:
- Continue processing other friends/games if one fails
- Log errors but don't throw (graceful degradation)
- Return cached data if available when API fails
- Create user records automatically when needed
- Handle private profiles gracefully (return empty or cached data)

---

## Quick Reference

### When Does Sync Happen?

**Feed**:
- ✅ Stale friends (>2 hours) → Always sync
- ✅ Friends not in DB → Always sync (first 20)
- ✅ Friends with recent playtime → Sync if stale or not in DB
- ❌ Fresh friends (<2 hours) → Skip if within 15-minute cooldown

**Dashboard (Own)**:
- ✅ No games in DB → Always sync
- ✅ `lastSyncAt` >1 hour ago → Always sync
- ❌ `lastSyncAt` <1 hour ago → Use cache

**Dashboard (Friend)**:
- ✅ No games in DB → Always sync
- ✅ `lastSyncAt` >1 hour ago → Always sync
- ❌ `lastSyncAt` <1 hour ago → Use cache

### When Do Sessions Appear?

- ✅ Session `sessionEnd` <= (now - 30 minutes) → Appears in feed
- ❌ Session `sessionEnd` > (now - 30 minutes) → Hidden (too recent)

### When Are Sessions Created?

**Playtime Sessions**:
- ✅ `playtimeDelta >= 3 minutes` → Create session
- ✅ `delta=0` AND `playtime_2weeks >= 3 minutes` AND no existing session → Create session
- ✅ `delta=0` AND `playtime_2weeks` increased since existing session → Create new session (use current time)

**Achievement Sessions**:
- ✅ New achievements unlocked → Create session
- ✅ Grouped within 30-minute windows
- ✅ Merged with playtime sessions if overlapping

---

## Testing Scenarios

### Scenario 1: New User First Feed Load
1. User signs up
2. User has 10 friends, none in DB
3. **Expected**: First 10 friends synced, feed populated with their sessions

### Scenario 2: Stale Friend Activity
1. Friend last synced 3 hours ago
2. Friend played a game 1 hour ago
3. **Expected**: Friend synced, new session appears in feed (after 30-min cooldown)

### Scenario 3: Fresh Friend Within Cooldown
1. Friend synced 10 minutes ago
2. Friend played a game 5 minutes ago
3. **Expected**: Friend NOT synced (within 15-min cooldown), feed shows old sessions

### Scenario 4: Dashboard Refresh
1. User's games cached 2 hours ago
2. User opens dashboard
3. **Expected**: Games refreshed from Steam API, new sessions created

### Scenario 5: Friend Dashboard Private Profile
1. Friend's profile is private
2. Friend's games were cached when profile was public
3. **Expected**: Shows cached games with privacy message, no API calls

### Scenario 6: playtime_2weeks Increased
1. Game has `delta=0` (playtime unchanged)
2. `playtime_2weeks` increased from 20min to 37min
3. **Expected**: 
   - If `lastPlayed` is recent (<2 hours): New session created with current time as `sessionEnd`
   - If `lastPlayed` is stale: New session created with `lastPlayed` as `sessionEnd` (avoids phantom sessions)

---

## Notes

- All timestamps are in UTC
- Session durations are capped at 4 hours to prevent unrealistic sessions
- First sync is limited to 20 friends to prevent API overload
- Feed sync has a 5-second timeout to prevent long waits
- Background syncs continue even if timeout exceeded
- Sessions can exist without corresponding user records (FK constraint removed)
- **Privacy**: Users marked as `is_private = true` have their sessions filtered from feed immediately
- **Circuit Breaker**: Trips after 5 consecutive 5xx errors, blocks all API calls for 5 minutes, then auto-closes
- **playtime_2weeks**: Rolling window can increase even without new playtime - we verify `lastPlayed` is recent before using current time
