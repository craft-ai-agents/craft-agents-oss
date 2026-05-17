# Meta Ads

This source connects RunnerOS to Meta's official Ads MCP beta at `https://mcp.facebook.com/ads`.

## Scope

- Remote HTTP MCP server hosted by Meta.
- OAuth is handled through Meta Business login. Do not paste API keys or personal access tokens.
- The connector is in beta. Some Business accounts may authenticate but still be blocked by Meta rollout eligibility.
- Expected jobs include reporting, campaign management, catalog operations, and signal diagnostics.

## Guidelines

- Start with read-only discovery: list accounts, inspect campaigns, pull reports, and run diagnostics.
- Treat campaign, budget, catalog, creative, and status changes as externally visible ad-account actions.
- Before any write action, show the exact planned change and ask for explicit confirmation.
- If Meta returns an eligibility or rollout error, report that Meta has not enabled Ads MCP for that Business yet.
- Do not use this source for lead retrieval, CRM sync, or lead notifications unless Meta exposes those tools later.

## Common Usage

- "Use Meta Ads to show current campaign performance."
- "Diagnose why this ad set is not spending."
- "List active campaigns and flag anything wasting budget."
- "Draft budget changes, but do not apply them until I approve."

## Notes

- Official MCP endpoint: `https://mcp.facebook.com/ads`
- Launch state: Meta Ads AI Connectors beta, announced April 29, 2026.
- No Meta Developer App should be required for this official connector.
