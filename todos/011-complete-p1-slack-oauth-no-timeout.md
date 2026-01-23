---
status: complete
priority: p1
issue_id: "011"
tags: [code-review, performance, slack-oauth, resource-leak]
dependencies: []
---

# No Timeout on OAuth Callback Wait - Potential Resource Leak

## Problem Statement

The `startSlackOAuth` function awaits `callbackServer.promise` indefinitely (line 297). If the user closes their browser, abandons the OAuth flow, or the callback never arrives, the Promise will hang forever, causing:
- Memory leak (callback server remains allocated)
- Port remains occupied (range 6477-6576)
- The calling code blocks indefinitely

**Why it matters:** This is a resource leak that can exhaust available ports and memory over time if OAuth flows are frequently abandoned.

## Findings

### Evidence

**Current code (line 297):**
```typescript
// Wait for callback - NO TIMEOUT!
const callback = await callbackServer.promise;
```

**The callback server is created at line 274:**
```typescript
const callbackServer = await createCallbackServer({ appType });
```

**Port allocation range from callback-server.ts (lines 8-9):**
```typescript
const START_PORT = 6477;
const MAX_PORT_ATTEMPTS = 100;  // 100 ports max
```

### Impact Analysis

If users abandon OAuth flows:
1. Each abandoned flow holds a port (6477-6576 range = 100 ports max)
2. After 100 abandoned flows, no more OAuth flows can start
3. Memory for server instances accumulates

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Line: 297

## Proposed Solutions

### Solution A: Add Timeout with Promise.race (Recommended)

**Description:** Wrap the callback promise with a timeout.

```typescript
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const callback = await Promise.race([
  callbackServer.promise,
  new Promise<never>((_, reject) =>
    setTimeout(() => {
      callbackServer.close();  // Clean up!
      reject(new Error('OAuth timeout - authorization was not completed within 5 minutes'));
    }, OAUTH_TIMEOUT_MS)
  )
]);
```

**Pros:**
- Prevents indefinite blocking
- Automatic cleanup on timeout
- Clear error message

**Cons:**
- Users with slow connections might timeout

**Effort:** Small
**Risk:** Low

### Solution B: Configurable Timeout in Options

**Description:** Add `timeoutMs` option to `SlackOAuthOptions`.

```typescript
export interface SlackOAuthOptions {
  service?: SlackService;
  userScopes?: string[];
  appType?: AppType;
  timeoutMs?: number;  // Default: 5 minutes
}
```

**Pros:**
- Flexible for different use cases
- Allows longer timeouts when needed

**Cons:**
- More API surface

**Effort:** Medium
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`
- Potentially `SlackOAuthOptions` interface

### Components Impacted

- OAuth flow completion
- Resource management

### Database Changes

None required.

## Acceptance Criteria

- [ ] OAuth flow has a reasonable timeout (suggest 5 minutes)
- [ ] Timeout cleans up callback server resources
- [ ] Timeout produces clear error message
- [ ] Normal OAuth flows still complete successfully

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Google OAuth has same issue - fix both |

## Resources

- MDN Promise.race documentation
- Google OAuth has same issue for future consistency
