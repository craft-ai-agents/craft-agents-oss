---
status: complete
priority: p2
issue_id: "012"
tags: [code-review, performance, slack-oauth, resource-leak]
dependencies: []
---

# Callback Server Not Cleaned Up on Error Paths

## Problem Statement

The `startSlackOAuth` function creates a callback server at line 274 but has no `finally` block to ensure cleanup. If any error occurs between server creation and callback completion, the server is never closed, leaking the port.

**Why it matters:** While the callback server auto-closes after receiving a callback, errors before that point leave the server running indefinitely.

## Findings

### Evidence

**Current code (lines 272-297):**
```typescript
// Start local HTTP callback server
const appType = options.appType || 'electron';
const callbackServer = await createCallbackServer({ appType });  // Server created

// ... various operations that could throw ...

const localUrl = new URL(callbackServer.url);  // Could throw on malformed URL
const port = localUrl.port;

const redirectUri = `https://agents.craft.do/auth/slack/callback?port=${port}`;

const authUrl = new URL(SLACK_AUTH_URL);
// ... URL construction could throw ...

await open(authUrl.toString());  // Could throw if browser fails to open

const callback = await callbackServer.promise;  // Only auto-closes after callback

// State mismatch, error, or missing code all return early without cleanup
if (callback.query.state !== state) {
  return { success: false, error: '...' };  // Server still running!
}
```

**Error scenarios where server leaks:**
1. URL parsing failure (line 277)
2. Browser open failure (line 294)
3. State mismatch (lines 299-305) - callback received but function returns early
4. Token exchange failure (line 325)

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Lines: 272-342 (entire startSlackOAuth function)

## Proposed Solutions

### Solution A: Wrap in try/finally (Recommended)

**Description:** Use try/finally pattern to ensure cleanup.

```typescript
const callbackServer = await createCallbackServer({ appType });
try {
  // ... existing OAuth flow logic ...
  return {
    success: true,
    accessToken: tokens.accessToken,
    // ...
  };
} catch (error) {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
} finally {
  callbackServer.close();
}
```

**Pros:**
- Guaranteed cleanup in all paths
- Simple pattern

**Cons:**
- Server closes even on success (but that's OK since callback already received)

**Effort:** Small
**Risk:** Very Low

### Solution B: Early Return Cleanup

**Description:** Add explicit `callbackServer.close()` before each early return.

**Pros:**
- More targeted

**Cons:**
- Easy to miss a path
- More code duplication

**Effort:** Medium
**Risk:** Medium (might miss paths)

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- OAuth flow resource management
- Port availability

### Database Changes

None required.

## Acceptance Criteria

- [ ] Callback server is closed in all code paths
- [ ] Use try/finally pattern for guaranteed cleanup
- [ ] Test error scenarios verify server is cleaned up

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Google OAuth has same issue |

## Resources

- JavaScript try/finally pattern documentation
