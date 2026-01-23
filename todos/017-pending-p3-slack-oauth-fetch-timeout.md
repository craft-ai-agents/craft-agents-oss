---
status: pending
priority: p3
issue_id: "017"
tags: [code-review, performance, slack-oauth, network]
dependencies: []
---

# Network Requests Without Timeout

## Problem Statement

The `fetch` calls in `exchangeCodeForTokens` and `refreshSlackToken` have no timeout. If Slack's token endpoint is slow or unresponsive, these requests could hang indefinitely.

**Why it matters:** Hung network requests block the OAuth flow and provide poor user experience. Users may think the app has frozen.

## Findings

### Evidence

**Token exchange (lines 126-133):**
```typescript
const response = await fetch(SLACK_TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${authHeader}`,
  },
  body: params.toString(),
});  // No timeout!
```

**Token refresh (lines 184-191):**
```typescript
const response = await fetch(SLACK_TOKEN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${authHeader}`,
  },
  body: params.toString(),
});  // No timeout!
```

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Lines: 126-133, 184-191

## Proposed Solutions

### Solution A: Use AbortController (Recommended)

**Description:** Add timeout using AbortController.

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

try {
  const response = await fetch(SLACK_TOKEN_URL, {
    signal: controller.signal,
    method: 'POST',
    headers: { ... },
    body: params.toString(),
  });
  // ... handle response
} finally {
  clearTimeout(timeout);
}
```

**Pros:**
- Standard fetch timeout pattern
- Works in all environments

**Cons:**
- More boilerplate

**Effort:** Small
**Risk:** Very Low

### Solution B: Create Shared fetchWithTimeout Utility

**Description:** Create utility function for reuse.

```typescript
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
```

**Pros:**
- Reusable across all OAuth modules

**Cons:**
- Additional utility to maintain

**Effort:** Medium
**Risk:** Very Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- Token exchange
- Token refresh

### Database Changes

None required.

## Acceptance Criteria

- [ ] Token exchange has reasonable timeout (30s suggested)
- [ ] Token refresh has reasonable timeout (30s suggested)
- [ ] Timeout errors are caught and produce clear error messages

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Apply to Google/Microsoft OAuth too |

## Resources

- MDN AbortController documentation
- Node.js fetch timeout patterns
