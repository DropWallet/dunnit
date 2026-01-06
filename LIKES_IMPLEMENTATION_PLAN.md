# Likes Feature - Implementation Plan

## Overview
Add the ability for users to "like" feed session posts. This will include:
- Database schema for storing likes
- API endpoints for liking/unliking posts
- UI components for displaying like counts and like buttons
- Optimistic updates for better UX

## Phase 1: Database & Schema (Day 1)

### Step 1.1: Create Likes Table Migration
**File**: `migrations/add-likes-table.sql`

```sql
-- Likes table for feed sessions
CREATE TABLE IF NOT EXISTS feed_likes (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_feed_likes_session_id ON feed_likes(session_id);
CREATE INDEX IF NOT EXISTS idx_feed_likes_user_id ON feed_likes(user_id);
```

**Tasks:**
- [ ] Create migration file
- [ ] Run migration in Supabase
- [ ] Verify table and indexes created

---

## Phase 2: API Endpoints (Day 1-2)

### Step 2.1: Create Like/Unlike API Endpoint
**File**: `app/api/feed/[sessionId]/like/route.ts`

**Endpoints:**
- `POST /api/feed/[sessionId]/like` - Like a session
- `DELETE /api/feed/[sessionId]/like` - Unlike a session

**Implementation:**
1. Get authenticated user from cookies
2. Validate sessionId format (should match `{userId}-{appId}-{timestamp}`)
3. For POST: Insert like if not exists (upsert)
4. For DELETE: Remove like if exists
5. Return success/error response

**Response format:**
```json
{
  "success": true,
  "liked": true,
  "likeCount": 5
}
```

**Tasks:**
- [ ] Create route file structure
- [ ] Implement POST endpoint (like)
- [ ] Implement DELETE endpoint (unlike)
- [ ] Add error handling
- [ ] Add validation
- [ ] Test with authenticated user

---

### Step 2.2: Update Feed API to Include Like Data
**File**: `app/api/feed/route.ts`

**Changes:**
1. After grouping sessions, fetch like counts for all session IDs
2. Check if current user has liked each session
3. Add `likeCount` and `isLiked` to each session in response

**Query structure:**
```sql
-- Get like counts for sessions
SELECT session_id, COUNT(*) as like_count
FROM feed_likes
WHERE session_id IN (session_ids...)
GROUP BY session_id;

-- Check if current user liked
SELECT session_id
FROM feed_likes
WHERE session_id IN (session_ids...)
AND user_id = current_user_id;
```

**Tasks:**
- [ ] Add like count query to feed endpoint
- [ ] Add isLiked check for current user
- [ ] Update FeedSession interface to include like data
- [ ] Update response to include like information
- [ ] Test with multiple sessions

---

## Phase 3: Type Updates (Day 2)

### Step 3.1: Update FeedSession Interface
**File**: `lib/utils/feed-sessions.ts`

**Changes:**
```typescript
export interface FeedSession {
  // ... existing fields ...
  likeCount: number;
  isLiked: boolean;
}
```

**Tasks:**
- [ ] Add `likeCount` and `isLiked` to FeedSession interface
- [ ] Update session creation functions to include default values
- [ ] Update feed API to populate these fields

---

## Phase 4: UI Components (Day 2-3)

### Step 4.1: Create Like Button Component
**File**: `components/feed-like-button.tsx`

**Features:**
- Heart icon (filled when liked, outline when not)
- Like count display
- Optimistic updates (update UI immediately, rollback on error)
- Loading state during API call
- Accessible (keyboard navigation, ARIA labels)

**Props:**
```typescript
interface FeedLikeButtonProps {
  sessionId: string;
  initialLikeCount: number;
  initialIsLiked: boolean;
  onLikeChange?: (liked: boolean, count: number) => void;
}
```

**Tasks:**
- [ ] Create component file
- [ ] Implement like/unlike logic
- [ ] Add optimistic updates
- [ ] Add loading states
- [ ] Add error handling
- [ ] Style with theme colors
- [ ] Add hover/active states
- [ ] Test accessibility

---

### Step 4.2: Integrate Like Button into Feed Card
**File**: `components/feed-session-card.tsx`

