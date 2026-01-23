---
status: complete
priority: p2
issue_id: "013"
tags: [code-review, architecture, slack-oauth, api-design]
dependencies: []
---

# Asymmetric clientId Parameter in refreshSlackToken

## Problem Statement

The `refreshSlackToken` function accepts an optional `clientId` parameter but always uses the hardcoded `SLACK_CLIENT_SECRET` from module constants. This creates a potential mismatch if a caller passes a different client ID, as the secret won't correspond to that client.

**Why it matters:** This API design is confusing and could lead to hard-to-debug authentication failures if someone passes a custom clientId expecting it to work.

## Findings

### Evidence

**Current code (lines 171-177):**
```typescript
export async function refreshSlackToken(
  refreshToken: string,
  clientId?: string  // Optional client ID
): Promise<{ accessToken: string; expiresAt?: number }> {
  const authHeader = Buffer.from(
    `${clientId || SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`  // Always uses hardcoded secret!
  ).toString('base64');
```

**Comparison with Google OAuth (lines 162-165):**
```typescript
export async function refreshGoogleToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt?: number;
}> {
  // No optional clientId - consistent API
```

### Problems

1. If `clientId` is passed but `SLACK_CLIENT_SECRET` is for default client, auth fails
2. API inconsistency with other OAuth refresh functions
3. Unclear use case for this parameter

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Lines: 171-177

## Proposed Solutions

### Solution A: Remove clientId Parameter (Recommended)

**Description:** Remove the optional `clientId` parameter for consistency with other OAuth implementations.

```typescript
export async function refreshSlackToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt?: number }> {
  const authHeader = Buffer.from(
    `${SLACK_CLIENT_ID}:${SLACK_CLIENT_SECRET}`
  ).toString('base64');
```

**Pros:**
- Consistent with Google/Microsoft OAuth
- Eliminates potential for mismatch
- Simpler API

**Cons:**
- Breaking change if anyone uses the parameter

**Effort:** Small
**Risk:** Low (parameter appears unused)

### Solution B: Accept Both clientId and clientSecret

**Description:** If custom clients are needed, accept both parameters together.

```typescript
export async function refreshSlackToken(
  refreshToken: string,
  customCredentials?: { clientId: string; clientSecret: string }
): Promise<{ accessToken: string; expiresAt?: number }> {
  const { clientId, clientSecret } = customCredentials ?? {
    clientId: SLACK_CLIENT_ID,
    clientSecret: SLACK_CLIENT_SECRET,
  };
```

**Pros:**
- Supports multi-tenant scenarios
- Clear that both are needed together

**Cons:**
- More complex API
- May not be needed

**Effort:** Small
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- Token refresh functionality
- Any callers of refreshSlackToken

### Database Changes

None required.

## Acceptance Criteria

- [ ] API is consistent with Google/Microsoft OAuth refresh functions
- [ ] No potential for clientId/clientSecret mismatch
- [ ] Breaking change is documented if parameter is removed

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Check if clientId param is used anywhere |

## Resources

- Google OAuth refresh function for reference pattern
