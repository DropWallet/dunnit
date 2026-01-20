# First Load Feed Population - Edge Cases & Considerations Review

## Overview
This document reviews the implementation plan for populating the feed on first load for new users, including edge cases, performance considerations, and final recommendations.

## Implementation Plan Summary

1. **First-time sync session creation**: Use `playtime_2weeks` to create sessions on first sync
2. **Increase sync limit**: Change `MAX_FIRST_SYNC_FRIENDS` from 20 to 30
3. **Prioritization**: Sync friends with public profiles and recent activity first
4. **Load More button**: Add UI button to sync additional batches of friends

---

## Edge Cases & Considerations

### 1. First-Time Sync Session Creation

#### ✅ **Edge Case: `playtime_2weeks` is 0 or missing**
**Current behavior**: Code uses `playtime_2weeks ?? 0`, then falls back to `playtime_forever` (capped at 4 hours) in `app/api/games/route.ts` (lines 296-300).

**Recommendation**: 
- ✅ **Keep existing fallback logic** - Already handles this correctly
- Use `playtime_2weeks` if > 0, otherwise fallback to `playtime_forever` (capped at 4 hours)
- Only create session if `playtimeDelta >= 3` minutes

#### ⚠️ **Edge Case: `playtime_2weeks` is very large (> 4 hours)**
**Current behavior**: `app/api/games/route.ts` caps at 4 hours (line 297-300).

**Recommendation**:
- ✅ **Cap at 4 hours** - Prevents unrealistic session durations
- Use `Math.min(playtime2Weeks, 4 * 60)` for session delta
- This matches existing behavior for user's own games

#### ⚠️ **Edge Case: Friend has `playtime_2weeks` but game is NOT in recently played list**
**Current behavior**: `lib/utils/friend-sync.ts` only creates sessions for games in `recentlyPlayedAppIds` (line 425).

**Recommendation**:
- ✅ **Keep existing logic** - Only create sessions for games in recently played list
- This ensures we only create sessions for games actually played within 14 days
- Prevents creating sessions for old games with stale `playtime_2weeks` data

#### ⚠️ **Edge Case: Multiple first-time syncs for same friend**
**Scenario**: User clicks "Load More" multiple times, syncing same friend again before baseline is established.

**Recommendation**:
- ✅ **Check `playtimeLastSyncedAt`** - If it exists, use normal sync window approach
- Only use `playtime_2weeks` approach when `!existingGame` (first-time sync)
- This prevents duplicate sessions from multiple first-time syncs

#### ⚠️ **Edge Case: Session merging with existing sessions**
**Scenario**: First-time sync creates session, then friend syncs again before baseline is updated.

**Recommendation**:
- ✅ **Use existing merge logic** - Check for existing sessions with same `(userId, appId, sessionStart)`
- Proximity merge (45-minute window) will handle overlapping sessions
- Zero-duration session replacement logic will handle edge cases

---

### 2. Sync Limit & Prioritization

#### ✅ **Edge Case: User has 200+ friends**
**Current behavior**: `MAX_FIRST_SYNC_FRIENDS = 20` limits initial sync.

**Recommendation**:
- ✅ **Increase to 30** - Provides better initial feed population
- ✅ **Keep limit** - Prevents API overload on first load
- ✅ **Load More button** - Allows progressive loading of remaining friends

#### ⚠️ **Edge Case: All 30 friends are private profiles**
**Scenario**: First 30 friends all return 401 errors, no sessions created.

**Recommendation**:
- ✅ **Mark as private and continue** - Current code already handles this (lines 324-335)
- ✅ **Prioritize public profiles** - Sort friends by `isPrivate` flag (false first)
- ✅ **Fallback to next batch** - Load More button allows syncing next 30 friends

#### ⚠️ **Edge Case: Prioritization logic**
**Current behavior**: No explicit prioritization - uses array order from Steam API.

**Recommendation**:
- ✅ **Prioritize by**:
  1. Public profiles (`isPrivate = false`) first
  2. Friends with games in DB (faster sync)
  3. Friends with recent playtime in DB
  4. Alphabetical or friend date order
- ✅ **Implementation**: Sort `friendsNotInDb` array before slicing

---

### 3. Load More Button Implementation

#### ⚠️ **Edge Case: Button state management**
**Scenario**: User clicks "Load More" multiple times rapidly.

**Recommendation**:
- ✅ **Disable button during sync** - Show "Loading..." state
- ✅ **Track synced friends** - Use `lastFeedSyncAttempt` to prevent duplicate syncs
- ✅ **Show progress** - Display "Syncing X of Y friends..." if possible

#### ⚠️ **Edge Case: No more friends to sync**
**Scenario**: All friends have been synced.

**Recommendation**:
- ✅ **Hide button** - Only show if `unsyncedFriendsCount > 0`
- ✅ **Calculate unsynced count** - `totalFriends - syncedFriends.length`
- ✅ **Handle edge case** - If all friends synced, show "All friends synced" message

#### ⚠️ **Edge Case: API rate limits**
**Scenario**: User clicks "Load More" too frequently, hitting Steam API rate limits.

