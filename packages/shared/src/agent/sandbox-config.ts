/**
 * Sandbox configuration builder for the Claude Agent SDK.
 *
 * Maps Craft's per-session `sandboxed` flag onto the SDK's native `sandbox`
 * Options field, which uses Seatbelt on macOS and bubblewrap on Linux/WSL2 to
 * enforce filesystem and network isolation at the OS level.
 *
 * The Pi backend currently does not honor this — only ClaudeAgent reads the
 * output of `buildClaudeSandboxOptions` and feeds it into `query()`.
 */

import { join, resolve, sep } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { getSessionPath } from '../sessions/storage.ts';
import type { SessionConfig } from '../sessions/types.ts';
import { normalizeBrowserToolName } from './browser-tool-names.ts';

/**
 * Inputs to derive an SDK sandbox config from a session.
 */
export interface BuildClaudeSandboxArgs {
  session: SessionConfig | undefined;
  workspaceRootPath: string;
  /** Effective spawn cwd that ClaudeAgent passes to the SDK (sdkCwd or fallback). */
  sdkCwd: string;
  /**
   * Absolute paths from the session's active *local* sources. The user added
   * these folders as sources, which signals intent to give the agent write
   * access. Empty when there are no active local sources. Resolved (~ expanded)
   * by the source storage layer — see sources/storage.ts:expandPath.
   */
  localSourcePaths?: readonly string[];
  /**
   * Hostnames extracted from the session's active *API* sources and *MCP HTTP*
   * sources. Always pre-include `api.anthropic.com` in the caller; this list
   * is what the SDK sandbox uses for Bash + subprocess network reach, and what
   * the PreToolUse guard checks for WebFetch / browser_tool navigations.
   */
  allowedHosts?: readonly string[];
}

/**
 * Best-effort hostname extraction from a URL string. Returns null when the
 * input doesn't parse as a URL or has no host — callers should drop those
 * rather than feed `null` into an allow-list. Lowercased on the way out to
 * match how the SDK does its prefix comparisons.
 */
