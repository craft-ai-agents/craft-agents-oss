---
status: complete
priority: p1
issue_id: "009"
tags: [code-review, security, slack-oauth, type-safety]
dependencies: []
---

# Non-null Assertion on Potentially Undefined Access Token

## Problem Statement

The `refreshSlackToken` function uses a TypeScript non-null assertion (`!`) on `data.access_token` at line 205 without proper runtime validation. This bypasses TypeScript's null checking and could result in returning `undefined` as an access token if Slack's API returns an unexpected response.

**Why it matters:** If `data.ok` is true but `data.access_token` is undefined (edge case or API change), this will silently pass `undefined` as the access token, potentially causing cryptic downstream failures in code that expects a valid token string.

## Findings

### Evidence

**Current code (line 205):**
```typescript
return {
  accessToken: data.access_token!,  // Dangerous non-null assertion
  expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
};
```

**Type definition shows access_token is optional (lines 193-198):**
```typescript
const data = (await response.json()) as {
  ok: boolean;
  error?: string;
  access_token?: string;  // Optional!
  expires_in?: number;
};
```

**The code only checks `data.ok` before using the token (line 200-202):**
```typescript
if (!data.ok) {
  throw new Error(`Failed to refresh Slack token: ${data.error}`);
}
// No validation that access_token exists before returning
```

### Comparison

The token exchange function handles this correctly with explicit validation:
```typescript
// Lines 152-155
if (!data.authed_user?.access_token) {
  throw new Error('No user access token received. Make sure user_scope is set in the OAuth request.');
}
```

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Line: 205

## Proposed Solutions

### Solution A: Add Explicit Validation Before Return (Recommended)

**Description:** Add a runtime check that throws if access_token is missing.

```typescript
if (!data.access_token) {
  throw new Error('Token refresh succeeded but no access_token returned');
}

return {
  accessToken: data.access_token,
  expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
};
```

**Pros:**
- Clear, descriptive error message
- Consistent with pattern in `exchangeCodeForTokens`
- No runtime overhead in happy path

**Cons:**
- None

**Effort:** Small
**Risk:** Very Low

### Solution B: Use Nullish Coalescing with Throw

**Description:** Use nullish coalescing operator to provide a default or throw.

```typescript
const accessToken = data.access_token ?? (() => {
  throw new Error('No access_token in refresh response');
})();
```

**Pros:**
- More compact

**Cons:**
- Less readable
- Unusual pattern

**Effort:** Small
**Risk:** Very Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- Token refresh functionality
- Any code calling `refreshSlackToken`

### Database Changes

None required.

## Acceptance Criteria

- [ ] Non-null assertion is removed from line 205
- [ ] Explicit validation throws descriptive error if access_token is missing
- [ ] TypeScript compiles without non-null assertions in this function

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Non-null assertions should always have explicit validation |

## Resources

- TypeScript non-null assertion docs
- `packages/shared/src/auth/slack-oauth.ts:152-155` for reference pattern
