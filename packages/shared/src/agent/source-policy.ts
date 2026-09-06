/**
 * Source Action Policy (freestanding)
 *
 * The endpoint/tool policy rules that decide whether a source call is
 * read-only/allowlisted or needs explicit user approval. Extracted out of
 * runPreToolUseChecks' ask-mode prompt logic so non-hook callers (the Pages
 * action bridge, future services) evaluate the SAME rules instead of
 * re-implementing them. shouldPromptInAskMode delegates here.
 *
 * Session-scoped whitelists ("previously approved this session") are NOT
 * part of this module — they belong to the per-session PermissionManager
 * and stay in the hook layer.
 */

import { isApiEndpointAllowed, shouldAllowToolInMode } from './mode-manager.ts';
import type { PermissionsContext } from './permissions-config.ts';

export type SourceActionPolicyDecision =
  | { decision: 'allow'; reason: 'read-only' | 'endpoint-allowlisted' }
  | { decision: 'requires-approval'; description: string };

/**
 * API-source endpoint policy:
 * - GET is always allowed (read-only by convention)
 * - mutations are allowed when they match an allowedApiEndpoints rule from
 *   the merged permissions.json config
 * - everything else requires approval
 */
export function evaluateApiEndpointPolicy(
  method: string,
  path: string | undefined,
  permissionsContext?: PermissionsContext,
): SourceActionPolicyDecision {
  const upperMethod = (method || 'GET').toUpperCase();

  if (upperMethod === 'GET') {
    return { decision: 'allow', reason: 'read-only' };
  }

  if (isApiEndpointAllowed(upperMethod, path, permissionsContext)) {
    return { decision: 'allow', reason: 'endpoint-allowlisted' };
  }

  return { decision: 'requires-approval', description: `${upperMethod} ${path || ''}` };
}

/**
 * MCP tool policy: a tool that safe mode would block is a mutation and
 * requires approval; anything safe mode allows is read-only.
 *
 * @param proxyToolName - Full proxy tool name (mcp__{slug}__{tool})
 */
export function evaluateMcpToolPolicy(
  proxyToolName: string,
  input: Record<string, unknown>,
  options?: { plansFolderPath?: string },
): SourceActionPolicyDecision {
  const safeModeResult = shouldAllowToolInMode(proxyToolName, input, 'safe', {
    plansFolderPath: options?.plansFolderPath,
  });

  if (safeModeResult.allowed) {
    return { decision: 'allow', reason: 'read-only' };
  }

  const serverAndTool = proxyToolName.replace('mcp__', '').replace(/__/g, '/');
  return { decision: 'requires-approval', description: `MCP: ${serverAndTool}` };
}
