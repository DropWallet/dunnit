# Friends Activity Feed - Implementation Guide

## Overview

The Friends Activity Feed is a social timeline that displays gaming sessions from friends, showing when they unlock achievements. Sessions are automatically grouped from achievement unlock data, creating a Strava-like experience for gaming activities.

## Core Concept

### What is a Session?

A **session** is a group of achievements unlocked by the same friend in the same game within a 4-hour time window. Sessions represent discrete gaming activities that can be shared and celebrated.

**Example:**
```
Friend unlocks Achievement A at 2:00 PM
Friend unlocks Achievement B at 3:30 PM (1.5h gap) → Same session
Friend unlocks Achievement C at 8:00 PM (4.5h gap) → NEW SESSION
```

### Session Boundaries

A new session starts when:
- **Different game**: Achievement is for a different `app_id`
- **Time gap**: More than 4 hours since the previous achievement unlock
- **Different user**: Achievement is from a different friend

## Data Flow

### How Sessions Appear in Feed

1. **Friend unlocks achievement** → Steam API records it
2. **Friend's profile loads** → Achievement sync runs (existing `/api/user/[steamId]/achievements/all`)
3. **Achievement saved** → `user_achievements` table updated with `unlocked_at` timestamp
4. **Feed query** → Automatically includes new sessions (no extra work needed)

### Cooldown Period

To avoid showing incomplete sessions, we implement a **30-minute cooldown period**:

- Sessions only appear in the feed **30 minutes after the last achievement** in that session
- This ensures sessions are complete before being displayed
- Prevents partial/in-progress sessions from appearing

**Implementation:**
```typescript
// Session is "complete" if:
sessionEnd + 30 minutes < now()
```

**Why 30 minutes?**
- Most gaming sessions have natural breaks
- Long enough to catch most session endings
- Short enough that feed stays reasonably fresh
- Good balance between completeness and freshness

### Polling Strategy

**Client-side polling** (every 60 seconds):
- Frontend polls `/api/feed?since=<lastFetchedAt>`
- API only returns sessions older than 30 minutes (cooldown)
- New completed sessions appear in feed automatically
- Shows "X new activities" toast when updates arrive

**Manual refresh** button also available for immediate updates.

## Session Data Structure

### FeedSession Interface

```typescript
interface FeedSession {
  // Session identification
  sessionId: string; // Generated: `${userId}-${appId}-${sessionStart.getTime()}`
  
  // User info (from users table)
  user: {
    steamId: string;
    username: string;
    avatarUrl: string;
    profileUrl: string;
  };
  
  // Game info (from user_games table)
  game: {
    appId: number;
    name: string;
    coverImageUrl?: string;
    iconUrl?: string;
  };
  
  // Session timing
  sessionStart: Date;        // First achievement unlocked_at
  sessionEnd: Date;          // Last achievement unlocked_at
  duration: number;          // Milliseconds (sessionEnd - sessionStart)
  durationFormatted: string; // "2h 15m" or "45m" format
  
  // Achievement data
  achievementCount: number;  // Total achievements unlocked in session
  achievements: Array<{
    apiName: string;
    name: string;
    description: string;
    iconUrl: string;
    iconGrayUrl: string;
    unlockedAt: Date;
    globalPercentage?: number;
    rarity: AchievementRarity; // 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary'
    hidden: boolean;
  }>;
  
  // Session metadata
  minRarity: AchievementRarity; // Rarest achievement in session
  minRarityPercentage?: number;  // Lowest global_percentage
  
  // Narrative labels (simple for Stage 1)
  narrative?: {
    type: 'multiple-unlocks' | 'rare-achievement' | 'first-time' | 'standard';
    label: string; // e.g., "Unlocked 5 achievements" or "Rare achievement unlocked"
  };
  
  // Display helpers
  relativeTime: string;      // "2 hours ago", "Yesterday", "3 days ago"
  timestamp: string;          // ISO string for sorting
}
```

### Data Sources

| Data Field | Source Table | Notes |
|------------|--------------|-------|
| `user.*` | `users` | Join on `user_id = steam_id` |
| `game.*` | `user_games` | Join on `user_id` + `app_id` |
| `achievements[].*` | `achievements` + `user_achievements` | Join on `app_id` + `achievement_api_name` |
| `unlocked_at` | `user_achievements.unlocked_at` | Used for grouping and sorting |
| `global_percentage` | `achievements.global_percentage` | Used for rarity calculation |

## API Specification

### GET /api/feed

**Query Parameters:**
- `since` (optional): ISO timestamp - only return sessions where `sessionEnd >= since`
- `limit` (optional): Number of sessions to return (default: 20)
- `offset` (optional): Pagination offset (default: 0)
- `gameId` (optional): Filter by game `app_id`
- `friendId` (optional): Filter by friend `steam_id`

**Response:**
```typescript
{
  sessions: FeedSession[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  meta: {
    fetchedAt: string; // ISO timestamp
    friendCount: number; // Number of friends included
    cooldownMinutes: 30; // Cooldown period for UI display
  };
}
```

