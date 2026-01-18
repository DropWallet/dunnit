# Comments Feature - UI Specification

## Overview

This document provides the complete UI specification for the comments feature on feed sessions. Comments allow users to engage with friend activity, with support for creating, editing, and deleting comments.

## Component Hierarchy

```
FeedSessionCard
└── FeedComments
    ├── FeedCommentInput (always visible)
    └── FeedCommentList
        └── FeedCommentItem (repeated)
            ├── CommentHeader (avatar, username, time, edited badge)
            ├── CommentContent (text, or textarea if editing)
            └── CommentActions (Edit/Delete buttons, only if owner)
```

---

## 1. FeedComments Component

**Location:** Below the like button section in `FeedSessionCard`

### Layout Structure

```
┌─────────────────────────────────────────┐
│ [Like Button Section]                   │
├─────────────────────────────────────────┤
│ Comments Section                        │
│ ┌─────────────────────────────────────┐ │
│ │ 💬 3 comments                    [▼] │ ← Header (clickable to expand)
│ └─────────────────────────────────────┘ │
│                                         │
│ [Comment Input - Always visible]        │
│ ┌─────────────────────────────────────┐ │
│ │ [Avatar] [Text input...] [Post]    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Comment List - Expandable]             │
│ ┌─────────────────────────────────────┐ │
│ │ Comment 1                           │ │
│ │ Comment 2                           │ │
│ │ Comment 3                           │ │
│ │ [Load More] (if > limit)            │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Props

```typescript
interface FeedCommentsProps {
  sessionId: string;
  commentCount: number;
  currentUserId?: string; // For showing edit/delete buttons
}
```

### States

- **Collapsed (default)**: Show header + input only
- **Expanded**: Show header + input + comment list
- **Loading**: Show skeleton loaders
- **Empty**: Show "No comments yet" message

### Behavior

- Click header to expand/collapse comments
- Input always visible (even when collapsed)
- Auto-expand when comment is posted
- Show "Load More" if total > displayed comments
- Scroll to new comment after posting

---

## 2. FeedCommentInput Component

### Layout

```
┌─────────────────────────────────────────┐
│ [Avatar] [Textarea...] [Post Button]    │
└─────────────────────────────────────────┘
```

### Specifications

**Avatar:**
- Size: 32x32px
- Shape: Circular
- Source: Current user's avatar
- Border: `border-border-weak`
- Fallback: Default avatar SVG

**Textarea:**
- Placeholder: "Add a comment..."
- Max height: 120px (auto-expand)
- Max length: 1000 characters
- Character counter: Show at 900+ characters (optional)
- Border: `border-border-weak`
- Background: `bg-surface-low`
- Text color: `text-text-strong`
- Padding: `px-3 py-2`
- Border radius: `rounded-lg`
- Focus: `focus:outline-none focus:ring-2 focus:ring-primary`

**Post Button:**
- Only enabled when text length > 0
- Disabled state: `opacity-50 cursor-not-allowed`
- Loading state: Show spinner, disable input
- Colors: Use primary button style (`bg-primary text-text-inverted-strong`)
- Size: Match textarea height
- Border radius: `rounded-lg`

### States

- **Default**: Empty textarea, disabled button
- **Typing**: Enabled button, show character count if needed
- **Submitting**: Loading spinner, disabled input
- **Success**: Clear textarea, show success state briefly
- **Error**: Show error message below input

### Behavior

- Optimistic update: Add comment to list immediately
- On success: Clear input, scroll to new comment
- On error: Show error, keep input text
- Auto-focus on expand (optional)

---

## 3. FeedCommentItem Component

### Layout

```
┌─────────────────────────────────────────┐
│ [Avatar] Username · 2h ago [Edited]    │ ← Header
│                                         │
│ Comment text content here...           │ ← Content (or textarea if editing)
│                                         │
│ [Edit] [Delete]                         │ ← Actions (only if owner)
└─────────────────────────────────────────┘
```

### Specifications

**Header:**
- Avatar: 32x32px, circular, link to user profile
- Username: `text-text-strong`, `font-medium`, link to profile
- Time: `text-text-subdued`, `text-xs`, relative time ("2h ago")
- Edited badge: `text-text-subdued`, `text-xs`, italic "(edited)" - only if `isEdited`

**Content:**
- Text: `text-text-strong`, `text-sm`
- Line height: `leading-relaxed`
- Word wrap: `break-words`
- Edit mode: Replace with textarea (same styling as input)

**Actions (Edit/Delete):**
- Only visible if `comment.userId === currentUserId`
- Edit button:
  - Text: "Edit"
  - Style: Text button, `text-text-subdued hover:text-text-strong`
  - Click: Switch to edit mode
- Delete button:
  - Text: "Delete"
  - Style: Text button, `text-text-subdued hover:text-destructive`
  - Click: Show confirmation dialog

### Edit Mode

- Replace content with textarea
- Show "Save" and "Cancel" buttons
- Save: Update comment, switch back to view mode
- Cancel: Discard changes, switch back to view mode
- Optimistic update: Update comment in list immediately

### Delete Flow

1. Click Delete
2. Show confirmation dialog:
   ```
   ┌──────────────────────────────┐
   │ Delete comment?              │
   │                              │
   │ This action cannot be undone.│
   │                              │
   │ [Cancel] [Delete]            │
   └──────────────────────────────┘
   ```
3. On confirm: Optimistic remove from list, call API
4. On error: Restore comment, show error message

---

## 4. FeedCommentList Component

### Layout

```
┌─────────────────────────────────────────┐
│ Comment 1 (newest)                     │
│ Comment 2                               │
│ Comment 3                               │
│ Comment 4 (oldest)                      │
│                                         │
│ [Load More Comments] (if hasMore)      │
└─────────────────────────────────────────┘
```

### Specifications

- Order: Newest first (`created_at DESC`)
- Spacing: `gap-3` between comments
- Load More:
  - Only show if `hasMore === true`
  - Button style: Text button, centered
  - Loading: Show spinner, disable button
  - Load: Fetch next page, append to list

### Empty State

```
┌─────────────────────────────────────────┐
│ No comments yet                          │
│ Be the first to comment!                 │
└─────────────────────────────────────────┘
```

- Text: `text-text-subdued`, `text-sm`, centered
- Padding: `py-8`

---

## 5. Comments Header (in FeedComments)

### Layout

```
┌─────────────────────────────────────────┐
│ 💬 3 comments                    [▼]    │ ← Collapsed
│                                         │
│ 💬 3 comments                    [▲]    │ ← Expanded
└─────────────────────────────────────────┘
```

### Specifications

- Icon: Comment icon (💬 or SVG)
- Count: `text-text-strong`, `font-medium`
- Toggle: Chevron icon (▼/▲), `text-text-subdued`
- Clickable: Entire row is clickable
- Hover: `hover:bg-surface-mid` (subtle)
- Padding: `py-2 px-0`

---

## 6. Integration in FeedSessionCard

**Location:** After the like button section, before the achievements section

**Code structure:**
```tsx
<FeedSessionCard>
  {/* Existing content */}
  
  {/* Like Button Section */}
  <FeedLikeButton session={session} />
  
  {/* Comments Section */}
  <FeedComments 
    sessionId={session.sessionId}
    commentCount={session.commentCount}
    currentUserId={currentUser?.steamId}
  />
  
  {/* Rest of content */}
