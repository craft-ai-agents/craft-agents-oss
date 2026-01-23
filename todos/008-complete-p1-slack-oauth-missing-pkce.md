---
status: complete
priority: p1
issue_id: "008"
tags: [code-review, security, slack-oauth]
dependencies: []
---

# Missing PKCE Implementation in Slack OAuth

## Problem Statement

The Slack OAuth implementation does not use PKCE (Proof Key for Code Exchange), unlike the Google OAuth implementation in the same codebase. PKCE is a security best practice for OAuth 2.0 that protects against authorization code interception attacks, especially critical for desktop applications where the authorization code flows through a local callback server.

**Why it matters:** Without PKCE, if an attacker can intercept the authorization code from the callback URL, they could potentially exchange it for tokens. This is especially relevant given the external relay architecture used (`https://agents.craft.do/auth/slack/callback`).

## Findings

### Evidence

**Slack OAuth (current - no PKCE):**
```typescript
// Lines 286-291 - No PKCE parameters
const authUrl = new URL(SLACK_AUTH_URL);
authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('user_scope', userScopes.join(','));
```

**Google OAuth (reference - uses PKCE):**
```typescript
// google-oauth.ts lines 261, 276-277
const pkce = generatePKCE();
// ...
authUrl.searchParams.set('code_challenge', pkce.challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
```

**Token exchange also differs:**
- Google: `code_verifier` is passed in token exchange request
- Slack: Only `code` and `redirect_uri` are passed

### Location

- Primary file: `packages/shared/src/auth/slack-oauth.ts`
- Lines affected: 286-291 (auth URL construction), 107-165 (token exchange)
- Reference implementation: `packages/shared/src/auth/google-oauth.ts` lines 89-93, 261, 276-277, 313

## Proposed Solutions

### Solution A: Add PKCE Following Google OAuth Pattern (Recommended)

**Description:** Implement PKCE using the same pattern as Google OAuth.

**Implementation:**
1. Import or implement `generatePKCE()` function (or extract to shared utility)
2. Add `code_challenge` and `code_challenge_method` to auth URL
3. Pass `code_verifier` in token exchange request

```typescript
// Add to slack-oauth.ts
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// In startSlackOAuth:
const pkce = generatePKCE();
// ...
authUrl.searchParams.set('code_challenge', pkce.challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

// In exchangeCodeForTokens:
const params = new URLSearchParams({
  code,
  code_verifier: codeVerifier,
  redirect_uri: redirectUri,
});
```

**Pros:**
- Follows established pattern in codebase
- Maximum security improvement
- Slack officially supports PKCE

**Cons:**
- Requires verifying Slack PKCE support for user tokens
- Slightly more complex code

**Effort:** Medium
**Risk:** Low

### Solution B: Extract Shared PKCE Utility

**Description:** Create a shared PKCE utility in `packages/shared/src/auth/oauth-utils.ts` that both Google and Slack OAuth can use.

**Pros:**
- Reduces code duplication
- Ensures consistent implementation

**Cons:**
- Requires refactoring Google OAuth too
- More extensive change

**Effort:** Medium
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts` - Primary implementation
- `packages/shared/src/auth/google-oauth.ts` - Reference for PKCE pattern

### Components Impacted

- Slack OAuth flow
- Token exchange process
- Source authentication

### Database Changes

None required.

## Acceptance Criteria

- [ ] PKCE code challenge is included in Slack authorization URL
- [ ] PKCE code verifier is passed in token exchange request
- [ ] OAuth flow continues to work end-to-end
- [ ] Unit tests verify PKCE parameters are correctly generated and passed

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Slack supports PKCE for OAuth 2.0 v2 |

## Resources

- [Slack OAuth 2.0 v2 Documentation](https://api.slack.com/authentication/oauth-v2)
- [PKCE RFC 7636](https://tools.ietf.org/html/rfc7636)
- Google OAuth implementation: `packages/shared/src/auth/google-oauth.ts`
