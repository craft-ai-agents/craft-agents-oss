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

/**
 * Pick the proxy name to actually assign when `baseName` may already be taken
 * by a DIFFERENT tool: the base name itself when free, otherwise the first
 * free `__2`, `__3`, … suffix (#1002).
 *
 * Two distinct MCP tool names can sanitize to the same proxy name
 * (`pat.batch` and `pat_batch` → `mcp__src__pat_batch`). Suffixing the later
 * one keeps both tools callable instead of silently dropping the second.
 * The result depends only on the set of already-taken names, so assigning
 * names in registration order is deterministic: the same server tool list
 * always produces the same assignments across reconnects.
 */
export function nextAvailableProxyName(baseName: string, taken: ReadonlySet<string>): string {
  if (!taken.has(baseName)) return baseName
  for (let n = 2; ; n++) {
    const candidate = `${baseName}__${n}`
    if (!taken.has(candidate)) return candidate
  }
}
