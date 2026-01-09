# Comments Feature - Assessment & Implementation Plan

## Current Model Analysis

### Sessions are Ephemeral (Computed Dynamically)
- Sessions are generated on-the-fly from `user_achievements` and `user_games` tables
- They have a **deterministic `sessionId`** (e.g., `{userId}-{appId}-{timestamp}`)
- Sessions are **NOT persisted** in the database

### Likes Use Hybrid Approach
- Likes are stored in `feed_likes` table keyed by `session_id`
- The `sessionId` acts as a stable identifier even though sessions aren't persisted
- This works because `sessionId` is deterministic

## Can Comments Work in Current Model?

**Short Answer: Yes, but with trade-offs.**

### Option 1: Use `sessionId` as Identifier (Like Likes) ⭐ Recommended for v1

**Pros:**
- ✅ Simple - same pattern as existing likes
- ✅ No schema changes needed for sessions
- ✅ Comments persist across feed rebuilds

**Cons:**
- ⚠️ Fragile - if session generation logic changes, comments might reference orphaned sessions
- ⚠️ No post metadata - can't store post-specific data (e.g., edited timestamps, visibility)
- ⚠️ Session regeneration - if underlying data changes, session might be computed differently, but comments remain

**Implementation:**
```sql
CREATE TABLE feed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

CREATE INDEX idx_feed_comments_session_id ON feed_comments(session_id);
CREATE INDEX idx_feed_comments_user_id ON feed_comments(user_id);
```

### Option 2: Persist Sessions as Posts (More Robust)

**Pros:**
- ✅ Robust - comments reference actual persisted posts
- ✅ Post metadata - can store post-specific data
- ✅ Stability - posts don't change even if underlying data changes
- ✅ Future-proof - enables editing, deletion, moderation

**Cons:**
- ❌ More complex - need to decide when to create posts
- ❌ Storage - need to store session data
- ❌ Sync - need to keep posts in sync with sessions (or accept divergence)

**Implementation:**
```sql
CREATE TABLE feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL UNIQUE, -- Deterministic ID
  user_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  session_start TIMESTAMPTZ NOT NULL,
  session_end TIMESTAMPTZ NOT NULL,
  achievement_count INTEGER NOT NULL,
  playtime_minutes INTEGER,
  -- Store serialized session data or key fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

CREATE TABLE feed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL, -- Reference to feed_posts
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);
```

## Complexity Assessment

### Option 1 (sessionId-based): **Low-Medium Complexity**

**What's Needed:**
1. `feed_comments` table (simple)
2. API endpoints: `POST /api/feed/[sessionId]/comments`, `GET /api/feed/[sessionId]/comments`
3. UI components: Comment input, comment list
4. Feed API update: Include comment counts in feed response

**Estimated Effort:** 2-3 days

**Risks:**
- Session regeneration might create new `sessionId` for same logical session
- Comments might become orphaned if session logic changes

### Option 2 (Persisted Posts): **Medium-High Complexity**

**What's Needed:**
1. `feed_posts` table (new concept)
2. Post creation logic - when to create posts? (on first view? on first like? on first comment?)
3. `feed_comments` table referencing posts
4. API endpoints for posts and comments
5. UI components
6. Feed API update - merge dynamic sessions with persisted posts
7. Deduplication logic - avoid showing same session twice (dynamic + post)

**Estimated Effort:** 5-7 days

**Risks:**
- More moving parts
- Need to handle post creation timing
- Need to handle session/post deduplication

## Recommendation

**Start with Option 1 (sessionId-based) for v1:**

1. **Lower complexity** - similar to existing likes pattern
2. **Faster to implement** - 2-3 days vs 5-7 days
3. **Good enough for MVP** - comments work, even if not perfect
4. **Can migrate later** - if needed, can move to Option 2

**Migration Path:**
- If you later need post persistence, you can:
  1. Create `feed_posts` table
  2. Backfill posts from existing comments (extract `sessionId` → create post)
  3. Update comments to reference posts
  4. Update feed generation to merge posts + sessions

## Implementation Plan (Option 1)

### Phase 1: Database (1 day)
- Create `feed_comments` table
- Add indexes for performance

### Phase 2: API (1 day)
- `POST /api/feed/[sessionId]/comments` - create comment
- `GET /api/feed/[sessionId]/comments` - get comments
- `DELETE /api/feed/[sessionId]/comments/[commentId]` - delete comment
- Update feed API to include comment counts

### Phase 3: UI (1 day)
- Comment input component
- Comment list component
- Integrate into feed card

**Total: ~3 days**

## API Endpoints

### POST /api/feed/[sessionId]/comments
**Auth:** Required  
**Body:**
```json
{
  "content": "Great session!"
}
```
**Response:**
```json
{
  "success": true,
  "comment": {
    "id": "uuid",
    "sessionId": "session-id",
    "userId": "steam-id",
    "content": "Great session!",
    "createdAt": "2026-01-08T12:00:00Z"
  }
}
```

### GET /api/feed/[sessionId]/comments
**Auth:** Required  
**Query Params:** `?limit=20&offset=0`  
**Response:**
```json
{
  "comments": [
    {
      "id": "uuid",
      "userId": "steam-id",
      "username": "username",
      "avatarUrl": "url",
      "content": "Great session!",
      "createdAt": "2026-01-08T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

### DELETE /api/feed/[sessionId]/comments/[commentId]
**Auth:** Required (must be comment owner)  
**Response:**
```json
{
  "success": true
}
```

## Database Schema

### feed_comments Table
```sql
CREATE TABLE feed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(steam_id) ON DELETE CASCADE
);

CREATE INDEX idx_feed_comments_session_id ON feed_comments(session_id);
CREATE INDEX idx_feed_comments_user_id ON feed_comments(user_id);
CREATE INDEX idx_feed_comments_created_at ON feed_comments(created_at DESC);
```

## Edge Cases

### 1. Session Regeneration
- If session logic changes, `sessionId` might change for same logical session
- **Handling:** Accept that old comments might become orphaned (rare edge case)

### 2. Comment Deletion
- User can delete their own comments
- **Handling:** Soft delete or hard delete (recommend hard delete for simplicity)

### 3. Session No Longer Exists
- If underlying data changes, session might not be generated anymore
- **Handling:** Comments remain but won't show in feed (acceptable)

### 4. Concurrent Comments
- Multiple users commenting simultaneously
- **Handling:** Database handles concurrency, use optimistic updates in UI

## Success Criteria

1. ✅ Users can comment on feed sessions
2. ✅ Comments persist across feed rebuilds
3. ✅ Comment counts display in feed
4. ✅ Users can delete their own comments
5. ✅ Comments load efficiently (pagination)

## Future Enhancements

### Phase 2: Advanced Features
- Comment editing
- Comment replies/threading
- Comment moderation
- Comment reactions (like comments)

### Phase 3: Post Persistence (if needed)
- Migrate to Option 2 if stability becomes critical
- Backfill posts from existing comments
- Enable post-level features (editing, deletion, visibility)
