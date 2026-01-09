# Achievement Sessions Ledger Implementation Plan

## Overview
Extend the ledger approach to achievement sessions by persisting them to the `game_sessions` table, just like playtime sessions. This will make achievement sessions persistent and consistent with the playtime session implementation.

## Current State

### Achievement Sessions (Current - On-the-Fly)
- ✅ Fetched from `user_achievements` table
- ✅ Grouped into sessions using `groupAchievementsIntoSessions()` (4-hour window)
- ✅ Calculated every time the feed loads
- ❌ **Not persisted to `game_sessions` table**

### Playtime Sessions (Current - Ledger)
- ✅ Written to `game_sessions` table with `type: 'playtime'`
- ✅ Queried from `game_sessions` table in feed
- ✅ Persistent across syncs

## Goals

1. **Detect new achievement unlocks** when achievements are synced
2. **Group new achievements into sessions** using the same 4-hour window logic
3. **Write achievement sessions to `game_sessions`** table with `type: 'achievement'`
4. **Update feed to query achievement sessions** from `game_sessions` instead of calculating on-the-fly
5. **Handle cooldown merging** for achievement sessions (within 30 minutes)

## Implementation Steps

### Step 1: Create Helper Function to Detect New Unlocks
**File**: `lib/utils/achievement-sessions.ts` (new file)

Create a function that:
- Takes old and new achievement lists
- Identifies newly unlocked achievements (unlocked in new, not in old)
- Groups them into sessions using the same 4-hour window logic from `groupAchievementsIntoSessions`
- Returns session data ready to be written to `game_sessions`

```typescript
export interface AchievementSessionData {
  userId: string;
  appId: number;
  sessionStart: Date;
  sessionEnd: Date;
  achievementCount: number;
}

export function detectNewAchievementSessions(
  oldAchievements: UserAchievement[],
  newAchievements: UserAchievement[],
  userId: string,
  appId: number
): AchievementSessionData[]
```

### Step 2: Write Achievement Sessions After Save
**File**: `lib/data/supabase-access.ts`

Modify `saveUserAchievements` to:
1. Fetch existing achievements before saving (to detect new unlocks)
2. Save achievements (existing logic)
3. Detect new unlocks and group into sessions
4. Write achievement sessions to `game_sessions` table

**Alternative Approach**: Create a separate function `writeAchievementSessions` that's called after `saveUserAchievements` in:
- `app/api/achievements/route.ts`
- `lib/utils/friend-sync.ts` (in `syncGameAchievements`)

**Recommendation**: Use the alternative approach to keep `saveUserAchievements` focused on saving achievements, and add session writing as a separate concern.

### Step 3: Write Achievement Sessions to Database
**File**: `lib/data/supabase-access.ts` or new utility file

Create function to:
- Take achievement session data
- Check for recent session (within 30 minutes) for cooldown merging
- Write to `game_sessions` with `type: 'achievement'`
- Use `playtimeDelta: 0` for achievement sessions (not applicable)

```typescript
async function writeAchievementSessions(
  userId: string,
  appId: number,
  sessions: AchievementSessionData[]
): Promise<void>
```

### Step 4: Update Feed to Query Achievement Sessions
**File**: `app/api/feed/route.ts`

Modify feed route to:
1. Query achievement sessions from `game_sessions` table (instead of `user_achievements`)
2. Filter by `type: 'achievement'` and cooldown
3. Convert `GameSession` to `FeedSession` format
4. Keep the overlap check with playtime sessions (already exists)

**Note**: We'll still need to fetch achievement details from `user_achievements` for display, but the session grouping will come from `game_sessions`.

### Step 5: Handle Edge Cases

1. **Cooldown Merging**: If an achievement session is created within 30 minutes of an existing achievement session for the same user/game, merge them
2. **Overlap with Playtime**: Keep existing logic that skips playtime sessions if achievement session overlaps
3. **Backfill**: Existing achievement sessions in feed will continue to work (calculated on-the-fly) until new ones are created
4. **Friend Sync**: Ensure achievement sessions are written when friend achievements are synced

## Files to Modify

1. **New File**: `lib/utils/achievement-sessions.ts`
   - `detectNewAchievementSessions()` - detect and group new unlocks
   - `writeAchievementSessions()` - write to database

2. **Modify**: `app/api/achievements/route.ts`
   - Call `writeAchievementSessions()` after saving achievements

3. **Modify**: `lib/utils/friend-sync.ts`
   - Call `writeAchievementSessions()` in `syncGameAchievements()` after saving

4. **Modify**: `app/api/feed/route.ts`
   - Query achievement sessions from `game_sessions` instead of calculating on-the-fly
   - Still fetch achievement details from `user_achievements` for display

5. **Modify**: `lib/data/supabase-access.ts`
   - Add helper method for writing achievement sessions (or use utility function)

## Testing Considerations

1. **New Unlocks**: Test that new achievement unlocks create sessions
2. **Multiple Unlocks**: Test that multiple unlocks in same 4-hour window create one session
3. **Separate Sessions**: Test that unlocks >4 hours apart create separate sessions
4. **Cooldown Merging**: Test that sessions within 30 minutes merge correctly
5. **Feed Display**: Test that achievement sessions appear correctly in feed
6. **Friend Sync**: Test that friend achievement sessions are written
7. **Overlap Detection**: Test that playtime sessions are skipped when achievement session overlaps

## Migration Notes

- No database migration needed (table already supports `type: 'achievement'`)
- Existing achievement sessions will continue to work (calculated on-the-fly)
- New achievement sessions will be persisted going forward
- Feed will gradually transition from on-the-fly calculation to database queries

## Benefits

1. **Consistency**: Achievement sessions use the same ledger approach as playtime sessions
2. **Performance**: Feed queries become simpler (direct database query vs. grouping logic)
3. **Persistence**: Achievement sessions persist across syncs
4. **Comments**: Achievement sessions have stable IDs for future comment features
5. **History**: Permanent record of achievement unlock sessions