**Behavior:**
- Only returns sessions where `sessionEnd` is at least 30 minutes ago (cooldown)
- Only includes achievements from friends (not friends of friends)
- Maximum lookback: 7 days
- Sessions sorted by `sessionEnd` descending (newest first)

## Session Grouping Algorithm

### TypeScript Implementation

```typescript
function groupAchievementsIntoSessions(
  achievements: AchievementRow[]
): FeedSession[] {
  // 1. Sort by unlocked_at (oldest first)
  const sorted = achievements.sort((a, b) => 
    a.unlocked_at.getTime() - b.unlocked_at.getTime()
  );
  
  // 2. Group into sessions
  const sessions: FeedSession[] = [];
  let currentSession: AchievementRow[] = [];
  
  for (const achievement of sorted) {
    if (currentSession.length === 0) {
      // Start new session
      currentSession = [achievement];
    } else {
      const lastAchievement = currentSession[currentSession.length - 1];
      const timeGap = achievement.unlocked_at.getTime() - 
                      lastAchievement.unlocked_at.getTime();
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      
      // Same user + same game + within 4 hours = same session
      if (
        achievement.user_id === lastAchievement.user_id &&
        achievement.app_id === lastAchievement.app_id &&
        timeGap <= FOUR_HOURS_MS
      ) {
        currentSession.push(achievement);
      } else {
        // End current session, start new one
        sessions.push(createSessionFromAchievements(currentSession));
        currentSession = [achievement];
      }
    }
  }
  
  // Don't forget the last session
  if (currentSession.length > 0) {
    sessions.push(createSessionFromAchievements(currentSession));
  }
  
  return sessions;
}
```

## Database Query

### SQL Query Structure

```sql
SELECT 
  ua.user_id,
  ua.app_id,
  ua.achievement_api_name,
  ua.unlocked_at,
  u.username,
  u.avatar_url,
  u.profile_url,
  g.name as game_name,
  g.cover_image_url,
  g.icon_url,
  a.name as achievement_name,
  a.description,
  a.icon_url as achievement_icon_url,
  a.icon_gray_url,
  a.global_percentage,
  a.hidden
FROM user_achievements ua
JOIN users u ON ua.user_id = u.steam_id
JOIN user_games g ON ua.user_id = g.user_id AND ua.app_id = g.app_id
JOIN achievements a ON ua.app_id = a.app_id AND ua.achievement_api_name = a.api_name
WHERE 
  ua.unlocked = true
  AND ua.unlocked_at IS NOT NULL
  AND ua.unlocked_at >= NOW() - INTERVAL '7 days'
  AND ua.unlocked_at <= NOW() - INTERVAL '30 minutes'  -- Cooldown filter
  AND ua.user_id = ANY($1)  -- Friend list array
  AND ($2::timestamptz IS NULL OR ua.unlocked_at >= $2)  -- since parameter
ORDER BY ua.unlocked_at ASC
```

### Required Index

```sql
-- Index for efficient feed queries
CREATE INDEX IF NOT EXISTS idx_user_achievements_feed 
ON user_achievements(user_id, unlocked_at DESC) 
WHERE unlocked = true AND unlocked_at IS NOT NULL;
```

## Edge Cases

### 1. Very Long Sessions (>4 hours)
- The 4-hour gap rule already splits these into separate sessions
- Cooldown applies to each segment independently
- Each segment appears 30 minutes after its last achievement

### 2. Friend Unlocks Achievement, Then Immediately Stops
- Session appears 30 minutes later
- Acceptable delay for completeness guarantee

### 3. Multiple Achievements in Quick Succession
- All grouped into one session
- Session appears 30 minutes after the last one
- Single feed entry, not multiple

### 4. Friend's Profile is Private
- No achievements synced = no sessions shown
- Expected behavior

### 5. Friend Hasn't Loaded Profile Recently
- Feed only shows what's synced
- Expected behavior (achievements sync when profile loads)

## Future Enhancements

### Stage 2: Live Sessions (Optional)
- Show in-progress sessions with "Live" badge
- Update in real-time as achievements unlock
- Requires WebSocket or SSE

### Stage 3: Advanced Narratives
- "The 1% Club" (minRarity < 2%)
- "Bountiful Harvest" (achievementCount > 8)
- "The Prodigy" (minRarity < 5% AND totalPlaytime < 2h)
- "Dust Breaker" (days since last game unlock > 180)
- "Relentless" (sessionDuration > 5h AND achievementCount < 3)

### Stage 4: Social Interactions
- Kudos/likes on sessions
- Comments on sessions
- Share sessions

## Performance Considerations

- **Query optimization**: Use indexes, limit result sets
- **Caching**: Consider caching friend lists (already implemented)
- **Pagination**: Limit to 20 sessions per page
- **Polling frequency**: 60 seconds is reasonable (not too aggressive)

## Privacy & Scope

- **Feed scope**: Only friends (not friends of friends)
- **Data visibility**: Only shows achievements that have been synced
- **Private profiles**: No sessions shown (expected behavior)
- **User control**: Future enhancement - allow users to opt-out of feed
