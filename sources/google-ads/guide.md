# Google Ads

Google Ads is bundled with RunnerOS at `tools/google-ads`.

## Scope

- Treat this as a local CLI source, not an MCP server.
- Primary command from the repo: `node bin/google-ads.mjs`
- Preferred working directory: `tools/google-ads`
- Use `--agent` for JSON, compact, non-interactive output.
- Google Ads auth is separate from Meta Ads auth.

## Commands

- Doctor: `node bin/google-ads.mjs doctor --agent`
- Auth status: `node bin/google-ads.mjs auth status --agent`
- App login: Tools → Google Ads → Connect Google Ads
- Accessible customers: `node bin/google-ads.mjs customers list-accessible-customers --agent`
- Field lookup: `node bin/google-ads.mjs google-ads-fields search --agent --query campaign`
- GAQL search: `node bin/google-ads.mjs customers-google-ads search <customerId> --agent --query "<GAQL>"`

## Guidelines

- Run `node bin/google-ads.mjs doctor --agent` before account work.
- If auth is missing, tell the user to open Tools → Google Ads → Connect Google Ads. RunnerOS stores Google OAuth, developer token, and optional login customer ID for future app launches.
- Use real hyphenated commands. Some upstream introspection may show underscore names; convert command names to hyphen form before executing.
- Start read-only. Prefer account discovery, field lookup, and reporting before recommendations.
- Never mutate campaigns, budgets, keywords, audiences, conversions, billing, or status without explicit user approval in the current conversation.

## Validation

Use:

```bash
cd tools/google-ads && node bin/google-ads.mjs doctor --agent
cd tools/google-ads && node bin/google-ads.mjs auth status --agent
```
