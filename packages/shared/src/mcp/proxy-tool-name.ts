/**
 * Build the proxy tool name exposed to model backends for an MCP source tool.
 *
 * OpenAI/Codex (reached via the Pi path) reject tool names containing anything
 * outside `[a-zA-Z0-9_-]`, but MCP allows dots (e.g. `pat.batch_plan`). We
 * sanitize every disallowed character to `_`.
 *
 * This is safe because the proxy name is only ever used as an OPAQUE exact-match
 * key: `McpClientPool.proxyTools` maps the (sanitized) name → `{ slug, originalName }`
 * and `callTool` looks it up verbatim, then invokes the untouched `originalName`
 * on the source. Build, emit, register and dispatch therefore stay consistent as
 * long as this is the single builder used everywhere (#864 — regression of #498).
 */
export function proxyToolName(slug: string, toolName: string): string {
  return `mcp__${slug}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}
