---
status: complete
priority: p1
issue_id: "010"
tags: [code-review, security, slack-oauth, error-handling]
dependencies: []
---

# Missing HTTP Status Check Before JSON Parsing

## Problem Statement

Both `exchangeCodeForTokens` and `refreshSlackToken` functions parse JSON responses without first checking the HTTP status code. If the HTTP request fails (500 error, network error, etc.), `response.json()` may fail with an unhelpful error or return unexpected data structure.

**Why it matters:** Network failures, server errors, and rate limiting produce HTTP error codes. Without checking `response.ok` first, these conditions produce cryptic JSON parsing errors instead of clear HTTP error messages.

## Findings

### Evidence

**Slack OAuth - Token Exchange (lines 126-147):**
```typescript
const response = await fetch(SLACK_TOKEN_URL, {
  method: 'POST',
  // ...
});

const data = (await response.json()) as {...};  // No HTTP status check!

if (!data.ok) {  // This checks Slack's response field, not HTTP status
  throw new Error(`Slack token exchange failed: ${data.error || 'Unknown error'}`);
}
```

**Slack OAuth - Token Refresh (lines 184-202):**
```typescript
const response = await fetch(SLACK_TOKEN_URL, {
  method: 'POST',
  // ...
});

const data = (await response.json()) as {...};  // No HTTP status check!

if (!data.ok) {
  throw new Error(`Failed to refresh Slack token: ${data.error}`);
}
```

**Google OAuth - Better Pattern (lines 125-128):**
```typescript
if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Token exchange failed: ${errorText}`);
}
// Then parse JSON safely
```

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Lines: 126-147 (exchangeCodeForTokens), 184-202 (refreshSlackToken)

## Proposed Solutions

### Solution A: Add HTTP Status Check (Recommended)

**Description:** Check `response.ok` before parsing JSON, following Google OAuth pattern.

**Token Exchange Fix:**
```typescript
const response = await fetch(SLACK_TOKEN_URL, {...});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Slack token exchange failed (HTTP ${response.status}): ${errorText}`);
}

const data = (await response.json()) as {...};

if (!data.ok) {
  throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
}
```

**Token Refresh Fix:**
```typescript
const response = await fetch(SLACK_TOKEN_URL, {...});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Slack token refresh failed (HTTP ${response.status}): ${errorText}`);
}

const data = (await response.json()) as {...};

if (!data.ok) {
  throw new Error(`Slack API error: ${data.error || 'Unknown error'}`);
}
```

**Pros:**
- Clear distinction between HTTP errors and Slack API errors
- Follows Google OAuth pattern for consistency
- Better debugging experience

**Cons:**
- Slightly more code

**Effort:** Small
**Risk:** Very Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- Token exchange functionality
- Token refresh functionality

### Database Changes

None required.

## Acceptance Criteria

- [ ] `exchangeCodeForTokens` checks `response.ok` before parsing JSON
- [ ] `refreshSlackToken` checks `response.ok` before parsing JSON
- [ ] HTTP errors produce clear error messages with status code
- [ ] Slack API errors (ok: false) are still handled separately

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Always check HTTP status before parsing response |

## Resources

- Google OAuth implementation for reference pattern
- MDN Fetch API: `response.ok`
