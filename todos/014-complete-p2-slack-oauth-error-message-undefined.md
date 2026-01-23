---
status: complete
priority: p2
issue_id: "014"
tags: [code-review, quality, slack-oauth, error-handling]
dependencies: []
---

# Inconsistent Error Message Handling in refreshSlackToken

## Problem Statement

The `refreshSlackToken` function produces confusing error messages when `data.error` is undefined. The error message reads "Failed to refresh Slack token: undefined" instead of a helpful message.

**Why it matters:** Error messages are critical for debugging. "undefined" in an error message is confusing and unhelpful for users and developers.

## Findings

### Evidence

**Token refresh (line 201) - inconsistent:**
```typescript
throw new Error(`Failed to refresh Slack token: ${data.error}`);
// When data.error is undefined: "Failed to refresh Slack token: undefined"
```

**Token exchange (line 149) - correct pattern:**
```typescript
throw new Error(`Slack token exchange failed: ${data.error || 'Unknown error'}`);
// When data.error is undefined: "Slack token exchange failed: Unknown error"
```

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Line: 201

## Proposed Solutions

### Solution A: Add Fallback (Recommended)

**Description:** Add fallback string for undefined error.

```typescript
throw new Error(`Failed to refresh Slack token: ${data.error || 'Unknown error'}`);
```

**Pros:**
- Simple fix
- Consistent with token exchange pattern

**Cons:**
- None

**Effort:** Trivial
**Risk:** None

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- Token refresh error handling

### Database Changes

None required.

## Acceptance Criteria

- [ ] Error message at line 201 has fallback for undefined error
- [ ] Pattern is consistent with line 149

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Always add fallback for optional error strings |

## Resources

- Token exchange error handling for reference pattern
