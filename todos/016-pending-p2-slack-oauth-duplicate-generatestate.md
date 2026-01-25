---
status: pending
priority: p2
issue_id: "016"
tags: [code-review, architecture, slack-oauth, code-duplication]
dependencies: []
---

# Duplicated generateState Function Across OAuth Modules

## Problem Statement

The `generateState()` function is duplicated in `slack-oauth.ts` and `google-oauth.ts`. While a shared version exists in `pkce.ts`, it uses different encoding (`base64url` vs `hex`), creating inconsistency.

**Why it matters:** Code duplication leads to maintenance burden. If the state generation needs to change (e.g., for security reasons), it must be updated in multiple places.

## Findings

### Evidence

**Slack OAuth (lines 99-101):**
```typescript
function generateState(): string {
  return randomBytes(16).toString('hex');  // hex encoding
}
```

**Google OAuth (lines 98-100):**
```typescript
function generateState(): string {
  return randomBytes(16).toString('hex');  // hex encoding
}
```

**pkce.ts (lines 36-38):**
```typescript
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');  // base64url encoding
}
```

### Inconsistency

- Slack and Google use `hex` encoding (32 chars)
- pkce.ts uses `base64url` encoding (22 chars)
- Both are valid, but inconsistency is confusing

### Location

- `packages/shared/src/auth/slack-oauth.ts` line 99-101
- `packages/shared/src/auth/google-oauth.ts` line 98-100
- `packages/shared/src/auth/pkce.ts` line 36-38

## Proposed Solutions

### Solution A: Import from pkce.ts (Recommended)

**Description:** Remove duplicate implementations and import from pkce.ts.

```typescript
// In slack-oauth.ts and google-oauth.ts
import { generateState } from './pkce.ts';
```

Note: This would change encoding from hex to base64url, but both are equally secure.

**Pros:**
- Single source of truth
- Reduces maintenance burden

**Cons:**
- Changes state format (may break existing OAuth sessions in progress)

**Effort:** Small
**Risk:** Low (state is ephemeral)

### Solution B: Create oauth-utils.ts

**Description:** Create a shared utility file with consistent hex encoding.

```typescript
// packages/shared/src/auth/oauth-utils.ts
export function generateState(): string {
  return randomBytes(16).toString('hex');
}
```

**Pros:**
- No change to existing format
- Clear shared location

**Cons:**
- Another file to maintain

**Effort:** Small
**Risk:** Very Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`
- `packages/shared/src/auth/google-oauth.ts`
- `packages/shared/src/auth/pkce.ts` (reference)

### Components Impacted

- CSRF protection across all OAuth flows

### Database Changes

None required.

## Acceptance Criteria

- [ ] Single implementation of generateState
- [ ] All OAuth modules use shared function
- [ ] Consistent encoding across modules

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | DRY principle for security functions |
| 2026-01-25 | Verified issue still exists | Duplicate in slack-oauth.ts (L108-110), google-oauth.ts (L98-100), pkce.ts uses base64url (L36-38) |

## Resources

- pkce.ts for existing shared implementation