**Recommendation**:
- ✅ **Respect cooldown** - Use existing `lastFeedSyncAttempt` check (15-minute cooldown)
- ✅ **Show cooldown message** - "Please wait X minutes before syncing more friends"
- ✅ **Circuit breaker** - Existing circuit breaker in `lib/steam/client.ts` handles API failures

---

### 4. Performance Considerations

#### ✅ **API Call Count**
**Current**: 30 friends × 2 API calls = 60 calls (with 5 concurrent = ~12 seconds)

**Recommendation**:
- ✅ **Acceptable** - 12 seconds is reasonable for first load
- ✅ **Background sync** - Use existing `syncFriendsInBackground` with timeout
- ✅ **Timeout handling** - Continue with partial results if timeout occurs

#### ⚠️ **Database Write Load**
**Scenario**: 30 friends × multiple games each = many database writes.

**Recommendation**:
- ✅ **Batch operations** - Existing code uses batch saves where possible
- ✅ **Upsert logic** - Prevents duplicate game records
- ✅ **Session deduplication** - Existing logic prevents duplicate sessions

#### ⚠️ **Feed Query Performance**
**Scenario**: After syncing 30 friends, feed query needs to fetch all their sessions.

**Recommendation**:
- ✅ **Existing indexes** - `idx_game_sessions_user_end` handles this efficiently
- ✅ **Pagination** - Feed already uses pagination (limit=20)
- ✅ **Cooldown filter** - Reduces query size by filtering old sessions

---

### 5. User Experience Considerations

#### ⚠️ **Edge Case: Empty feed after first sync**
**Scenario**: User has 30 friends, but none have played games in last 14 days.

**Recommendation**:
- ✅ **Show empty state** - Existing empty state UI handles this
- ✅ **Helpful message** - "No recent activity from your friends. Try syncing more friends!"
- ✅ **Load More button** - Still available to sync more friends

#### ⚠️ **Edge Case: Feed shows old sessions**
**Scenario**: First-time sync creates sessions with 2-week window, but friend hasn't played recently.

**Recommendation**:
- ✅ **Cooldown filter** - Existing 30-minute cooldown prevents showing incomplete sessions
- ✅ **Lookback filter** - Existing 14-day lookback prevents showing very old sessions
- ✅ **Session timestamps** - Use `syncTime - 2 weeks` as `sessionStart`, `syncTime` as `sessionEnd`

#### ⚠️ **Edge Case: Session appears twice**
**Scenario**: First-time sync creates session, then normal sync creates another session for same playtime.

**Recommendation**:
- ✅ **Deduplication logic** - Existing logic prevents duplicates:
  - Check by `(userId, appId, sessionStart)` rounded to nearest second
  - Proximity merge for sessions within 45 minutes
  - Zero-duration session replacement

---

## Final Recommendations

### ✅ **Implementation Checklist**

1. **First-time sync session creation**:
   - ✅ Use `playtime_2weeks` for session delta (with fallback to `playtime_forever` capped at 4 hours)
   - ✅ Only create sessions for games in recently played list
   - ✅ Use sync window: `sessionStart = syncTime - 2 weeks`, `sessionEnd = syncTime`
   - ✅ Only create if `playtimeDelta >= 3` minutes

2. **Increase sync limit**:
   - ✅ Change `MAX_FIRST_SYNC_FRIENDS` from 20 to 30
   - ✅ Keep limit to prevent API overload

3. **Prioritization**:
   - ✅ Sort friends by: public profiles first, then by games in DB, then by recent playtime
   - ✅ Implement before slicing array

4. **Load More button**:
   - ✅ Create API endpoint: `/api/feed/load-more-friends`
   - ✅ Track synced friends to prevent duplicates
   - ✅ Show loading state and progress
   - ✅ Respect cooldown (15 minutes)
   - ✅ Hide when all friends synced

### ⚠️ **Risk Assessment**

**Low Risk**:
- First-time sync session creation (well-tested pattern from `app/api/games/route.ts`)
- Increasing sync limit from 20 to 30 (minimal impact)
- Prioritization logic (simple sorting)

**Medium Risk**:
- Load More button implementation (new UI component and API endpoint)
- Button state management (needs careful UX consideration)

**Mitigation**:
- Use existing patterns from codebase
- Test with users who have many friends (200+)
- Monitor API rate limits and adjust cooldown if needed

### ✅ **Testing Scenarios**

1. **New user with 30 friends**: Verify feed populates on first load
2. **New user with 200+ friends**: Verify first 30 are synced, Load More works
3. **Friend with private profile**: Verify marked as private, doesn't block other syncs
4. **Friend with no recent playtime**: Verify no sessions created, baseline established
5. **Friend with large `playtime_2weeks`**: Verify capped at 4 hours
6. **Multiple Load More clicks**: Verify no duplicate syncs, cooldown respected
7. **All friends synced**: Verify button hidden, appropriate message shown

---

## Conclusion

The implementation plan is **sound and low-risk**. The edge cases are well-handled by existing code patterns, and the new features (Load More button, prioritization) are straightforward additions that follow existing patterns.

**Ready to proceed with implementation.**
