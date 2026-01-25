---
status: complete
priority: p2
issue_id: "015"
tags: [code-review, architecture, slack-oauth, configuration]
dependencies: []
---

# Hardcoded External Relay URL

## Problem Statement

The Cloudflare Worker relay URL is hardcoded directly in the code at line 282. This creates tight coupling to specific infrastructure, makes testing difficult, and provides no fallback if the relay is unavailable.

**Why it matters:**
- If `agents.craft.do` goes down, all Slack OAuth fails
- Testing requires the production relay or mocking
- The URL references "Craft Agents" but the project is "Vesper" (branding inconsistency)

## Findings

### Evidence

**Current code (lines 280-282):**
```typescript
// Use Cloudflare Worker relay for Slack OAuth (Slack requires HTTPS)
// The relay redirects: https://agents.craft.do/auth/slack/callback → http://localhost:{port}/callback
const redirectUri = `https://agents.craft.do/auth/slack/callback?port=${port}`;
```

**Comparison with Google OAuth (line 267):**
```typescript
const redirectUri = `${callbackServer.url}/callback`;
// Google allows HTTP for localhost - no relay needed
```

### Context

The relay is necessary because:
- Slack requires HTTPS redirect URIs
- Desktop apps can't easily serve HTTPS on localhost
- The relay receives the callback over HTTPS and forwards to localhost

### Location

- File: `packages/shared/src/auth/slack-oauth.ts`
- Line: 282

## Proposed Solutions

### Solution A: Extract to Environment Variable (Recommended)

**Description:** Make relay URL configurable via environment variable.

```typescript
const SLACK_OAUTH_RELAY_URL = process.env.SLACK_OAUTH_RELAY_URL || 'https://agents.craft.do/auth/slack/callback';

// Later in startSlackOAuth:
const redirectUri = `${SLACK_OAUTH_RELAY_URL}?port=${port}`;
```

**Pros:**
- Configurable per environment
- Enables testing with mock relay
- Allows changing relay without code changes

**Cons:**
- One more env var to configure

**Effort:** Small
**Risk:** Low

### Solution B: Add to SlackOAuthOptions

**Description:** Allow passing relay URL in options.

```typescript
export interface SlackOAuthOptions {
  service?: SlackService;
  userScopes?: string[];
  appType?: AppType;
  relayUrl?: string;  // Custom relay URL for testing
}
```

**Pros:**
- Explicit API for testing

**Cons:**
- More API surface

**Effort:** Small
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files

- `packages/shared/src/auth/slack-oauth.ts`

### Components Impacted

- Slack OAuth redirect handling
- Testing infrastructure

### Database Changes

None required.

## Acceptance Criteria

- [ ] Relay URL is configurable (env var or option)
- [ ] Default value maintains current behavior
- [ ] Documentation explains relay purpose

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created during code review | Update branding from "Craft Agents" to "Vesper" |
| 2026-01-25 | Verified issue still exists | Line 305: `https://agents.craft.do/auth/slack/callback?port=${port}` hardcoded |

## Resources

- Cloudflare Worker documentation
- Slack OAuth HTTPS requirements
