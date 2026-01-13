# Feed Architecture Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Session Types](#session-types)
3. [Session Creation Logic](#session-creation-logic)
4. [Feed Query Logic](#feed-query-logic)
5. [Caching Strategy](#caching-strategy)
6. [Sync-on-Read Pattern](#sync-on-read-pattern)
7. [API Calls and Database Queries](#api-calls-and-database-queries)
8. [Edge Cases and Fixes](#edge-cases-and-fixes)

---

## Architecture Overview

The feed system uses a **ledger-based approach** where all activity (both achievements and playtime) is recorded as immutable sessions in the `game_sessions` table. The feed API queries these sessions and transforms them into `FeedSession` objects for display.

### Key Components

- **`game_sessions` table**: Single source of truth for all gaming activity
- **`/api/feed`**: Main feed endpoint that queries and transforms sessions
- **`lib/utils/feed-sessions.ts`**: Session grouping and transformation logic
- **`lib/utils/achievement-sessions.ts`**: Achievement session detection and writing
- **`lib/utils/friend-sync.ts`**: Friend playtime sync logic
- **`app/api/games/route.ts`**: User's own game sync (creates playtime sessions)

### Data Flow

```
Steam API → Sync Logic → game_sessions table → Feed API → FeedSession → Frontend
```

---

## Session Types

### Achievement Sessions

**Type**: `'achievement'`  
**Created when**: New achievements are unlocked during sync  
**Source**: Achievement unlock timestamps from Steam API

**Key Characteristics:**
- Session boundaries: Achievements within 4 hours are grouped together
- Session start: First achievement unlock time
- Session end: Last achievement unlock time
- Duration: Can use playtime delta if available, otherwise calculated from unlock times
- Precedence: Achievement sessions take precedence over playtime sessions (overlapping playtime sessions are deleted)

**Code Reference:**
```155:237:lib/utils/feed-sessions.ts
function createSessionFromAchievements(
  achievements: AchievementRow[],
  playtimeDeltaMinutes?: number
): FeedSession {
  // ... session creation logic ...
}
```

### Playtime Sessions

**Type**: `'playtime'`  
**Created when**: Playtime increases by ≥5 minutes between syncs  
**Source**: Playtime delta calculation (`currentPlaytime - previousPlaytime`)

**Key Characteristics:**
- Minimum delta: 5 minutes (smaller changes don't create sessions)
- Session start: Calculated by subtracting playtime delta from session end
- Session end: Uses `lastPlayed` timestamp if available, otherwise calculated from sync time
- Duration: Capped at 4 hours (240 minutes) to match achievement session logic
- Merging: Sessions within 30 minutes are merged together

**Code Reference:**
```382:442:lib/utils/feed-sessions.ts
export function createSessionFromPlaytime(
  userId: string,
  appId: number,
  playtimeDeltaMinutes: number,
  sessionEnd: Date,
  // ... parameters ...
): FeedSession {
  // ... session creation logic ...
}
```

---

## Session Creation Logic

### Achievement Session Creation

**Trigger**: Achievement sync detects new unlocks

**Process:**
1. Compare old vs new achievement lists to detect new unlocks
2. Group new unlocks into sessions (4-hour time window)
3. Delete overlapping playtime sessions
4. Check for recent achievement session (within 30 minutes) for merging
5. Write to `game_sessions` table

**Code Reference:**
```91:120:lib/utils/achievement-sessions.ts
export function detectNewAchievementSessions(
  oldAchievements: UserAchievement[],
  newAchievements: UserAchievement[],
  userId: string,
  appId: number
): AchievementSessionData[] {
  // ... detection logic ...
}
```

```184:250:lib/utils/achievement-sessions.ts
export async function writeAchievementSessions(
  userId: string,
  appId: number,
  sessions: AchievementSessionData[]
): Promise<void> {
  // ... writing logic with overlap handling ...
}
```

### Playtime Session Creation

**Trigger**: Playtime sync detects playtime increase ≥5 minutes

**Process:**
1. Calculate playtime delta: `currentPlaytime - previousPlaytime`
2. Determine `lastPlayed` timestamp:
   - Use Steam's `rtime_last_played` if available
   - Fall back to existing `lastPlayed` from database
   - If missing, calculate from sync time (see Edge Cases)
3. Calculate session timestamps:
   - If `lastPlayed` exists: `sessionEnd = lastPlayed`, `sessionStart = lastPlayed`
   - If `lastPlayed` missing: `sessionEnd = syncTime - playtimeDelta`, `sessionStart = sessionEnd - playtimeDelta`
4. Check for existing session with same `(userId, appId, sessionStart)` rounded to nearest second
5. If exists: Merge (add delta, update end time if newer)
6. If not exists: Check for recent session within 30 minutes
7. If recent: Merge with proximity check
8. If not recent: Create new session
9. Update baseline: `previousPlaytimeMinutes = currentPlaytimeMinutes`

**Code Reference:**
```371:491:lib/utils/friend-sync.ts
if (playtimeDelta >= 5) {
  // ... session creation logic with timestamp calculation ...
}
```

**First Sync Handling:**
```257:340:lib/utils/friend-sync.ts
if (!existingGame) {
  // First sync logic - only create sessions for recently played games
  // ... handles edge case where friend just signed up ...
}
```

---

## Feed Query Logic

### Main Feed Endpoint: `/api/feed`

**Flow:**
1. Authenticate user and get friend list
2. Query `game_sessions` table for all sessions (achievement + playtime)
3. Filter by cooldown (5 minutes) and lookback (14 days)
4. Process achievement sessions:
   - Fetch achievement details from `user_achievements` table
   - Group into FeedSessions using `groupAchievementsIntoSessions()`
5. Process playtime sessions:
   - Deduplicate by `(userId, appId, sessionStart)`
   - Check for overlapping achievement sessions (skip if overlap)
   - Convert to FeedSessions using `createSessionFromPlaytime()`
6. Merge and deduplicate final sessions
7. Sort by `sessionEnd` descending (newest first)
8. Fetch achievement counts and like data
9. Apply pagination
10. Trigger sync-on-read for stale friends and user

**Code Reference:**
```28:692:app/api/feed/route.ts
export async function GET(request: NextRequest) {
  // ... full feed query logic ...
}
```

### Session Deduplication

**Achievement Sessions:**
- No deduplication needed (each GameSession represents a unique achievement unlock group)

**Playtime Sessions:**
- Deduplicate by `(userId, appId, sessionStart)` rounded to nearest second
- If duplicates found, keep the one with larger `playtimeDelta`

**Code Reference:**
```273:300:app/api/feed/route.ts
// Deduplicate GameSession records by (userId, appId, sessionStart)
const gameSessionMap = new Map<string, typeof playtimeSessionsFromDB[0]>();
// ... deduplication logic ...
```

### Overlap Detection

Playtime sessions are skipped if they overlap with achievement sessions (within 30 minutes):

**Code Reference:**
```339:364:app/api/feed/route.ts
// Check if there's an achievement session that overlaps with this time window
const hasOverlappingAchievementSession = sessions.some(session => {
  // ... overlap detection logic ...
});
```

---

## Caching Strategy

### User Data Caching

**Cache Duration**: 1 hour  
**Cache Key**: `users.last_sync_at`

**Refresh Triggers:**
- No cached data exists
- `lastSyncAt` is null or older than 1 hour
- `?refresh=true` query parameter

**Code Reference:**
```24:34:app/api/games/route.ts
// Check if we should refresh: no games, no user, or cache is stale (older than 1 hour)
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
const shouldRefresh = games.length === 0 || 
  !user?.lastSyncAt || 
  user.lastSyncAt < oneHourAgo ||
  refreshParam === 'true';
```

### Friend Data Caching

**Cache Duration**: 2 hours (for general staleness), 14 days (for sync-on-read)  
**Cache Key**: `users.last_sync_at`

**Refresh Triggers:**
- Friend has recent playtime in `user_games` (within 14 days)
- Friend has never been synced (`lastSyncAt` is null)
- Friend's last sync is older than 14 days
- Friend has no games in `user_games` (first-time sync needed)

**Code Reference:**
```434:530:app/api/feed/route.ts
// FIX 2: Sync-on-Read: Sync stale friends who have recently played games
// ... friend staleness detection logic ...
```

### Achievement Caching

**Cache Duration**: 1 hour per game  
**Cache Key**: `achievements.last_synced_at` (per user + game)

**Refresh Triggers:**
- No cached achievements exist
- Cache is older than 1 hour
- Game was played recently (within 14 days) - otherwise returns cached data only
- `?refresh=true` query parameter

**Code Reference:**
```18:28:lib/utils/friend-sync.ts
// Check if we have cached achievements that are fresh (less than 1 hour old)
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
const lastSyncedAt = await dataAccess.getAchievementLastSyncedAt(friendId, appId);

// Skip if we have fresh cached achievements
if (oldAchievements.length > 0 && lastSyncedAt && lastSyncedAt > oneHourAgo) {
  return true;
}
```

### Feed Response Caching

**Cache Duration**: None (no-store)  
**Reason**: Users expect immediate updates when new sessions are created

**Code Reference:**
```680:686:app/api/feed/route.ts
headers: {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
}
```

---

## Sync-on-Read Pattern

### Overview

Instead of proactively syncing all friends, the system syncs friends **on-demand** when their data is needed for the feed. This optimizes API usage while keeping data fresh.

### Feed Sync-on-Read

**Trigger**: Feed API request  
**Targets**: Friends with recent playtime or stale data

**Logic:**
1. Query `user_games` to find friends with `last_played` or `derived_last_played` within 14 days
2. Query `users` to find friends who:
   - Have never been synced (`lastSyncAt` is null)
   - Last synced >14 days ago
   - Have no games in `user_games`
3. Filter to only stale friends (last synced >2 hours ago)
4. Trigger background sync (fire-and-forget) with concurrency limit of 5

**Code Reference:**
```434:530:app/api/feed/route.ts
// FIX 2: Sync-on-Read: Sync stale friends who have recently played games
const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
// ... friend detection and sync logic ...
```

### Profile View Sync-on-Read

**Trigger**: Viewing a friend's profile (`/api/user/[steamId]`)  
**Target**: The specific friend being viewed

**Logic:**
1. Check if friend's `lastSyncAt` is older than 1 hour
2. If stale, trigger background `syncFriendPlaytime()` (fire-and-forget)

**Code Reference:**
```69:91:app/api/user/[steamId]/route.ts
const isStale = !user.lastSyncAt || user.lastSyncAt < oneHourAgo;

if (isStale) {
  // Trigger background playtime sync (fire-and-forget)
  const syncPromise = syncFriendPlaytime(targetSteamId);
  // ... fire-and-forget logic ...
}
```

### User's Own Data Sync-on-Read

**Trigger**: Feed API request when user's own data is stale  
**Target**: Logged-in user

**Logic:**
1. Check if user's `lastSyncAt` is older than 1 hour
2. If stale, trigger background sync:
   - Sync games (creates playtime sessions)
   - Sync achievements for recently played games (creates achievement sessions)

**Code Reference:**
```590:663:app/api/feed/route.ts
// Sync-on-Read: Sync logged-in user's own data if stale
const isUserStale = !user?.lastSyncAt || user.lastSyncAt < oneHourAgo;

if (isUserStale) {
  // Trigger background sync of user's games and achievements
  // ... sync logic ...
}
```

---

## API Calls and Database Queries

### Steam API Calls

#### Friend Sync (`syncFriendPlaytime`)

**Calls:**
1. `getRecentlyPlayedGames(friendId)` - Primary source for recently played games
2. `getOwnedGames(friendId, true)` - Fallback if GetRecentlyPlayedGames fails or returns empty
3. `getPlayerAchievements(friendId, appId)` - For achievement sync (only for games with playtime increases)

**Frequency**: On-demand (sync-on-read), max 5 concurrent

**Code Reference:**
```184:530:lib/utils/friend-sync.ts
export async function syncFriendPlaytime(friendId: string): Promise<void> {
  // ... Steam API calls ...
}
```

#### User's Own Games Sync (`/api/games`)

**Calls:**
1. `getOwnedGames(steamId, true)` - Full game library
2. `getRecentlyPlayedGames(steamId)` - Recently played games (for better `lastPlayed` data)

**Frequency**: When cache is stale (1 hour) or `?refresh=true`

**Code Reference:**
```40:47:app/api/games/route.ts
const [fullLibraryResponse, recentlyPlayedResponse] = await Promise.all([
  steamClient.getOwnedGames(steamId, true),
  steamClient.getRecentlyPlayedGames(steamId).catch((error) => {
    // ... error handling ...
  }),
]);
```

#### Achievement Sync (`/api/achievements`)

**Calls:**
1. `getPlayerAchievements(steamId, appId)` - User's achievements for a game
2. `getGameSchema(appId)` - Achievement definitions
3. `getGlobalAchievementPercentages(appId)` - Rarity data
4. `getPlayerAchievementsXML(steamId, appId)` - Additional achievement descriptions

**Frequency**: 
- Only for games played within 14 days (unless `?refresh=true`)
- When cache is stale (1 hour per game)

**Code Reference:**
```31:36:lib/utils/friend-sync.ts
const [playerAchievementsResponse, gameSchemaResponse, globalPercentages, xmlAchievements] = await Promise.all([
  steamClient.getPlayerAchievements(friendId, appId).catch(() => null),
  steamClient.getGameSchema(appId).catch(() => null),
  steamClient.getGlobalAchievementPercentages(appId).catch(() => new Map<string, number>()),
  steamClient.getPlayerAchievementsXML(friendId, appId).catch(() => new Map()),
]);
```

### Database Queries

#### Feed Query (`/api/feed`)

**Queries:**
1. `getGameSessions(userIds, 1000, 0, 14)` - Fetch all sessions for users (14 day lookback)
2. `SELECT * FROM users WHERE steam_id IN (...)` - Batch fetch user data
3. `SELECT * FROM user_games WHERE user_id IN (...) AND app_id IN (...)` - Batch fetch game data
4. `SELECT * FROM achievements WHERE app_id IN (...)` - Batch fetch achievement metadata
5. `SELECT * FROM user_achievements WHERE user_id = ? AND app_id = ? AND unlocked_at BETWEEN ? AND ?` - Fetch achievements for each session
6. `SELECT * FROM user_games WHERE user_id IN (...) AND (last_played > ? OR derived_last_played > ?)` - Find friends with recent playtime
7. `SELECT * FROM users WHERE steam_id IN (...)` - Check friend staleness
8. `getUserAchievements(userId, appId)` - Fetch achievement counts (per unique game)
9. `getLikeCounts(sessionIds)` - Batch fetch like counts
10. `getUserLikes(sessionIds, userId)` - Fetch user's likes

**Code Reference:**
```106:156:app/api/feed/route.ts
// Query achievement sessions from game_sessions (already filtered by lookback in getGameSessions)
const allGameSessions = await dataAccess.getGameSessions(targetUserIds, 1000, 0, MAX_LOOKBACK_DAYS);

// Batch fetch users and games
const [usersData, gamesData, allAchievementsData] = await Promise.all([
  supabase.from("users").select(...).in("steam_id", achievementUserIds),
  supabase.from("user_games").select(...).in("user_id", achievementUserIds).in("app_id", achievementAppIds),
  supabase.from("achievements").select(...).in("app_id", achievementAppIds),
]);
```

#### Session Creation Queries

**Playtime Sessions:**
- `getGameSessionByStartTime(userId, appId, sessionStart)` - Check for existing session
- `getRecentGameSession(userId, appId, 30, 'playtime')` - Check for recent session to merge
- `saveGameSession(session)` - Insert/update session
- `updateGameBaseline(userId, appId, currentPlaytime)` - Update `previous_playtime_minutes`
- `saveUserGames(userId, games)` - Upsert game data

**Achievement Sessions:**
- `getRecentGameSession(userId, appId, 30, 'achievement')` - Check for recent session to merge
- `getGameSessions([userId], 1000, 0, 14)` - Find overlapping playtime sessions
- `deleteGameSession(sessionId)` - Delete overlapping playtime sessions
- `saveGameSession(session)` - Insert/update session

**Code Reference:**
```989:1009:lib/data/supabase-access.ts
async saveGameSession(session: GameSession): Promise<void> {
  const { error } = await this.supabase
    .from('game_sessions')
    .upsert({
      // ... session data ...
    }, {
      onConflict: 'id',
    });
}
```

---

## Edge Cases and Fixes

### Fix 1: First Sync Playtime Sessions

**Problem**: On first sync, `previousPlaytimeMinutes` is `null`, causing entire lifetime playtime to be recorded as a single session.

**Solution**: On first sync, only create sessions for games that are in the "recently played" list (played within 14 days). For other games, just set the baseline without creating sessions.

**Code Reference:**
```257:340:lib/utils/friend-sync.ts
if (!existingGame) {
  // Check if this game is in the recently played list (played within 14 days)
  const isRecentlyPlayed = recentlyPlayedAppIds.has(steamGame.appid);
  
  if (isRecentlyPlayed && game.lastPlayed) {
    // Create session even on first sync for recently played games
    // ... session creation logic ...
  } else {
    // Skip session creation, just update baseline
    // ... baseline update ...
  }
}
```

### Fix 2: Missing `lastPlayed` Timestamp

**Problem**: When `lastPlayed` is missing, sessions were created with `sessionEnd = syncTime`, making them appear to have happened "just now" and causing incorrect sorting in the feed.

**Solution**: When `lastPlayed` is missing, calculate `sessionEnd` by subtracting playtime delta from `syncTime`, so sessions appear in the past rather than at sync time.

**Code Reference:**
```373:393:lib/utils/friend-sync.ts
if (lastPlayed) {
  sessionEnd = lastPlayed;
  calculatedSessionStart = lastPlayed;
} else {
  // Calculate end by subtracting playtime from syncTime (so it's in the past)
  sessionEnd = new Date(syncTime.getTime() - sessionMinutes * 60 * 1000);
  // Calculate start by subtracting playtime from end (to create proper duration)
  calculatedSessionStart = new Date(sessionEnd.getTime() - sessionMinutes * 60 * 1000);
}
```

### Fix 3: Games Not Appearing in "Recently Played"

**Problem**: On first sync, games were synced but not saved to `user_games` table, so they didn't appear in the "Recently played" UI component.

**Solution**: Save the game to `user_games` with `lastPlayed` timestamp before continuing, even on first sync.

**Code Reference:**
```302:340:lib/utils/friend-sync.ts
// FIX: Save the game with lastPlayed so it appears in "Recently played"
const game: Game = {
  appId: steamGame.appid,
  name: steamGame.name || 'Unknown Game',
  // ... all game fields including lastPlayed ...
};

gamesToUpsert.push(game);
```

### Fix 4: Achievement Sync Optimization

**Problem**: Achievement sync was making API calls for all games, even old games that haven't been played recently.

**Solution**: Only sync achievements for games played within 14 days. For older games, return cached data only.

**Code Reference:**
```app/api/achievements/route.ts
// FIX 3: Only sync achievements for games with recent playtime (within 14 days)
const game = await dataAccess.getUserGame(steamId, appIdNum);
if (game) {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const isRecentlyPlayed = (lastPlayed && lastPlayed > fourteenDaysAgo) || 
                           (derivedLastPlayed && derivedLastPlayed > fourteenDaysAgo);
  
  // If game is not recently played and not forcing refresh, return cached data only
  if (!isRecentlyPlayed && !forceRefresh) {
    const userAchievements = await dataAccess.getUserAchievements(steamId, appIdNum);
    return NextResponse.json({ achievements: userAchievements });
  }
}
```

### Fix 5: Feed Sync-on-Read Improvements

**Problem**: Friends with no games in database weren't being synced, and friends with recent playtime weren't being identified.

**Solution**: 
1. Query `user_games` to find friends with recent playtime (within 14 days)
2. Also check friends who have never been synced or have no games in DB
3. Only sync if stale (>2 hours since last sync)

**Code Reference:**
```434:530:app/api/feed/route.ts
// Step 1: Query user_games to find friends with recently played games
const { data: allFriendsGamesData } = await supabase
  .from('user_games')
  .select('user_id, last_played, derived_last_played')
  .in('user_id', friendSteamIds);

// Step 2: Also check friends who haven't been synced recently or have no games in DB
const { data: allFriendsUsers } = await supabase
  .from('users')
  .select('steam_id, last_sync_at')
  .in('steam_id', friendSteamIds);

// Find friends who need syncing:
// 1. Friends with recent playtime in DB
// 2. Friends who haven't been synced recently (>14 days) or never synced
// 3. Friends with no games in DB (first-time sync needed)
```

---

## Key Constants

- **Cooldown Period**: 5 minutes (sessions only appear after completion)
- **Lookback Window**: 14 days (only sessions within 14 days are shown)
- **Session Grouping Window**: 4 hours (achievements within 4 hours are grouped)
- **Session Merge Window**: 30 minutes (sessions within 30 minutes are merged)
- **Minimum Playtime Delta**: 5 minutes (smaller changes don't create sessions)
- **Maximum Session Duration**: 4 hours (240 minutes) - capped for display
- **User Cache Duration**: 1 hour
- **Friend Staleness Threshold**: 2 hours (for sync-on-read)
- **Friend Sync-on-Read Threshold**: 14 days (for identifying friends needing sync)
- **Achievement Cache Duration**: 1 hour per game
- **Concurrency Limit**: 5 friends (for background sync)

---

## Database Schema

### `game_sessions` Table

Primary table storing all gaming activity sessions.

**Columns:**
- `id` (UUID, primary key)
- `user_id` (string, foreign key to `users.steam_id`)
- `app_id` (integer, foreign key to games)
- `playtime_delta` (integer, minutes)
- `session_start` (timestamp)
- `session_end` (timestamp)
- `type` ('playtime' | 'achievement')
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Indexes:**
- `(user_id, app_id, session_start)` - For deduplication
- `(user_id, session_end)` - For feed queries
- `(type, session_end)` - For filtering by type

### `user_games` Table

Cached game data per user.

**Key Columns:**
- `user_id` (string)
- `app_id` (integer)
- `playtime_minutes` (integer)
- `previous_playtime_minutes` (integer) - Baseline for delta calculation
- `last_played` (timestamp) - From Steam API
- `derived_last_played` (timestamp) - Calculated from achievement unlocks
- `playtime_last_synced_at` (timestamp)

### `users` Table

User metadata.

**Key Columns:**
- `steam_id` (string, primary key)
- `last_sync_at` (timestamp) - Used for staleness checks

---

## Session Merging Logic

### Playtime Session Merging

**Conditions:**
1. Exact match: Same `(userId, appId, sessionStart)` rounded to nearest second
2. Proximity match: Sessions within 30 minutes of each other

**Merge Behavior:**
- Add `playtimeDelta` values together
- Keep earlier `sessionStart`
- Update `sessionEnd` only if new end time is actually after existing end time

**Code Reference:**
```364:435:lib/utils/friend-sync.ts
if (existingSession) {
  // Merge with existing session
  const mergedSession: GameSession = {
    // ... merge logic ...
  };
} else {
  // Check for recent session within 30 minutes
  const recentSession = await dataAccess.getRecentGameSession(...);
  if (recentSession) {
    // ... proximity merge logic ...
  }
}
```

### Achievement Session Merging

**Conditions:**
- Recent session exists within 30 minutes

**Merge Behavior:**
- Extend `sessionEnd` to the later one
- Keep earlier `sessionStart`
- Add `playtimeDelta` from deleted overlapping playtime sessions

**Code Reference:**
```208:230:lib/utils/achievement-sessions.ts
if (recentSession) {
  // Merge: extend session_end to the later one, keep earlier session_start
  const mergedSession: GameSession = {
    // ... merge logic ...
  };
}
```

---

## Performance Optimizations

1. **Batch Queries**: User, game, and achievement data fetched in batches
2. **Concurrency Limiting**: Friend sync limited to 5 concurrent operations
3. **14-Day Filtering**: Only sync achievements for recently played games
4. **Cache-First Strategy**: Return cached data when fresh, only sync when stale
5. **Background Sync**: Sync-on-read operations are fire-and-forget (don't block feed response)
6. **Deduplication**: Sessions deduplicated before conversion to FeedSessions
7. **Pagination**: Feed results paginated (default 20 per page)

---

## Error Handling

- **Steam API Failures**: Gracefully fall back to cached data or skip operation
- **Database Errors**: Logged but don't break feed (returns empty/partial results)
- **Background Sync Failures**: Logged but don't affect feed response (fire-and-forget)
- **Missing Data**: Sessions skipped if user/game data is missing (logged as warnings)

---

## Testing Considerations

When reviewing this architecture, consider:

1. **Session Timestamp Accuracy**: Are sessions appearing at correct times?
2. **Sorting Correctness**: Are sessions sorted by actual playtime, not sync time?
3. **Deduplication**: Are duplicate sessions properly merged?
4. **Overlap Handling**: Are playtime sessions correctly skipped when achievement sessions exist?
5. **Cache Freshness**: Is data being refreshed at appropriate intervals?
6. **API Rate Limits**: Are concurrency limits preventing rate limit errors?
7. **First Sync Edge Cases**: Are new users handled correctly?
8. **Missing Data Handling**: Are sessions created correctly when `lastPlayed` is missing?
