---
status: complete
priority: p3
issue_id: "018"
tags: [code-review, feature, slack-oauth, consistency]
dependencies: []
---

# Missing User Email Retrieval

## Problem Statement

The Slack OAuth result includes `userId` but not the user's email, while Google OAuth fetches the user's email. This creates an inconsistent result interface across OAuth implementations.

**Why it matters:** Callers may expect consistent data across OAuth providers. Google returns email; Slack doesn't.

## Findings

### Evidence

**Slack OAuth result (lines 78-94):**
```typescript
export interface SlackOAuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  teamId?: string;
  teamName?: string;
  userId?: string;  // Has userId
  error?: string;
  // No email field!
}
```

**Google OAuth result (lines 77-84):**
```typescript
export interface GoogleOAuthResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;  // Has email!
  error?: string;
}
```

### Capability

Slack can provide user email if `users:read.email` scope is granted. This scope is included in the 'full' service scopes (line 48).

The `users.info` API can retrieve user email with the obtained token.

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Lines: 78-94 (interface), 327-335 (return value)

## Proposed Solutions

### Solution A: Add Optional Email Retrieval (Recommended)

**Description:** Fetch user email after token exchange using `users.info` API.

```typescript
// Add function
async function getUserEmail(accessToken: string, userId: string): Promise<string | undefined> {
  try {
    const response = await fetch('https://slack.com/api/users.info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    return data.ok ? data.user?.profile?.email : undefined;
  } catch {
    return undefined;  // Email is optional, don't fail OAuth
  }
}

// In startSlackOAuth, after token exchange:
const email = await getUserEmail(tokens.accessToken, tokens.userId);

return {
  success: true,
  accessToken: tokens.accessToken,
  // ...
  email,  // Add email field
};
```

**Pros:**
- Consistent with Google OAuth
- Useful for display purposes

**Cons:**
- Extra API call
- May not have permission if scope wasn't granted

**Effort:** Medium
**Risk:** Low

### Solution B: Document the Difference

**Description:** Just document that Slack doesn't return email.

**Pros:**
- No code change

**Cons:**
- Inconsistent API

**Effort:** Trivial
**Risk:** None

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- SlackOAuthResult interface
- OAuth result handling

### Database Changes

None required.

## Acceptance Criteria

- [ ] Slack OAuth can optionally return user email
- [ ] Email fetch doesn't fail the OAuth flow
- [ ] Interface is consistent with Google OAuth

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | users:read.email scope required |
| 2026-01-25 | Verified issue still exists | SlackOAuthResult interface (L78-94) has no email field, unlike GoogleOAuthResult |

## Resources

- Slack users.info API documentation
- Google OAuth implementation for reference
