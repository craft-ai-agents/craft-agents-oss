/**
 * Session Self-Management Bindings
 *
 * Attaches 6 session management properties to a SessionToolContext using
 * Object.defineProperty with non-memoized lazy getters. Each access resolves
 * the callback from the session-scoped tool callback registry at call time,
 * so late merges and callback replacements are immediately visible without
 * recreating the context.
 *
 * Used by both the Claude and Pi agent paths to ensure a single binding
 * implementation — the root cause of #511 was that PiAgent's context was
 * missing these bindings entirely.
 *
 * Design rules:
 * - Each getter calls getSessionScopedToolCallbacks() fresh — NO memoization
 * - Returns undefined when the callback is missing — NO no-ops, NO fake data
 * - getSessionInfo is the only field that wraps (for sid ?? sessionId defaulting)
 * - All other fields return the raw registry callback directly (signatures match)
 */

import type {
  SessionToolContext,
  ListSourcesOptions,
  ListSourcesResult,
  SourceListItem,
  SourceListItemAuthStatus,
  SourceListItemType,
  SourceTier,
} from '@craft-agent/session-tools-core';
import { getSessionScopedToolCallbacks } from './session-scoped-tool-callback-registry.ts';
import { loadAllSources } from '../sources/storage.ts';
import type { LoadedSource } from '../sources/types.ts';

/**
 * Attach session self-management bindings to a SessionToolContext.
 *
 * Defines lazy getters for: setSessionLabels, setSessionStatus,
 * getSessionInfo, listSessions, resolveLabels, resolveStatus.
 *
 * @param context - The SessionToolContext to augment (mutated in place)
 * @param sessionId - The session ID for registry lookup and getSessionInfo defaulting
 */
