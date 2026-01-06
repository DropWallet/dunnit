# Friends Activity Feed - Implementation Plan

## Phase 1: Database & API Foundation (2-3 days)

### Step 1.1: Create Database Index
**File**: `migrations/add-feed-index.sql`

```sql
-- Index for efficient feed queries
CREATE INDEX IF NOT EXISTS idx_user_achievements_feed 
ON user_achievements(user_id, unlocked_at DESC) 
WHERE unlocked = true AND unlocked_at IS NOT NULL;
```

**Tasks:**
- [ ] Create migration file
- [ ] Run migration in Supabase
- [ ] Verify index creation

---

### Step 1.2: Create Session Grouping Utility
**File**: `lib/utils/feed-sessions.ts`

**Functions to implement:**
- `groupAchievementsIntoSessions(achievements: AchievementRow[]): FeedSession[]`
- `calculateSessionMetadata(session: AchievementRow[]): SessionMetadata`
- `formatDuration(ms: number): string` - "2h 15m" format
- `getRelativeTime(date: Date): string` - "2 hours ago" format
- `calculateNarrative(session: FeedSession): Narrative`

**Tasks:**
- [ ] Implement session grouping algorithm (4-hour window)
- [ ] Calculate session metadata (start, end, duration, count)
- [ ] Format duration helper
- [ ] Relative time helper
- [ ] Simple narrative logic (multiple-unlocks, rare-achievement)
- [ ] Add unit tests (optional but recommended)

---

### Step 1.3: Create Feed API Endpoint
**File**: `app/api/feed/route.ts`

**Implementation steps:**

1. **Get authenticated user's friend list**
   - Use existing `/api/friends` or call Steam API directly
   - Handle empty friend list

2. **Query recent achievement unlocks**
   - Join `user_achievements`, `users`, `user_games`, `achievements`
   - Filter by:
     - `unlocked = true`
     - `unlocked_at IS NOT NULL`
     - `unlocked_at >= 7 days ago`
     - `unlocked_at <= 30 minutes ago` (cooldown)
     - `user_id IN (friend_list)`
     - `unlocked_at >= since` (if provided)
   - Order by `unlocked_at ASC` (for grouping)

3. **Group achievements into sessions**
   - Call `groupAchievementsIntoSessions()`
   - Apply cooldown filter (sessions where `sessionEnd + 30min < now()`)

4. **Calculate session metadata**
   - For each session, calculate:
     - `sessionStart`, `sessionEnd`, `duration`
     - `achievementCount`, `minRarity`, `minRarityPercentage`
     - `narrative` (simple labels)

5. **Sort and paginate**
   - Sort by `sessionEnd DESC` (newest first)
   - Apply `limit` and `offset`
   - Calculate `hasMore`

6. **Return response**
   - Format as `FeedSession[]`
   - Include pagination metadata
   - Include feed metadata (fetchedAt, friendCount, cooldownMinutes)

**Tasks:**
- [ ] Create route file
- [ ] Implement authentication check
- [ ] Get friend list
- [ ] Build SQL query with joins
- [ ] Implement cooldown filtering
- [ ] Call session grouping utility
- [ ] Calculate session metadata
- [ ] Implement pagination
- [ ] Add error handling
- [ ] Add logging (development mode)
- [ ] Test with sample data

---

## Phase 2: UI Foundation (2-3 days)

### Step 2.1: Create Feed Hook
**File**: `hooks/useFeed.ts`

**Features:**
- Fetch feed data from `/api/feed`
- Handle loading and error states
- Polling every 60 seconds for new sessions
- Incremental updates using `since` parameter
- Show toast notification for new activities

**Tasks:**
- [ ] Create hook file
- [ ] Implement initial fetch
- [ ] Implement polling (60s interval)
- [ ] Handle `since` parameter for incremental updates
- [ ] Prepend new sessions to existing list
- [ ] Show toast notification
- [ ] Handle errors gracefully
- [ ] Cleanup interval on unmount

---

### Step 2.2: Create Feed Page
**File**: `app/feed/page.tsx`

**Layout:**
- Timeline layout (vertical scroll)
- Header with "Feed" title
- Refresh button
- Filter controls (game, friend) - optional for Stage 1
- Session cards list
- Empty states (no friends, no activity, loading)
- Pagination or "Load More" button

**Tasks:**
- [ ] Create page file
- [ ] Use `useFeed` hook
- [ ] Implement timeline layout
- [ ] Add header and refresh button
- [ ] Render session cards
- [ ] Add empty states
- [ ] Add loading states
- [ ] Add error handling
- [ ] Implement pagination/infinite scroll
- [ ] Add responsive design

---

### Step 2.3: Create Session Card Component
**File**: `components/feed-session-card.tsx`

**Card Structure:**
```
┌─────────────────────────────────────┐
│ [Avatar] Username                   │
│         Game Name                   │
│         [Game Cover Image]          │
│                                     │
│ Unlocked 3 achievements             │
│ 2h 15m session • 2 hours ago       │
│                                     │
│ [Achievement Icons Grid]            │
│ [Icon] [Icon] [Icon]                │
│                                     │
│ [View Game] [View Profile]          │
└─────────────────────────────────────┘
```

**Props:**
```typescript
interface FeedSessionCardProps {
  session: FeedSession;
}
```