**Placement:**
- Add like button below the achievement progress bar
- On mobile: Full width button with icon and count
- On desktop: Same placement, consistent styling

**Tasks:**
- [ ] Import FeedLikeButton component
- [ ] Add likeCount and isLiked props to FeedSessionCard
- [ ] Place button in appropriate location
- [ ] Update styling for mobile/desktop layouts
- [ ] Test with real data

---

### Step 4.3: Update Feed Page to Pass Like Data
**File**: `app/feed/page.tsx`

**Changes:**
- Ensure FeedSessionCard receives likeCount and isLiked from session data
- No other changes needed (data flows from API)

**Tasks:**
- [ ] Verify props are passed correctly
- [ ] Test end-to-end flow

---

## Phase 5: Data Access Layer (Day 2)

### Step 5.1: Add Like Methods to Data Access
**File**: `lib/data/access.ts` and `lib/data/supabase-access.ts`

**Methods to add:**
```typescript
// In DataAccess interface
likeSession(sessionId: string, userId: string): Promise<void>;
unlikeSession(sessionId: string, userId: string): Promise<void>;
getLikeCounts(sessionIds: string[]): Promise<Map<string, number>>;
getUserLikes(sessionIds: string[], userId: string): Promise<Set<string>>;
```

**Tasks:**
- [ ] Add methods to DataAccess interface
- [ ] Implement in SupabaseDataAccess
- [ ] Add error handling
- [ ] Test database operations

---

## Phase 6: Testing & Polish (Day 3)

### Step 6.1: Testing Checklist
- [ ] Like a session (verify count increases, button state changes)
- [ ] Unlike a session (verify count decreases, button state changes)
- [ ] Like count persists on page refresh
- [ ] Multiple users can like same session
- [ ] User cannot like their own session (optional - decide if needed)
- [ ] Optimistic updates work correctly
- [ ] Error handling (network errors, API errors)
- [ ] Loading states display correctly
- [ ] Mobile and desktop layouts work
- [ ] Accessibility (keyboard navigation, screen readers)

### Step 6.2: Edge Cases
- [ ] What happens if session is deleted but likes exist?
- [ ] What happens if user is deleted but likes exist?
- [ ] Rate limiting (prevent spam liking)
- [ ] Concurrent likes (two users like at same time)

---

## Design Considerations

### Like Button Design
- **Icon**: Heart icon (filled when liked, outline when not)
- **Color**: Primary color when liked, muted when not
- **Size**: Match other interactive elements in feed card
- **Position**: Below progress bar, before/after achievement icons (TBD)

### Like Count Display
- Show count next to icon
- Format: "5" or "1.2k" for large numbers
- Hide count if 0 (optional - decide)

### User Experience
- **Optimistic Updates**: Update UI immediately, rollback on error
- **Loading State**: Show spinner/disabled state during API call
- **Error Handling**: Show toast/error message if like fails
- **Accessibility**: Keyboard accessible, ARIA labels

---

## API Endpoints Summary

### POST /api/feed/[sessionId]/like
- **Auth**: Required
- **Body**: None
- **Response**: `{ success: boolean, liked: boolean, likeCount: number }`

### DELETE /api/feed/[sessionId]/like
- **Auth**: Required
- **Body**: None
- **Response**: `{ success: boolean, liked: boolean, likeCount: number }`

### GET /api/feed (updated)
- **Auth**: Required
- **Response**: Includes `likeCount` and `isLiked` in each session

---

## Database Schema

### feed_likes Table
```sql
CREATE TABLE feed_likes (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);
```

**Indexes:**
- `idx_feed_likes_session_id` on `session_id`
- `idx_feed_likes_user_id` on `user_id`

---

## Success Criteria

1. ✅ Users can like/unlike feed sessions
2. ✅ Like counts display correctly
3. ✅ Like state persists across page refreshes
4. ✅ Optimistic updates provide smooth UX
5. ✅ Mobile and desktop layouts work correctly
6. ✅ No performance degradation in feed loading
7. ✅ Error handling prevents broken states
8. ✅ Accessible to keyboard and screen reader users

---

## Future Enhancements (Out of Scope)

- Show who liked a post (hover/click to see list)
- Like notifications
- Unlike confirmation dialog
- Like animations/effects
- Most liked sessions sorting/filtering
