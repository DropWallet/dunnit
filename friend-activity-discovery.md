# Friend Activity Discovery - Implementation Plan

## Problem Statement

We miss friend gaming activity because our current approach only detects "recently active" friends from data **already stored in our database**. We never proactively ask Steam "who played recently?"

### Current Flow
1. Feed loads
2. Query DB for friends with `last_played` within last 14 days
3. Sync those friends + never synced + no games + >14 days stale
4. **Gap:** If Friend A played 4 days ago but we last synced them 10 days ago, we won't know until day 14

### Real-World Impact
- User sees feed missing friend activity from the past week
- Friends appear "inactive" even though they've been playing
- Activity shows up suddenly 14 days later (when stale threshold triggers re-sync)

---

## Solution: Activity Discovery via GetRecentlyPlayedGames

### Concept
Add a lightweight "probe" step that asks Steam which friends have been recently active, then prioritize syncing those friends.

### Why GetRecentlyPlayedGames?
- **Lightweight:** Single API call, returns only games played in last 2 weeks
- **Already exists:** `steamClient.getRecentlyPlayedGames(steamId)` in our codebase
- **Includes timestamps:** Returns `rtime_last_played` for each game
- **Much cheaper than full sync:** Probe = 1 API call, Full sync = 3+ API calls + DB writes

---

## Technical Design

### 1. Database Schema Change

Add tracking field to `users` table:

```sql
-- Migration: Add last_activity_probe_at to users
ALTER TABLE users ADD COLUMN last_activity_probe_at TIMESTAMPTZ;

-- Index for efficient "oldest probe" queries
CREATE INDEX idx_users_last_activity_probe ON users(last_activity_probe_at NULLS FIRST);
```

**Purpose:** Track when we last checked each friend for activity. `NULL` = never probed.

### 2. Data Access Methods

Add to `lib/data/supabase-access.ts`:

```typescript
/**
 * Get friends who need activity probing
 * Prioritizes: never probed, then oldest probe time (round-robin)
 */
async getFriendsNeedingProbe(
  friendIds: string[],
  limit: number,
  probeIntervalDays: number = 7
): Promise<string[]> {
  const cutoff = new Date(Date.now() - probeIntervalDays * 24 * 60 * 60 * 1000);

  const { data, error } = await this.supabase
    .from('users')
    .select('steam_id')
    .in('steam_id', friendIds)
    .or(`last_activity_probe_at.is.null,last_activity_probe_at.lt.${cutoff.toISOString()}`)
    .order('last_activity_probe_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !data) return [];
  return data.map(u => u.steam_id);
}

/**
 * Update probe timestamp for a user
 */
async updateUserProbeTime(steamId: string, probeTime: Date): Promise<void> {
  await this.supabase
    .from('users')
    .update({ last_activity_probe_at: probeTime.toISOString() })
    .eq('steam_id', steamId);
}
```

### 3. Discovery Function

Add to `lib/steam/friend-sync.ts`:

```typescript
import { SteamClient } from '@/lib/steam/client';
import { DataAccess } from '@/lib/data/access';

/**
 * Discover which friends have recent gaming activity by probing Steam API
 *
 * @param friendIds - All friend Steam IDs to potentially probe
 * @param limit - Max friends to probe this call (default: 10)
 * @param steamClient - Steam API client
 * @param dataAccess - Database access layer
 * @returns Array of friend IDs that have confirmed recent activity
 */
export async function discoverFriendsWithRecentActivity(
  friendIds: string[],
  limit: number,
  steamClient: SteamClient,
  dataAccess: DataAccess
): Promise<string[]> {
  // Get friends who haven't been probed recently (7-day interval)
  const friendsToProbe = await dataAccess.getFriendsNeedingProbe(friendIds, limit);

  if (friendsToProbe.length === 0) {
    return [];
  }

  console.log(`[Discovery] Probing ${friendsToProbe.length} friends for recent activity`);

  const discoveredActive: string[] = [];
  const probeTime = new Date();

  // Probe in parallel (circuit breaker handles rate limits)
  const results = await Promise.allSettled(
    friendsToProbe.map(async (friendId) => {
      try {
        const recentGames = await steamClient.getRecentlyPlayedGames(friendId);

        // Always update probe timestamp (even if no games returned)
        await dataAccess.updateUserProbeTime(friendId, probeTime);

        // If they have any games played in last 2 weeks, they're active
        if (recentGames && recentGames.length > 0) {
          console.log(`[Discovery] Found active friend: ${friendId} (${recentGames.length} games)`);
          return { friendId, active: true };
        }

        return { friendId, active: false };
      } catch (error: any) {
        // 401/403 = private profile, still update probe time to avoid re-probing
        console.log(`[Discovery] Probe failed for ${friendId}: ${error.message || 'Unknown error'}`);
        await dataAccess.updateUserProbeTime(friendId, probeTime);
        return { friendId, active: false };
      }
    })
  );

  // Collect active friends from successful probes
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.active) {
      discoveredActive.push(result.value.friendId);
    }
  }

  console.log(`[Discovery] Discovered ${discoveredActive.length} active friends from ${friendsToProbe.length} probes`);

  return discoveredActive;
}
```

