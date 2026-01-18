# Comments Error States - Testing Matrix

This document provides a comprehensive testing guide for all error states in the comments feature, including step-by-step instructions using browser DevTools.

## Table of Contents

1. [Error State Overview](#error-state-overview)
2. [Testing Setup](#testing-setup)
3. [Error Scenarios & Testing](#error-scenarios--testing)
4. [Visual Verification Checklist](#visual-verification-checklist)
5. [Accessibility Testing](#accessibility-testing)

---

## Error State Overview

### Components with Error States

1. **FeedCommentInput** - Comment posting errors
2. **FeedCommentItem** - Edit and delete errors
3. **FeedCommentList** - Fetch errors and empty states

### Error Types

- **Validation Errors**: Content too long, empty content
- **Network Errors**: Failed API requests, timeouts
- **Permission Errors**: Editing/deleting others' comments
- **Server Errors**: 500 errors, database failures
- **Empty States**: No comments available

---

## Testing Setup

### Prerequisites

1. **Browser DevTools** (Chrome/Edge recommended)
   - Press `F12` or `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows)
   - Ensure Network tab is visible

2. **Test Account Setup**
   - Logged-in user account
   - At least one friend with sessions in the feed
   - Some sessions with comments, some without

3. **Network Conditions**
   - Normal connection (baseline)
   - Offline mode (for network errors)
   - Slow 3G (for timeout testing)

---

## Error Scenarios & Testing

### 1. FeedCommentInput Errors

#### 1.1 Empty Content Validation

**Expected Behavior:**
- Submit button is disabled when content is empty
- No error message shown (button disabled prevents submission)

**How to Test:**
1. Navigate to feed page
2. Click comment button on any session
3. Type nothing, try to click "Comment" button
4. **Verify**: Button is disabled (grayed out)

**DevTools Not Required** ✅

---

#### 1.2 Content Too Long (500+ characters)

**Expected Behavior:**
- Error border appears on textarea (`border-input-error`)
- Error message: "Content cannot exceed 500 characters"
- Character counter shows red when over limit
- Submit button disabled

**How to Test:**
1. Open comment input
2. Type or paste content exceeding 500 characters
3. **Verify**:
   - Textarea border turns red (`border-input-error`)
   - Error message appears below input in red (`text-destructive`)
   - Character counter shows: `501 / 500` in red
   - "Comment" button is disabled

**DevTools Not Required** ✅

**Quick Test Method:**
```javascript
// Paste in console to fill textarea
document.querySelector('textarea[aria-label="Add a comment"]').value = 'a'.repeat(501);
document.querySelector('textarea[aria-label="Add a comment"]').dispatchEvent(new Event('input', { bubbles: true }));
```

---

#### 1.3 Network Error on Post

**Expected Behavior:**
- Error message appears below input: "Failed to post comment. Please try again."
- Error persists until user starts typing again
- Input remains expanded with content preserved

**How to Test (Chrome DevTools):**

**Method 1: Block Request URL**
1. Open DevTools → Network tab
2. Right-click on any request to `/api/feed/*/comments`
3. Select "Block request URL"
4. Type a comment and click "Comment"
5. **Verify**:
   - Error message appears: "Failed to post comment. Please try again."
   - Message is in red (`text-destructive`)
   - Content remains in textarea
   - Error clears when you start typing

**Method 2: Offline Mode**
1. Open DevTools → Network tab
2. Click "Throttling" dropdown → Select "Offline"
3. Type a comment and click "Comment"
4. **Verify**: Same as Method 1

**Method 3: Simulate 500 Error**
1. Open DevTools → Network tab
2. Right-click → "Block request URL" for `/api/feed/*/comments`
3. Or use "Request blocking" → Add pattern: `*/api/feed/*/comments`
4. Try to post comment
5. **Verify**: Error message appears

**Cleanup:**
- Remove block or set throttling back to "No throttling"

---

#### 1.4 Character Counter (400+ characters)

**Expected Behavior:**
- Character counter appears when content > 400 characters
- Counter shows: `{count} / 500`
- Counter turns red when > 500 characters

**How to Test:**
1. Open comment input
2. Type 401 characters
3. **Verify**: Counter appears below textarea: `401 / 500` in `text-text-subdued`
4. Type to 501 characters
5. **Verify**: Counter turns red (`text-destructive`)

**DevTools Not Required** ✅

---

### 2. FeedCommentItem Errors

#### 2.1 Edit: Content Too Long

**Expected Behavior:**
- Error border on textarea
- Error message: "Content cannot exceed 500 characters"
- Character counter shows red
- Save button disabled

**How to Test:**
1. Find a comment you own
2. Click overflow menu (⋮) → "Edit"
3. Type or paste 501+ characters
4. **Verify**:
   - Textarea border turns red
   - Error message appears below textarea
   - Character counter shows red
   - Save button disabled

**DevTools Not Required** ✅

---

#### 2.2 Edit: Network Error

**Expected Behavior:**
- Error message appears below textarea: "Failed to update comment. Please try again."
- Edit mode remains open (user can retry)
- Error clears when user starts typing

**How to Test:**
1. Open DevTools → Network tab
2. Block request URL: `/api/feed/*/comments/*` (PUT method)
3. Edit a comment you own
4. Make changes and click "Save"
5. **Verify**:
   - Error message appears in red
   - Edit mode stays open
   - Content preserved
   - Error clears when typing

**Cleanup:**
- Remove block

---

#### 2.3 Edit: Permission Error (403)

**Expected Behavior:**
- Error message: "You can only edit your own comments"
- Edit mode remains open

**How to Test:**
1. **Note**: This requires API modification or two accounts
2. **Alternative**: Temporarily modify API to return 403
3. Try to edit someone else's comment
4. **Verify**: Permission error message appears

**Advanced Test (API Modification):**
```typescript
// Temporarily in comment API route
if (comment.userId !== userId) {
  return ApiErrors.forbidden("You can only edit your own comments");
}
```

---

#### 2.4 Edit: Concurrent Edit Conflict

**Expected Behavior:**
- Error message: "Comment was updated. Please refresh."
- Edit mode remains open

**How to Test:**
1. Open same comment in two browser tabs
2. Edit in Tab 1, save successfully
3. Edit in Tab 2, try to save
4. **Verify**: Conflict error message appears

**Note**: Requires API to detect concurrent edits (may need implementation)

---

#### 2.5 Delete: Network Error

**Expected Behavior:**
- Error message appears in AlertDialog
- Dialog remains open (user can retry)
- "Delete" button still functional

**How to Test:**
1. Open DevTools → Network tab
2. Block request URL: `/api/feed/*/comments/*` (DELETE method)
3. Click overflow menu → "Delete"
4. Confirm deletion in dialog
5. **Verify**:
   - Error message appears in dialog (above buttons)
   - Message is in red (`text-destructive`)
   - Dialog stays open
   - Can retry or cancel

**Cleanup:**
- Remove block

---

#### 2.6 Delete: Permission Error (403)

**Expected Behavior:**
- Error message: "You can only delete your own comments"
- Dialog remains open

**How to Test:**
1. **Note**: Requires API modification or two accounts
2. Try to delete someone else's comment
3. **Verify**: Permission error in dialog

---

### 3. FeedCommentList Errors

#### 3.1 Fetch Error (Network Failure)

**Expected Behavior:**
- Alert component with error message
- "Try Again" button
- Error message: "Failed to load comments. Please try again."

**How to Test:**
1. Open DevTools → Network tab
2. Block request URL: `/api/feed/*/comments` (GET method)
3. Click comment button to open comments
4. **Verify**:
   - Alert component appears with red/destructive styling
   - Error message displayed
   - "Try Again" button visible
   - Clicking "Try Again" retries the request

**Cleanup:**
- Remove block
- Click "Try Again" to verify recovery

---

#### 3.2 Fetch Error (500 Server Error)

**Expected Behavior:**
- Same as 3.1, but with server error message

**How to Test:**
1. **Option 1**: Temporarily break API endpoint
2. **Option 2**: Use DevTools → Network → Right-click request → "Override content"
   - Set status to 500
   - Set response body: `{"error": {"message": "Internal server error"}}`
3. Open comments
4. **Verify**: Error message from API response

---

#### 3.3 Empty State

**Expected Behavior:**
- Message: "No comments yet"
- Centered in comment list area
- Styled with `text-text-subdued`

**How to Test:**
1. Find a session with 0 comments
2. Click comment button
3. **Verify**:
   - "No comments yet" message appears
   - Centered vertically and horizontally
   - Gray/subdued text color
   - No skeleton loader

**DevTools Not Required** ✅

---

#### 3.4 Load More Error

**Expected Behavior:**
- Error message appears below comment list
- "Load More" button remains (can retry)

**How to Test:**
1. Find a session with 20+ comments
2. Open comments (first 20 load)
3. Open DevTools → Network tab
4. Block request URL: `/api/feed/*/comments?offset=20`
5. Click "Load More"
6. **Verify**: Error message appears (may need implementation)

**Note**: This may need additional error handling in `handleLoadMore`

---

## Visual Verification Checklist

### Theme Styling Verification

For each error state, verify:

- [ ] **Error Text Color**: Uses `text-destructive` (red)
- [ ] **Error Border**: Uses `border-input-error` (red border)
- [ ] **Error Background**: Alert uses `bg-surface-alert` or `variant="destructive"`
- [ ] **Spacing**: Error messages have appropriate margin (`mt-0` or `gap-2`)
- [ ] **Typography**: Error text uses `text-xs` or `text-sm`
- [ ] **Focus States**: Error inputs maintain focus ring styling

### Component-Specific Checks

#### FeedCommentInput
- [ ] Error message appears below textarea (not inside)
- [ ] Character counter appears when > 800 chars
- [ ] Counter turns red when > 500 chars
- [ ] Error border on textarea container
- [ ] Error clears when user types

#### FeedCommentItem
- [ ] Edit error appears below textarea
- [ ] Delete error appears in AlertDialog (above buttons)
- [ ] Error persists until user action
- [ ] Edit mode remains open on error

#### FeedCommentList
- [ ] Fetch error uses Alert component
- [ ] "Try Again" button styled correctly
- [ ] Empty state centered and subdued
- [ ] No skeleton when error occurs

---

## Accessibility Testing

### Screen Reader Testing

1. **Enable Screen Reader** (VoiceOver on Mac, NVDA on Windows)
2. Test each error scenario
3. **Verify**:
   - Error messages are announced
   - `aria-invalid="true"` on error inputs
   - `aria-describedby` links error message to input
   - `role="alert"` on dynamic error messages

### Keyboard Navigation

1. **Tab through error states**
2. **Verify**:
   - Focus moves logically through inputs and buttons
   - Error messages don't trap focus
   - "Try Again" button is keyboard accessible
   - AlertDialog can be dismissed with Escape

### Color Contrast

1. **Verify error text contrast**:
   - `text-destructive` on `bg-background` or `bg-surface-low`
   - Meets WCAG AA (4.5:1) minimum
   - Meets WCAG AAA (7:1) for small text

2. **Verify error border visibility**:
   - `border-input-error` is clearly visible
   - Distinguishable from normal border

---

## Quick Reference: DevTools Commands

### Chrome/Edge DevTools

**Block Request:**
1. Network tab → Right-click request → "Block request URL"
2. Or: Network tab → "Request blocking" → Add pattern

**Offline Mode:**
1. Network tab → Throttling dropdown → "Offline"

**Override Response:**
1. Network tab → Right-click request → "Override content"
2. Set status code and response body

**Clear Blocks:**
1. Network tab → "Request blocking" → Remove patterns
2. Or: Right-click blocked request → "Unblock"

### Firefox DevTools

**Block Request:**
1. Network tab → Right-click request → "Block URL"

**Offline Mode:**
1. Network tab → "Work Offline" checkbox

---

## Testing Checklist Summary

### FeedCommentInput
- [ ] Empty content validation (button disabled)
- [ ] Content too long (500+ chars)
- [ ] Network error on post
- [ ] Character counter (800+ chars)
- [ ] Error clears on typing

### FeedCommentItem
- [ ] Edit: Content too long
- [ ] Edit: Network error
- [ ] Edit: Permission error (if applicable)
- [ ] Edit: Concurrent edit conflict (if applicable)
- [ ] Delete: Network error
- [ ] Delete: Permission error (if applicable)

### FeedCommentList
- [ ] Fetch error (network failure)
- [ ] Fetch error (500 server error)
- [ ] Empty state (0 comments)
- [ ] Load more error (if applicable)

### Visual & Accessibility
- [ ] All errors use theme colors
- [ ] Error messages are accessible
- [ ] Keyboard navigation works
- [ ] Screen reader announces errors
- [ ] Color contrast meets WCAG AA

---

## Notes

- **Error Persistence**: Most errors clear when user starts typing/editing
- **Retry Logic**: Network errors allow retry without losing content
- **Theme Consistency**: All errors use `text-destructive` and `border-input-error`
- **User Experience**: Errors are non-blocking where possible (edit mode stays open)

---

## Troubleshooting

### Error Not Appearing
1. Check browser console for JavaScript errors
2. Verify API endpoint is being called
3. Check Network tab for request status
4. Verify error state is being set in component

### Theme Colors Not Applied
1. Check `tailwind.config.ts` for `input-error` token
2. Verify `globals.css` has `--color-input-error` defined
3. Check component uses `border-input-error` class
4. Verify `text-destructive` is available

### DevTools Block Not Working
1. Ensure request URL pattern matches exactly
2. Check if request is cached (disable cache)
3. Try "Request blocking" feature instead
4. Verify you're blocking the correct HTTP method (GET/POST/PUT/DELETE)

---

**Last Updated**: 2026-01-17
**Version**: 1.0