</FeedSessionCard>
```

---

## Styling Guidelines

### Theme Tokens

**Backgrounds:**
- `bg-surface-low` - Comment input, comment items
- `bg-surface-mid` - Hover states
- `bg-surface-high` - Active states
- `bg-background` - Page background

**Borders:**
- `border-border-weak` - Input borders, subtle dividers
- `border-border-strong` - Focus states

**Text:**
- `text-text-strong` - Primary text (usernames, content)
- `text-text-subdued` - Secondary text (timestamps, edited badge)
- `text-text-moderate` - Medium emphasis
- `text-destructive` - Delete button hover

**Interactive:**
- Use existing button styles from `Button` component
- Primary actions: `bg-primary text-text-inverted-strong`
- Text buttons: `text-text-subdued hover:text-text-strong`

### Spacing

- Section gap: `gap-4` (between like button and comments)
- Comment gap: `gap-3` (between comments)
- Input padding: `px-3 py-2`
- Component padding: Match existing card padding

### Responsive

- Mobile: Full width, same layout
- Desktop: Same layout (no changes needed)

---

## User Flows

### Flow 1: Post Comment

1. User clicks comment input
2. Types comment
3. Clicks "Post"
4. Optimistic: Comment appears in list immediately
5. API call in background
6. On success: Comment persists, input clears
7. On error: Show error, keep comment in input

### Flow 2: Edit Comment

1. User clicks "Edit" on their comment
2. Comment switches to edit mode (textarea)
3. User modifies text
4. User clicks "Save"
5. Optimistic: Comment updates in list
6. API call in background
7. On success: Shows "edited" badge
8. On error: Revert to original, show error

### Flow 3: Delete Comment

1. User clicks "Delete" on their comment
2. Confirmation dialog appears
3. User confirms
4. Optimistic: Comment removed from list
5. API call in background
6. On success: Comment stays removed
7. On error: Restore comment, show error

### Flow 4: Load More Comments

1. User scrolls to bottom of comment list
2. Clicks "Load More"
3. Loading state: Show spinner
4. Fetch next page
5. Append comments to list
6. Hide "Load More" if no more comments

---

## Edge Cases

### 1. Empty Content
- Disable post button
- Show validation message: "Content cannot be empty"

### 2. Content Too Long
- Show character limit: "Content cannot exceed 1000 characters"
- Disable post button
- Highlight textarea border in error color

### 3. Network Error
- Show error message below input: "Failed to post comment. Please try again."
- Keep input text
- Allow retry

### 4. Comment Deleted by Another User
- Remove from list on next fetch
- Show toast: "A comment was deleted"

### 5. Concurrent Edits
- Last write wins
- Show error if conflict: "Comment was updated. Please refresh."

### 6. Session Deleted
- Comments remain but won't show in feed
- Handle gracefully in UI (don't show comments section)

### 7. User Deleted
- Comments remain but show "Deleted User"
- Use fallback avatar
- Username: "Deleted User" or empty

---

## Component Files

### Files to Create

1. `components/feed-comments.tsx` - Main comments section
2. `components/feed-comment-item.tsx` - Individual comment
3. `components/feed-comment-input.tsx` - Comment input field

### Files to Update

1. `components/feed-session-card.tsx` - Add FeedComments component

---

## API Integration

### Endpoints Used

- `GET /api/feed/[sessionId]/comments?limit=20&offset=0` - Fetch comments
- `POST /api/feed/[sessionId]/comments` - Create comment
- `PUT /api/feed/[sessionId]/comments/[commentId]` - Update comment
- `DELETE /api/feed/[sessionId]/comments/[commentId]` - Delete comment

### Response Formats

**GET Comments:**
```typescript
{
  comments: Comment[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
```

**POST Comment:**
```typescript
{
  success: true;
  comment: Comment;
}
```

**PUT Comment:**
```typescript
{
  success: true;
  comment: Comment;
}
```

**DELETE Comment:**
```typescript
{
  success: true;
}
```

---

## Success Criteria

- [ ] Users can post comments on feed sessions
- [ ] Comments persist and display correctly
- [ ] Users can edit their own comments
- [ ] Users can delete their own comments
- [ ] Comment counts display in feed
- [ ] Optimistic updates work smoothly
- [ ] Error handling is robust
- [ ] UI matches existing design system
- [ ] Responsive on mobile and desktop
- [ ] Comments work for users who haven't signed up

---

## Design Notes

- Follow existing feed card styling patterns
- Match like button interaction patterns
- Use consistent spacing with rest of feed
- Ensure accessibility (keyboard navigation, screen readers)
- Consider dark/light mode compatibility
- Smooth transitions for expand/collapse
- Loading states should be subtle and non-intrusive