export function attachSessionSelfManagementBindings(
  context: SessionToolContext,
  sessionId: string,
): void {
  // Direct pass-through bindings — signatures match, no wrapping needed.
  // Each getter resolves fresh from the registry on every access.

  Object.defineProperty(context, 'setSessionLabels', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.setSessionLabelsFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'setSessionStatus', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.setSessionStatusFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'listSessions', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.listSessionsFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'listAgents', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.listAgentsFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'listSkills', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.listSkillsFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'listWorkflows', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.listWorkflowsFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'getWorkflow', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.getWorkflowFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'startWorkflow', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.startWorkflowFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'getWorkflowRun', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.getWorkflowRunFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'cancelWorkflowRun', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.cancelWorkflowRunFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'resolveLabels', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.resolveLabelsFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'resolveStatus', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.resolveStatusFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'sendAgentMessage', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.sendAgentMessageFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'activateSourceInSession', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.activateSourceInSessionFn;
    },
    configurable: true,
    enumerable: true,
  });

  // Messaging gateway bindings
  Object.defineProperty(context, 'getMessagingBindings', {
    get() {
      const fn = getSessionScopedToolCallbacks(sessionId)?.getMessagingBindingsFn;
      if (!fn) return undefined;
      return (sid: string) => fn(sid ?? sessionId);
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'unbindMessagingChannel', {
    get() {
      const fn = getSessionScopedToolCallbacks(sessionId)?.unbindMessagingChannelFn;
      if (!fn) return undefined;
      return (sid: string, platform?: string) => fn(sid ?? sessionId, platform);
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'createAgent', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.createAgentFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'createAutomation', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.createAutomationFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'createWorkflow', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.createWorkflowFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'saveMemory', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.saveMemoryFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'updateMemory', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.updateMemoryFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'forgetMemory', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.forgetMemoryFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'createOutput', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.createOutputFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'applyVisualSurfaceEvent', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.applyVisualSurfaceEventFn;
    },
    configurable: true,
    enumerable: true,
  });

  Object.defineProperty(context, 'getVisualSurfaceState', {
    get() {
      return getSessionScopedToolCallbacks(sessionId)?.getVisualSurfaceStateFn;
    },
    configurable: true,
    enumerable: true,
  });

  // listSources is implemented inline (not via the callback registry):
  // it reads the workspace + global tiers via loadAllSources and projects
  // each LoadedSource into the SourceListItem shape declared in
  // @craft-agent/session-tools-core. This is a pure read with no
  // session-scoped state, so it lives here rather than in SessionManager.
  Object.defineProperty(context, 'listSources', {
    get() {
      return (options?: ListSourcesOptions): ListSourcesResult => {
        const workspaceRoot = context.workspacePath;
        const includeDormant = options?.activeOnly !== true;

        // Pass the includeDormant option to loadAllSources. Older builds of
        // loadAllSources accept only (workspaceRoot); calling with the extra
        // arg is harmless because TS structurally widens unused params and
        // the runtime ignores the second arg until Lane A's Phase 1 lands.
        const sources = (loadAllSources as (
          ws: string,
          opts?: { includeDormant?: boolean },
        ) => LoadedSource[])(workspaceRoot, { includeDormant });

        const items: SourceListItem[] = sources.map(toSourceListItem);
        const filtered = filterSourceListItems(items, options);
        return {
          total: filtered.length,
          returned: filtered.length,
          sources: filtered,
        };
      };
    },
    configurable: true,
    enumerable: true,
  });

  // getSessionInfo needs wrapping to default sid → sessionId
  Object.defineProperty(context, 'getSessionInfo', {
    get() {
      const fn = getSessionScopedToolCallbacks(sessionId)?.getSessionInfoFn;
      if (!fn) return undefined;
      return (sid?: string) => fn(sid ?? sessionId);
    },
    configurable: true,
    enumerable: true,
  });
}

// ============================================================
// list_sources helpers
// ============================================================

function toSourceListItem(source: LoadedSource): SourceListItem {
  const config = source.config;
  // Tier: prefer the field added by Lane A (Phase 1 storage). When absent
  // (older builds), fall back to 'workspace' which is the existing behavior.
  const tier: SourceTier =
    ((source as unknown as { tier?: SourceTier }).tier ?? 'workspace');

  const type = (config.type as SourceListItemType) ?? 'mcp';
  const enabled = computeEnabled(source);
  const authStatus = computeAuthStatus(source);

  // FolderSourceConfig doesn't carry a description/tags pair today; the
  // human-readable summary lives in `tagline` (with guide.md as fallback).
  // We project tagline → description and read tags off a forward-compatible
  // optional field so this code keeps working as the schema evolves.
  const cfgExt = config as unknown as { tagline?: string; tags?: unknown };
  const description = typeof cfgExt.tagline === 'string' ? cfgExt.tagline : '';
  const tags = Array.isArray(cfgExt.tags)
    ? cfgExt.tags.filter((t): t is string => typeof t === 'string')
    : [];

  return {
    slug: config.slug,
    name: config.name,
    description,
    tags,
    type,
    tier,
    enabled,
    authStatus,
    iconUrl: source.iconPath ?? undefined,
  };
}

function computeEnabled(source: LoadedSource): boolean {
  const enabled = source.config.enabled !== false;
  if (!enabled) return false;
  // auth: 'none' short-circuits — already enabled per config flag.
  // For auth-bearing sources we still report enabled=true here; the agent
  // reads authStatus separately to decide whether the source is functional.
  return true;
}

function sourceAuthIsNone(source: LoadedSource): boolean {
  const cfg = source.config as {
    type?: string;
    mcp?: { authType?: string };
    api?: { authType?: string };
  };
  if (cfg.type === 'mcp') {
    return !cfg.mcp?.authType || cfg.mcp.authType === 'none';
  }
  if (cfg.type === 'api') {
    return cfg.api?.authType === 'none';
  }
  // Local sources have no remote auth.
  return cfg.type === 'local';
}

function computeAuthStatus(source: LoadedSource): SourceListItemAuthStatus {
  if (sourceAuthIsNone(source)) return 'none';
  const cs = (source.config as { connectionStatus?: SourceListItemAuthStatus })
    .connectionStatus;
  if (cs === 'connected' || cs === 'needs_auth' || cs === 'failed' ||
      cs === 'untested' || cs === 'local_disabled') {
    return cs;
  }
  return 'untested';
}

function filterSourceListItems(
  items: SourceListItem[],
  options?: ListSourcesOptions,
): SourceListItem[] {
  if (!options) return items;
  let out = items;

  if (options.activeOnly) {
    out = out.filter(s => s.tier !== 'global-dormant');
  }
  if (options.type) {
    out = out.filter(s => s.type === options.type);
  }
  if (options.tags && options.tags.length > 0) {
    const required: string[] = options.tags.map((t: string) => t.toLowerCase());
    out = out.filter((s: SourceListItem) => {
      const haystack: string[] = s.tags.map((t: string) => t.toLowerCase());
      return required.every((t: string) => haystack.includes(t));
    });
  }
  if (options.search && options.search.trim().length > 0) {
    const q = options.search.toLowerCase();
    out = out.filter((s: SourceListItem) =>
      s.slug.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t: string) => t.toLowerCase().includes(q)),
    );
  }
  return out;
}