### 4. Integration into Feed Sync

Modify `syncFriendsForFeed()` in `app/api/feed/route.ts`:

```typescript
// EXISTING: Get friends with recent playtime from DB
const friendsWithRecentPlaytime = await getFriendsWithRecentPlaytime(friendSteamIds, dataAccess);

// NEW: Discover additional active friends by probing Steam
// Run in parallel with existing DB queries for efficiency
const discoveredActivePromise = discoverFriendsWithRecentActivity(
  friendSteamIds,
  10, // probe up to 10 friends per feed load
  steamClient,
  dataAccess
);

// ... existing DB queries ...

// Get discovered friends (wait for probe to complete)
const discoveredActive = await discoveredActivePromise;

// MODIFIED: Combine all sources when building sync set
const friendsNeedingSync = new Set([
  ...friendsWithRecentPlaytime,    // From DB (already knew they were active)
  ...discoveredActive,              // NEW: From Steam probe (just discovered)
  ...friendsNeverSynced,            // Never in DB
  ...friendsWithNoGames,            // In DB but no games
  ...friendsStale14Days,            // Last sync > 14 days ago
]);
```

---

## Configuration Constants

```typescript
// How often to probe each friend (days)
const PROBE_INTERVAL_DAYS = 7;

// Max friends to probe per feed load
const PROBES_PER_LOAD = 10;

// At 10 loads/day, this gives us:
// - 100 probes/day
// - 700 probes/week
// - Full cycle through 700 friends every 7 days
```

---

## Performance Impact

### API Calls
| Scenario | Before | After |
|----------|--------|-------|
| Feed load (probing) | 0 calls | +10 calls |
| Call type | - | GetRecentlyPlayedGames (lightweight) |

### Latency (if blocking)
- 10 parallel probes × ~100ms each = ~100-200ms added
- **Recommendation:** Run discovery in parallel with existing queries

### Latency (if non-blocking)
- 0ms added to response time
- Discovered friends synced on next feed load

---

## Probe Cadence Analysis

| Friends Count | Probes/Load | Loads/Day | Days to Full Cycle |
|---------------|-------------|-----------|-------------------|
| 100 | 10 | 10 | 1 day |
| 300 | 10 | 10 | 3 days |
| 500 | 10 | 10 | 5 days |
| 700 | 10 | 10 | 7 days |

**With 7-day probe interval:** Each friend is probed at most once per week, ensuring we catch activity within 1 week of it happening.

---

## Edge Cases

### Private Profiles
- `GetRecentlyPlayedGames` returns empty or 401/403
- Update `last_activity_probe_at` anyway (don't keep retrying)
- Will re-probe in 7 days (profile might become public)

### Friends Not in DB Yet
- Discovery only probes friends who exist in `users` table
- Brand new friends go through "never synced" path first
- After first sync, they become eligible for probing

### Rate Limiting
- Circuit breaker already handles Steam API issues
- 10 probes/load is well under Steam rate limits
- If circuit trips, probes fail gracefully (try again later)

### First-Time User
- No friends in DB yet
- Discovery returns empty (nothing to probe)
- Normal "friends not in DB" sync handles initial population

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/XXX_add_activity_probe.sql` | Add `last_activity_probe_at` column |
| `lib/data/supabase-access.ts` | Add `getFriendsNeedingProbe()`, `updateUserProbeTime()` |
| `lib/steam/friend-sync.ts` | Add `discoverFriendsWithRecentActivity()` |
| `app/api/feed/route.ts` | Integrate discovery into `syncFriendsForFeed()` |

---

## Verification Steps

### Manual Testing
1. Identify a friend who played recently but isn't showing in feed
2. Check their `last_activity_probe_at` (should be NULL or old)
3. Load feed 1-2 times
4. Check logs for `[Discovery] Found active friend: {steamId}`
5. Verify their sessions appear in feed after sync

### Automated Checks
1. **Probe rotation:** Load feed 100 times, verify all friends get probed
2. **Probe interval:** Verify same friend isn't probed twice in 7 days
3. **Active detection:** Probe friend with known recent activity, verify returned in discovered set
4. **Private handling:** Probe private profile, verify `last_activity_probe_at` still updated

### Performance Monitoring
1. Measure feed API response time before/after
2. Track Steam API call count per feed load
3. Monitor circuit breaker trips related to probing

---

## Rollout Plan

### Phase 1: Database Migration
- Add `last_activity_probe_at` column
- Backfill with NULL (all friends start needing probe)

### Phase 2: Discovery Function
- Implement in friend-sync.ts
- Add logging for monitoring
- Test in isolation

### Phase 3: Feed Integration
- Add to syncFriendsForFeed
- Start with low limit (5 probes/load)
- Monitor API usage and response times

### Phase 4: Tune
- Adjust probe limit based on monitoring
- Adjust probe interval if needed
- Consider priority ordering (friends with more history first)
