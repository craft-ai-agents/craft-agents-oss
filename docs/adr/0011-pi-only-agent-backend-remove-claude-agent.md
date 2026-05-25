# Pi-only agent backend — remove ClaudeAgent

All session execution routes through `PiAgent`. The `ClaudeAgent` class (backed by `@anthropic-ai/claude-agent-sdk`) and the `providerType: 'anthropic'` connection type are removed from the product.

Anthropic/Claude models remain reachable through `PiAgent` via `piAuthProvider: 'anthropic'` — the removal is of the direct SDK path, not of Claude model access.

## Considered options

- **Keep both backends** — maintain ClaudeAgent for direct Anthropic API connections alongside PiAgent. Rejected: two live backends diverge over time, the Claude SDK bundles per-platform native binaries that bloat the app, and deployment relies on the Environment Connection (Pi-routed) as the primary LLM path.
- **Pi-only** (chosen) — single backend simplifies the agent lifecycle, removes the SDK binary from the bundle, and matches the deployment reality.

## Consequences

- Existing `providerType: 'anthropic'` connections in `config.json` are silently migrated to `providerType: 'pi'` + `piAuthProvider: 'anthropic'` at startup.
- The onboarding credential step is removed; the product assumes an Environment Connection is always present.
- "Anthropic API" is removed from the Add Connection provider dropdown; other providers (OpenAI, custom endpoints, OpenLLM) remain.
- `claude-agent.ts`, `backend/claude/`, `claude-context.ts`, and `claude-llm-query.ts` are deleted after auditing for any logic that needs porting to the Pi path.