export function safeExtractHost(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname?.toLowerCase();
    return host && host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Source-of-truth helper for the *network* allow-list. Mirrors the filesystem
 * helper above. Returns lowercase hostnames (the SDK does prefix-style matching
 * on these) plus `api.anthropic.com` as a baseline so the agent can always
 * reach its own API.
 *
 * Returns an empty array when the session is not sandboxed.
 */
export function getSandboxAllowedHosts(args: BuildClaudeSandboxArgs): string[] {
  const { session, allowedHosts } = args;
  if (!session?.sandboxed) return [];

  const hosts = new Set<string>();
  hosts.add('api.anthropic.com'); // Always — the agent has to reach its own API.
  for (const h of allowedHosts ?? []) {
    const normalized = h?.toLowerCase().trim();
    if (normalized) hosts.add(normalized);
  }
  return [...hosts];
}

/**
 * The set of writeable filesystem roots a sandboxed session is permitted to
 * modify. Returns an empty array when the session is not sandboxed.
 *
 * Used in two places that must agree:
 *   1. `buildClaudeSandboxOptions` → fed to the SDK's OS-level sandbox
 *      (`sandbox.filesystem.allowWrite`), which gates Bash and subprocesses.
 *   2. The `PreToolUse` hook in ClaudeAgent → gates the SDK's built-in
 *      Write / Edit / MultiEdit / NotebookEdit tools, which the OS sandbox
 *      doesn't see (per Anthropic's design — see the "What sandboxing does
 *      not cover" section of the public docs).
 *
 * Keeping the source of truth here ensures the two enforcement layers stay
 * aligned: a path the OS sandbox would block via Bash is also blocked when
 * an agent reaches for the built-in Write tool.
 */
export function getSandboxWriteRoots(args: BuildClaudeSandboxArgs): string[] {
  const { session, workspaceRootPath, sdkCwd, localSourcePaths } = args;
  if (!session?.sandboxed) return [];

  const sessionDir = getSessionPath(workspaceRootPath, session.id);
  const workspaceDataDir = join(workspaceRootPath, 'data');

  const roots = new Set<string>();
  if (session.workingDirectory) roots.add(session.workingDirectory);
  roots.add(sdkCwd);
  roots.add(sessionDir);
  roots.add(workspaceDataDir);
  for (const path of localSourcePaths ?? []) {
    if (path) roots.add(path);
  }
  return [...roots];
}

/**
 * Test whether `targetPath` falls inside any of the supplied root directories.
 * Both `targetPath` and roots are resolved to absolute paths before comparison.
 *
 * Subpath semantics use path separators as boundaries so that a root of
 * `/foo/bar` matches `/foo/bar/baz` but NOT `/foo/barn` — string-prefix
 * matching alone would be wrong.
 *
 * `cwd` is used to anchor relative `targetPath` inputs.
 */
export function isPathInsideAllowedRoots(
  targetPath: string,
  roots: readonly string[],
  cwd: string,
): boolean {
  const target = resolve(cwd, targetPath);
  for (const root of roots) {
    const absRoot = resolve(root);
    if (target === absRoot) return true;
    if (target.startsWith(absRoot + sep)) return true;
  }
  return false;
}

/**
 * Tools whose target path must be checked against the sandbox allow-list when
 * the session is sandboxed. Bash is intentionally absent — Bash and its
 * subprocess tree are already constrained by the OS-level sandbox; replicating
 * the check here would require parsing arbitrary shell commands and would
 * still be redundant with what Seatbelt/bubblewrap already enforce.
 */
export const SANDBOX_GATED_TOOLS = new Set<string>([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

/**
 * Tools whose target URL must be checked against the network allow-list when
 * the session is sandboxed. Bash and its subprocess tree go through the SDK's
 * own `sandbox.network.allowedDomains` enforcement — these built-in tools
 * don't, so we gate them here. The matcher accepts the canonical
 * `browser_tool` name (including namespaced forms like
 * `mcp__session__browser_tool`) plus legacy aliases the runtime still honors.
 */
export function isSandboxNetworkGatedTool(toolName: string): boolean {
  if (toolName === 'WebFetch') return true;
  // Catches `browser_tool`, namespaced variants, and legacy aliases
  // (browser_navigate, browser_open, …). All of them can transit a URL.
  return normalizeBrowserToolName(toolName) === 'browser_tool';
}

/**
 * Pull the destination URL from a network-gated tool call. Returns null when
 * the tool doesn't gate or the input shape doesn't carry a URL (e.g.,
 * `browser_tool snapshot`, which is a non-navigating subcommand).
 *
 * Shapes handled:
 *   - WebFetch: `{ url: string }`
 *   - browser_tool: `{ command: string | string[] }` where the first token is
 *     the subcommand. We extract the URL only for subcommands that take one
 *     (`navigate`, `open`).
 *   - Legacy browser_navigate / browser_open: same as canonical with the
 *     subcommand implied by the tool name.
 */
export function extractSandboxGatedUrl(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): string | null {
  if (!toolInput) return null;

  if (toolName === 'WebFetch') {
    const v = toolInput.url;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  const canonical = normalizeBrowserToolName(toolName);
  if (canonical !== 'browser_tool') return null;

  // Some legacy aliases bake the subcommand into the tool name (e.g.
  // `browser_navigate`). Those carry the URL directly as `toolInput.url`.
  const stripped = toolName.replace(/^(mcp__[^_]+__|session__)/, '');
  if (stripped === 'browser_navigate' || stripped === 'browser_open') {
    const v = toolInput.url;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  // Canonical browser_tool: { command: string | string[] } — first token is
  // the subcommand, e.g. "navigate https://example.com".
  const command = toolInput.command;
  let parts: string[];
  if (Array.isArray(command)) {
    parts = command.filter((p): p is string => typeof p === 'string');
  } else if (typeof command === 'string') {
    parts = command.trim().split(/\s+/);
  } else {
    return null;
  }
  const first = parts[0];
  if (!first) return null;
  const subcommand = first.toLowerCase();
  if (subcommand !== 'navigate' && subcommand !== 'open') return null;
  const url = parts.slice(1).join(' ').trim();
  return url || null;
}

/**
 * Is `host` allowed under `allowedHosts`? Matches the SDK's behavior:
 * exact host match OR subdomain (e.g. `api.linear.app` matches both itself
 * and a wildcard-style entry for `linear.app` — but we don't support
 * wildcards yet, so this is exact + parent-domain-via-suffix).
 *
 * Hostnames are case-insensitive.
 */
export function isHostAllowed(host: string | null, allowedHosts: readonly string[]): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  for (const allowed of allowedHosts) {
    const a = allowed.toLowerCase();
    if (lower === a) return true;
    if (lower.endsWith('.' + a)) return true;
  }
  return false;
}

/**
 * Pull the file path from the input of a sandbox-gated tool. The SDK uses
 * `file_path` for Write/Edit/MultiEdit and `notebook_path` for NotebookEdit.
 * Returns null when the path is missing or not a string (defensive: the input
 * shape is provided by the model, not our code).
 */
export function extractSandboxGatedFilePath(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): string | null {
  if (!toolInput) return null;
  if (toolName === 'NotebookEdit') {
    const v = toolInput.notebook_path;
    return typeof v === 'string' ? v : null;
  }
  if (SANDBOX_GATED_TOOLS.has(toolName)) {
    const v = toolInput.file_path;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Build the `sandbox` field for the SDK's `Options`. Returns `undefined` when
 * sandboxing is disabled or the session is missing — callers can spread the
 * result into Options without conditionals at the call site.
 *
 * Allow-list strategy:
 *   - Filesystem writes are restricted to the user's working directory, the
 *     per-session storage dir, and the workspace's `data/` dir (which is
 *     Craft's documented home for shared cross-run state — caches, indexes,
 *     etc. — that automations need to update). Reads stay open by default
 *     (the SDK's baseline policy), so node_modules / dyld / source files
 *     all resolve. We deliberately do NOT add the whole workspace root:
 *     `automations.json`, `config.json`, `sources/`, and other sessions'
 *     transcripts must remain write-protected even from the agent itself.
 *   - Network rules: `api.anthropic.com` is always allowed; hosts from the
 *     session's active API and MCP HTTP sources are added on top. Under
 *     `allow-all` permission mode, unknown domains are denied silently
 *     (`allowManagedDomainsOnly: true`) because unattended sessions have no
 *     one to answer a prompt. Under `safe` / `ask`, the SDK's default
 *     prompt-on-new-domain UX applies. This only covers Bash and its
 *     subprocesses; built-in network tools (WebFetch, browser_tool) are
 *     gated separately by the PreToolUse hook.
 *
 * Escape hatch is closed:
 *   - `allowUnsandboxedCommands: false` disables the SDK's
 *     `dangerouslyDisableSandbox` parameter. Without this, an agent
 *     hitting a sandbox-incompatible tool can retry with the parameter
 *     set, which under `allow-all` permission mode bypasses sandboxing
 *     silently. Craft's design exposes two explicit user-controlled
 *     escape hatches already (toggle `sandboxed` off, or unset it on
 *     the session); offering the LLM a third one undermines the
 *     property the user opted in for.
 *
 * Failure handling:
 *   - `failIfUnavailable` defaults to true (matches the SDK's own default
 *     when `enabled: true` is passed programmatically). Sessions opted into
 *     graceful degradation can set `sandboxFailHard: false` to fall back
 *     to unsandboxed execution with a warning instead.
 */
export function buildClaudeSandboxOptions(
  args: BuildClaudeSandboxArgs,
): Options['sandbox'] | undefined {
  const { session } = args;
  if (!session?.sandboxed) return undefined;

  // Single source of truth shared with the PreToolUse hook (see
  // getSandboxWriteRoots' docstring for why both layers must agree).
  const writeRoots = getSandboxWriteRoots(args);
  const allowedHosts = getSandboxAllowedHosts(args);

  // Strict mode (`allowManagedDomainsOnly: true`) silently denies unknown
  // domains rather than prompting. We use it only under `allow-all` permission
  // mode: those sessions are explicitly opt-in to autonomous behavior, so a
  // domain prompt has no human to answer. Interactive modes (`safe`, `ask`)
  // get the SDK's default prompt-on-new-domain UX so users can approve
  // legitimate destinations at runtime.
  const strictDomains = session.permissionMode === 'allow-all';

  return {
    enabled: true,
    failIfUnavailable: session.sandboxFailHard ?? true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      allowWrite: writeRoots,
    },
    network: {
      allowedDomains: allowedHosts,
      allowManagedDomainsOnly: strictDomains,
    },
  };
}
