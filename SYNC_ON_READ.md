# Sync-on-Read: Friend Data Synchronization Strategy

## Problem Statement

The feed currently shows stale data for friends who haven't had their profiles visited recently. This creates a poor user experience where:

1. **Achievements don't appear**: If a friend unlocks achievements but their profile hasn't been visited, those achievements aren't in the database and won't show in the feed.

2. **Playtime sessions are stale**: While playtime-only sessions can appear using `last_played` fallback logic, the playtime deltas (`playtime_minutes - previous_playtime_minutes`) are frozen at the last sync time, leading to incorrect or missing sessions.

3. **Scale problem**: As the user base grows, relying on profile visits to keep data fresh becomes unsustainable. With a small initial user pool, friends won't visit each other's profiles frequently enough to maintain fresh data.

## Solution: Sync-on-Read Pattern

Instead of syncing all friends on every feed load (which would hit API rate limits), we implement a **"Sync-on-Read"** pattern that only syncs friends whose data appears in the current feed view.

### Core Principle

**Only sync friends whose sessions are visible in the current feed page.**

This approach:
- ✅ Keeps the feed fresh for visible content
- ✅ Scales efficiently (doesn't grow with total friend count)
- ✅ Stays well under API rate limits
- ✅ Provides fast feed response times

## Implementation Strategy

### Phase 1: Lightweight Playtime Sync (Recommended for v1)

**Goal**: Update playtime data for friends visible in the feed, enabling accurate playtime-only session detection.

#### Steps

1. **Query feed from database** (existing logic)
   - Fetch achievement sessions
   - Fetch playtime-only sessions
   - Apply pagination, filters, cooldown

2. **Extract friend IDs from current page**
   ```typescript
   const visibleFriendIds = new Set<string>();
   sessions.forEach(session => {
     if (session.user.steamId !== loggedInUserId) {
       visibleFriendIds.add(session.user.steamId);
     }
   });
   ```

3. **Check staleness for visible friends only**
   ```typescript
   const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours
   const staleFriends = visibleFriendIds.filter(friendId => {
     const friend = await getUser(friendId);
     return !friend?.lastSyncAt || friend.lastSyncAt < staleThreshold;
   });
   ```

4. **Background sync for stale friends**
   - Use `GetRecentlyPlayedGames` (lightweight, single API call per friend)
   - Update `playtime_minutes`, `previous_playtime_minutes`, `last_played` in database
   - Use `waitUntil()` if available, otherwise fire-and-forget

5. **Return feed immediately**
   - Don't wait for sync to complete
   - Feed shows current data, updates on next refresh

### Phase 2: Achievement Sync (Future Enhancement)

**Goal**: Also sync achievements for recently played games, enabling achievement sessions to appear.

#### Additional Steps

1. **Identify games with playtime increases**
   ```typescript
   const gamesToSync = recentlyPlayedGames.filter(game => {
     const delta = game.playtime_minutes - (game.previous_playtime_minutes || 0);
     return delta >= 5; // Only games with meaningful playtime increase
   });
   ```

2. **Sync achievements for those games only**
   - Use existing `/api/achievements` logic
   - Parallel fetching with concurrency limits
   - Handle errors gracefully

## Technical Considerations

### Vercel Serverless Function Constraints

**Problem**: Vercel functions can terminate when the response is sent, potentially killing background syncs.

**Solutions**:

1. **Use `waitUntil()` (if available)**
   ```typescript
   // Next.js/Vercel supports waitUntil for background tasks
   if (typeof context?.waitUntil === 'function') {
     context.waitUntil(syncPromise);
   }
   ```

2. **Fire-and-forget with error handling**
   ```typescript
   // Accept that some syncs may not complete
   syncPromise.catch(error => {
     console.error('Background sync failed:', error);
     // Don't throw - this is non-critical
   });
   ```

3. **External worker (for longer tasks)**
   - Use Trigger.dev, Vercel Cron, or similar
   - Queue sync jobs for processing
   - Better reliability for syncs >30 seconds

### API Rate Limits

**Steam API Limits**: ~100,000 requests/day per API key

**Sync-on-Read Load Calculation**:
- **Scenario 1**: 100 active users, 50 friends each, 10% stale
  - Visible friends per feed: ~5-10
  - API calls per feed: 5-10 (GetRecentlyPlayedGames)
  - Daily calls: 100 users × 10 feeds/day × 7.5 avg = ~7,500 calls/day ✅

- **Scenario 2**: 1,000 active users, 50 friends each, 10% stale
  - Daily calls: 1,000 users × 10 feeds/day × 7.5 avg = ~75,000 calls/day ✅

**Comparison to Full Sync**:
- Full sync: 100 users × 50 friends × 24 syncs/day = 120,000 calls/day ❌ (exceeds limit)

### Concurrency & Error Handling

1. **Concurrency Limiting**
   ```typescript
   const CONCURRENCY_LIMIT = 5; // Sync 5 friends at a time
   const limiter = new ConcurrencyLimiter(CONCURRENCY_LIMIT);
   
   await Promise.allSettled(
     staleFriends.map(friendId => 
       limiter.limit(() => syncFriendPlaytime(friendId))
     )
   );
   ```

2. **Error Handling**
   - Use `Promise.allSettled` (not `Promise.all`)
   - Log errors but don't fail the feed request
   - Individual friend sync failures shouldn't block others

3. **Friend-Level Locking**
   - Prevent duplicate syncs if multiple users load feeds simultaneously
   - Use database flag or in-memory cache with TTL
   ```typescript
   const SYNC_COOLDOWN = 5 * 60 * 1000; // 5 minutes
   if (friend.lastSyncAt && Date.now() - friend.lastSyncAt < SYNC_COOLDOWN) {
     return; // Skip - recently synced
   }
   ```

### Pagination Considerations

**Problem**: If user loads page 2 of feed, friends on page 2 might be stale.

**Solution**: Sync friends from the current page view only. This is acceptable because:
- Most users view page 1 most frequently
- Page 2+ will trigger syncs when viewed
- Trade-off: slight delay for paginated content (acceptable)

**Alternative**: Track which friends were synced in this request and skip duplicates.

## Implementation Details

### File Structure

```
app/api/feed/route.ts          # Main feed endpoint (modify)
lib/utils/friend-sync.ts       # New: Friend sync utilities
lib/steam/client.ts            # Existing: Steam API client
```

### Key Functions

#### `syncFriendPlaytime(steamId: string)`
- Calls `GetRecentlyPlayedGames` for friend
- Updates `user_games` table with new playtime data
- Handles errors gracefully

#### `getStaleFriends(friendIds: string[], threshold: Date)`
- Checks `lastSyncAt` for each friend
- Returns array of stale friend IDs

#### `syncFriendsInBackground(friendIds: string[])`
- Orchestrates sync for multiple friends
- Implements concurrency limiting
- Uses `waitUntil()` or fire-and-forget

### Database Updates

For each friend's recently played game:
```typescript
await supabase.from('user_games').upsert({
  user_id: friendId,
  app_id: game.appid,
  playtime_minutes: game.playtime_forever,
  previous_playtime_minutes: existing?.playtime_minutes || game.playtime_forever,
  last_played: game.rtime_last_played 
    ? new Date(game.rtime_last_played * 1000)
    : new Date(),
  playtime_last_synced_at: new Date(),
}, { onConflict: 'user_id,app_id' });
```

## Edge Cases

### 1. Friend Profile is Private
- `GetRecentlyPlayedGames` may return 403
- **Handling**: Log and skip, don't fail feed

### 2. Friend Has No Recently Played Games
- API returns empty array
- **Handling**: Update `playtime_last_synced_at` timestamp, skip game updates

### 3. Concurrent Feed Requests
- Multiple users loading feeds simultaneously
- **Handling**: Friend-level locking/cooldown (5 minutes)

### 4. Sync Takes Longer Than Function Timeout
- Vercel function times out before sync completes
- **Handling**: Use `waitUntil()` or external worker for reliability

### 5. Steam API Rate Limit Hit
- API returns 429 (rate limit)
- **Handling**: Implement exponential backoff, queue for retry

## Performance Estimates

### Per Feed Request (Phase 1)

**Best Case** (no stale friends):
- Feed query: ~500ms
- Staleness check: ~100ms
- **Total**: ~600ms

**Typical Case** (5 stale friends):
- Feed query: ~500ms
- Staleness check: ~100ms
- Background sync: ~2-3s (fire-and-forget)
- **Total**: ~600ms (feed returns immediately)

**Worst Case** (10 stale friends, all syncing):
- Feed query: ~500ms
- Staleness check: ~100ms
- Background sync: ~5-7s (with concurrency limit)
- **Total**: ~600ms (feed returns immediately)

### API Calls Per Feed Request

- **Phase 1**: 0-10 calls (GetRecentlyPlayedGames only)
- **Phase 2**: 0-50 calls (games + achievements)

## Success Metrics

1. **Feed Freshness**: >90% of visible sessions have data <2 hours old
2. **API Usage**: <10% of daily rate limit at 1,000 active users
3. **Feed Response Time**: <1 second (p95)
4. **Sync Success Rate**: >95% of sync attempts succeed

## Future Enhancements

### Phase 2: Achievement Sync
- Sync achievements for games with playtime increases
- Enable achievement sessions to appear in feed

### Phase 3: Proactive Sync
- Background cron job to sync all friends periodically
- Lower staleness threshold for active friends
- Priority queue for frequently-viewed friends

### Phase 4: Real-time Updates
- WebSocket/SSE for live feed updates
- Push notifications for friend activity
- In-progress session indicators

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Vercel function terminates early | Medium | Use `waitUntil()` or external worker |
| Steam API rate limits | High | Implement concurrency limits, friend-level cooldowns |
| Sync failures block feed | High | Fire-and-forget, graceful error handling |
| Duplicate syncs waste API calls | Medium | Friend-level locking/cooldown |
| Stale data on paginated pages | Low | Acceptable trade-off, sync on page load |

## Conclusion

The Sync-on-Read pattern provides an efficient, scalable solution for keeping friend data fresh in the feed. By only syncing friends visible in the current view, we:

- ✅ Stay well under API rate limits
- ✅ Provide fast feed response times
- ✅ Keep visible content fresh
- ✅ Scale efficiently with user growth

**Recommendation**: Implement Phase 1 (lightweight playtime sync) for v1, then add Phase 2 (achievement sync) based on user feedback and API usage patterns.