**Features:**
- Display user avatar and username (link to profile)
- Display game cover image and name (link to game page)
- Show achievement count
- Show session duration
- Show relative time ("2 hours ago")
- Display achievement icons in grid
- Show rarity indicator (if rare achievement)
- Show narrative label (if applicable)
- Links to game page and user profile

**Tasks:**
- [ ] Create component file
- [ ] Define props interface
- [ ] Implement card layout
- [ ] Add user info section
- [ ] Add game info section
- [ ] Add achievement count display
- [ ] Add duration and time display
- [ ] Add achievement icons grid
- [ ] Add rarity indicators
- [ ] Add narrative labels
- [ ] Add links to game/profile
- [ ] Add hover effects
- [ ] Add responsive design
- [ ] Add loading skeleton (optional)

---

## Phase 3: Polish & Enhancements (1-2 days)

### Step 3.1: Add Filtering
**File**: `app/feed/page.tsx` (update)

**Filters:**
- Filter by game (dropdown)
- Filter by friend (dropdown)
- Sort options (newest first, oldest first)

**Tasks:**
- [ ] Add filter UI components
- [ ] Implement game filter
- [ ] Implement friend filter
- [ ] Implement sort options
- [ ] Update API calls with filter params
- [ ] Persist filter state (localStorage)

---

### Step 3.2: Add Pagination/Infinite Scroll
**File**: `app/feed/page.tsx` (update)

**Options:**
- Infinite scroll (scroll to bottom loads more)
- "Load More" button
- Traditional pagination (page 1, 2, 3...)

**Tasks:**
- [ ] Choose pagination approach
- [ ] Implement infinite scroll or "Load More"
- [ ] Handle loading states
- [ ] Handle "no more results" state
- [ ] Update `useFeed` hook if needed

---

### Step 3.3: Enhance Narratives
**File**: `lib/utils/feed-sessions.ts` (update)

**Narratives to add:**
- "Unlocked X achievements" (if `achievementCount > 3`)
- "Rare achievement unlocked" (if `minRarityPercentage < 5`)
- "First time playing" (if first unlock for that game - requires additional check)

**Tasks:**
- [ ] Enhance `calculateNarrative()` function
- [ ] Add "multiple-unlocks" narrative
- [ ] Add "rare-achievement" narrative
- [ ] Add "first-time" narrative (requires checking if this is first unlock)
- [ ] Update UI to display narratives prominently

---

### Step 3.4: Add Toast Notifications
**File**: `app/feed/page.tsx` (update)

**Features:**
- Show toast when new sessions arrive
- Format: "X new activities available"
- Click to scroll to top
- Auto-dismiss after 5 seconds

**Tasks:**
- [ ] Add toast component/library
- [ ] Show toast on new sessions
- [ ] Format message with count
- [ ] Add click handler to scroll to top
- [ ] Auto-dismiss logic

---

## Testing Checklist

### API Testing
- [ ] Test with no friends
- [ ] Test with friends but no achievements
- [ ] Test with single session
- [ ] Test with multiple sessions
- [ ] Test session grouping (4-hour window)
- [ ] Test cooldown filtering (30 minutes)
- [ ] Test pagination
- [ ] Test `since` parameter
- [ ] Test filtering by game
- [ ] Test filtering by friend
- [ ] Test error handling

### UI Testing
- [ ] Test feed page loads
- [ ] Test session cards render correctly
- [ ] Test empty states
- [ ] Test loading states
- [ ] Test error states
- [ ] Test polling (wait 60s, verify new sessions appear)
- [ ] Test refresh button
- [ ] Test pagination/infinite scroll
- [ ] Test filters
- [ ] Test responsive design (mobile, tablet, desktop)
- [ ] Test links (game page, user profile)

### Edge Cases
- [ ] Very long sessions (>4 hours)
- [ ] Multiple achievements in quick succession
- [ ] Friend with private profile
- [ ] Friend with no achievements
- [ ] Session spanning midnight
- [ ] Session with only one achievement
- [ ] Session with many achievements (>10)

---

## File Structure

```
app/
  api/
    feed/
      route.ts              # Feed API endpoint
  feed/
    page.tsx                # Feed page

components/
  feed-session-card.tsx     # Session card component

hooks/
  useFeed.ts                # Feed data hook

lib/
  utils/
    feed-sessions.ts        # Session grouping utilities

migrations/
  add-feed-index.sql        # Database index for feed
```

---

## Timeline Estimate

- **Phase 1 (API)**: 2-3 days
- **Phase 2 (UI)**: 2-3 days
- **Phase 3 (Polish)**: 1-2 days
- **Total**: 5-8 days

---

## Dependencies

- Existing friend list API (`/api/friends`)
- Existing achievement sync system
- Existing user/game/achievement data access layer
- Existing design system (Tailwind, shadcn/ui)

---

## Success Criteria

✅ Feed displays sessions from friends  
✅ Sessions are correctly grouped (4-hour window)  
✅ Cooldown period works (30 minutes)  
✅ Polling updates feed automatically  
✅ Session cards display all required information  
✅ Feed is performant (<500ms load time)  
✅ Responsive design works on all devices  
✅ Error handling is robust  

---

## Next Steps After Stage 1

1. **Add social interactions**: Kudos, comments
2. **Advanced narratives**: More complex story labels
3. **Live sessions**: Show in-progress sessions with "Live" badge
4. **Background sync**: Automatically sync friends' achievements
5. **Notifications**: Push notifications for friend activity
