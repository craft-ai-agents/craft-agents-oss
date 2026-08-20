/**
 * Shared Session + Source Proxy Tool Definition Builder
 *
 * Single code path that composes the tool definition list every RPC backend
 * (Pi, OMP) advertises for craft-executed tools:
 *
 *   1. Session-tools registry defs (getSessionToolProxyDefs — spawn_session,
 *      call_llm, browser_tool, mcp__session__* tools).
 *   2. Optional MCP source-proxy defs from the McpClientPool
 *      (mcp__{slug}__{tool}), for backends that register everything in one
 *      frame (OMP set_host_tools). Pi registers pool defs in a separate
 *      register_tools message — it passes `includePoolProxyDefs: false`.
 *
 * Applies the two parity gates the backends used to duplicate inline:
 *   - browser_tool hidden when the user disabled the built-in browser tool
 *   - call_llm description patched with the session's mini model hint
 *
 * The result is deduplicated by name, first occurrence wins (session tools
 * take precedence over pool proxies on collision).
 */

import { getSessionToolProxyDefs } from './backend/pi/session-tool-defs.ts';
import { getBrowserToolEnabled } from '../config/storage.ts';
import type { McpClientPool } from '../mcp/mcp-pool.ts';

/** Minimal structural shape every backend registration frame accepts. */
export interface SessionToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SessionToolDefBuildOptions {
  /** Pool to draw MCP source-proxy defs from. */
  mcpPool?: McpClientPool;
  /**
   * Include pool proxy defs in the returned list (OMP single-frame
   * registration). Default false — Pi keeps its separate register_tools
   * frame for pool tools and must pass false here.
   */
  includePoolProxyDefs?: boolean;
  /**
   * Session mini/fast model — patches the call_llm description with a
   * model hint (mirrors prior inline behavior of PiAgent/OmpAgent).
   */
  miniModel?: string;
}

export function buildSessionToolDefs(options: SessionToolDefBuildOptions = {}): SessionToolDef[] {
  let defs: SessionToolDef[] = getSessionToolProxyDefs();

  // Same gate as the backends: hide browser_tool when the user disabled the
  // built-in browser tool.
  if (!getBrowserToolEnabled()) {
    defs = defs.filter((d) => d.name !== 'mcp__session__browser_tool');
  }

  // Same patch as the backends: hint the mini model for call_llm.
  if (options.miniModel) {
    const callLlmDef = defs.find((d) => d.name === 'mcp__session__call_llm');
    if (callLlmDef) {
      callLlmDef.description += `\n\nDefault fast model for this session: ${options.miniModel}. Omit the model parameter to use it automatically.`;
    }
  }

  // Dedupe by name (first wins — session tools beat pool proxies).
  const seen = new Set<string>();
  const unique: SessionToolDef[] = [];
  for (const def of defs) {
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    unique.push(def);
  }

  if (options.includePoolProxyDefs && options.mcpPool) {
    for (const poolDef of options.mcpPool.getProxyToolDefs()) {
      if (seen.has(poolDef.name)) continue;
      seen.add(poolDef.name);
      unique.push(poolDef as SessionToolDef);
    }
  }

  return unique;
}
