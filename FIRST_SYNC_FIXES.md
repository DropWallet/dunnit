# First Sync Feed Population Fixes

## Summary

This document outlines the fixes needed to properly populate the feed for new users when they first sign up and load the feed. The issues affect how friends who have never been synced are handled, and how session length and dates are calculated on first sync.

## Issues Identified

### 1. Friends Not in Database Aren't Synced

**Problem:**
When a new user signs up and loads the feed for the first time, their friends' Steam IDs are fetched from the Steam API. However, the sync-on-read logic in `app/api/feed/route.ts` only queries friends who are already in the `users` table (line 470-473). Friends who have never been synced don't appear in this query result, so they're never added to `friendsNeedingSync` and never get synced.

**Impact:**
- New users see an empty feed on first load
- Friends who have never been synced are never included in background syncs
- Feed only populates after friends are manually visited or synced through other means

**Fix:**
Add friends who aren't in the `users` table to the sync queue:

```typescript
// After line 473 in app/api/feed/route.ts
const friendsInDb = new Set((allFriendsUsers || []).map((u: any) => u.steam_id));
const friendsNotInDb = friendSteamIds.filter(id => !friendsInDb.has(id));

// Add friends not in DB to friendsNeedingSync
friendsNotInDb.forEach(friendId => {
  friendsNeedingSync.add(friendId);
});
```

### 2. First Sync Session Length Uses Wrong Playtime Source

**Problem:**
In `lib/utils/friend-sync.ts` (lines 272-273), when creating sessions for recently played games on first sync, the code uses `playtime_forever` (total lifetime playtime) as the `playtimeDelta` instead of `playtime_2weeks` (recent playtime within the last 2 weeks).

**Impact:**
- If a friend has 100 hours total playtime but only 2 hours in the last 2 weeks, a session is created with 100 hours (capped at 4 hours) instead of 2 hours
- This creates inaccurate session lengths that don't reflect recent activity
- The comment on line 271 incorrectly states "acceptable because it's recent playtime, not lifetime" when it's actually using lifetime playtime

**Fix:**
Use `playtime_2weeks` for the session delta on first sync:

```typescript
// Line 272-273 in lib/utils/friend-sync.ts
// Change from:
const currentPlaytimeMinutes = steamGame.playtime_forever ?? 0;
const playtimeDelta = currentPlaytimeMinutes; // All playtime is "new" on first sync

// To:
const playtime2Weeks = steamGame.playtime_2weeks ?? 0;
const playtimeDelta = Math.min(playtime2Weeks, 4 * 60); // Use recent playtime, capped at 4 hours
```

### 3. First Sync Session Dates Have Zero Duration

**Problem:**
In `lib/utils/friend-sync.ts` (lines 300-303), when `rtime_last_played` exists, the code sets both `sessionStart` and `sessionEnd` to the same `lastPlayed` timestamp, creating a session with zero duration.

**Impact:**
- Sessions appear as instant (0 minutes) even though they represent actual playtime
- Feed displays incorrect session durations
- Session grouping and display logic may not work correctly

**Fix:**
Calculate `sessionStart` by subtracting the session duration from `sessionEnd`:

```typescript
// Lines 300-303 in lib/utils/friend-sync.ts
// Change from:
if (lastPlayed) {
  // If we have lastPlayed, use it for both start and end
  sessionEnd = lastPlayed;
  calculatedSessionStart = lastPlayed;
}

// To:
if (lastPlayed) {
  // Use lastPlayed as sessionEnd, calculate start by subtracting duration
  sessionEnd = lastPlayed;
  calculatedSessionStart = new Date(lastPlayed.getTime() - sessionMinutes * 60 * 1000);
}
```

## Implementation Status

✅ **All fixes have been implemented in phases:**

### Phase 1 (Completed): Data Fixes
1. ✅ **Fix first sync session length** - Now uses `playtime_2weeks` instead of `playtime_forever` (with fallback)
2. ✅ **Fix first sync session dates** - Now calculates proper duration (not zero)

### Phase 2 (Completed): Sync Logic
3. ✅ **Fix sync-on-read logic** - Now includes friends not in database (with per-user limit of 20 to prevent API overload)

### Phase 3 (Completed): User Creation
4. ✅ **Create user records during sync** - Added `ensureUserExists()` helper function that:
   - Checks if user exists before calling `updateUser`
   - Creates user record from Steam API if missing
   - Handles errors gracefully (logs but continues sync)
   - Uses upsert to handle race conditions

## Implementation Details

### Fix #1: Friends Not in Database
- Added logic to find friends not in `users` table
- Limited to first 20 friends on first sync to prevent API overload
- Integrated with existing staleness checks and cooldowns

### Fix #2 & #3: Session Length and Duration
- Changed from `playtime_forever` to `playtime_2weeks` for session delta
- Added fallback to `playtime_forever` (capped) if `playtime_2weeks` is 0 or missing
- Fixed zero-duration sessions by calculating `sessionStart = sessionEnd - duration`

### Fix #4: User Record Creation
- Added `ensureUserExists()` helper function
- Called at start of `syncFriendPlaytime` and before `updateUser` calls
- Graceful error handling: if user creation fails, sync continues (games/sessions can still be created)

## Testing Considerations

- Test with a new user account that has friends who have never been synced
- Verify that friends not in the database are included in background syncs
- Verify that first sync sessions use `playtime_2weeks` for delta
- Verify that sessions have proper duration (not zero)
- Verify that session dates are accurate (end = lastPlayed, start = end - duration)

## Related Files

- `app/api/feed/route.ts` - Sync-on-read logic
- `lib/utils/friend-sync.ts` - First sync session creation logic
