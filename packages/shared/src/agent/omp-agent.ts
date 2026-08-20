/**
 * OmpAgent — craft-agents backend driving the OMP CLI (`omp --mode rpc`).
 *
 * Transport: NDJSON over stdio (one JSON object per line, both directions).
 * Protocol: see docs/omp-rpc-notes.md (verified against omp v17.2.9).
 *
 * Key behaviors:
 * - Lazy spawn on first chat() — binary resolved via OMP_CLI_PATH env →
 *   toolchain/PATH (toolchain-runtime) → 'omp' on PATH (last resort).
 *   cwd = workspace root (sandbox per OMP's cwd-keyed execution).
 * - Permission mode mapping:
 * - craft 'allow-all' → spawn with `--approval-mode yolo`; OMP never asks
 *   (strongest auto mode — replaces the weaker `--auto-approve`).
 *   - craft 'ask' / 'safe' → no flag; OMP permission dialogs arrive as
 *     extension_ui_request (confirm/dialog/editor/select) and are proxied into
 *     craft's permission flow (onPermissionRequest + respondToPermission).
 *   - Switching between allow-all and non-allow-all requires a respawn (the flag
 *     is spawn-time). setPermissionMode() kills the subprocess mid-flip; the
 *     next chat() respawns with the new policy.
 * - Session mirror: OMP persists its own transcript with `--session-dir
 *   <workspace>/sessions/<craftSessionId>/omp` (per-craft-session isolation).
 *   History is thus stored in BOTH stores without conflict; craft remains the
 *   owner of conversation history — resuming from the OMP store is
 *   intentionally NOT implemented.
 * - Branching: supported. Anchor model — every final assistant reply is
 *   anchored to its OMP transcript entry id (8-hex `id` in the session JSONL,
 *   see docs/omp-rpc-notes.md §Branching); SessionManager persists the
 *   craft-message-id → entry-id mapping in `omp-turn-anchors.json` (same
 *   pattern as pi-turn-anchors.json). A branch child spawns its own omp
 *   process in the branch session-dir, `switch_session`s onto the parent
 *   transcript and issues `branch {entryId}` where entryId is the USER entry
 *   following the anchor (OMP's branch cuts at that entry's parentId —
 *   assistant entries are rejected per VERIFIED probe). For a branch at the
 *   tail (no following user entry) the parent transcript is copied into the
 *   branch session-dir and switched to directly (full-history fork).
 * - Host tools bridge: after `ready` craft registers its session-scoped tools
 *   (spawn_session, call_llm, browser_tool, mcp__session__*; see
 *   getSessionToolProxyDefs) via the `set_host_tools` RPC. When the OMP model
 *   invokes one, OMP emits `host_tool_call`; craft executes it with the same
 *   semantics as PiAgent.handleToolExecute and answers `host_tool_result`.
 *   MCP source-proxy tools from the pool are NOT bridged in v1.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { getSessionPath } from '../sessions/storage.ts';
import { loadProjectById, getProjectAssetsPath, listProjectAssets, getProjectMemoryPath, loadProjectMemory } from '../projects/storage.ts';
import type { ProjectPromptContext } from '../projects/types.ts';
import { formatProjectContextForPrompt } from '../prompts/system.ts';
import type { MemoryPromptBlocks } from '../memory/types.ts';
import { getContextDocsPromptBlock } from '../context-docs/index.ts';
import { formatPreferencesForPrompt } from '../config/preferences.ts';
import type { AgentEvent, AgentEventUsage } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import { getProxyEnvVars } from '../config/proxy-env.ts';
import { resolveOmpExecutableOrExplain, withToolchainPathPrefix } from '../toolchain-runtime.ts';

import { AbortReason } from './backend/types.ts';
import type {
  BackendConfig,
  ChatOptions,
  BackendRuntimeUpdate,
} from './backend/types.ts';
import { EventQueue } from './backend/event-queue.ts';

import type { ThinkingLevel } from './thinking-levels.ts';
import type { PermissionMode } from './mode-manager.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';

import { BaseAgent } from './base-agent.ts';
import { getRuntimeEnvOverrides, type Workspace } from '../config/storage.ts';
import { parseError } from './errors.ts';

// Host-tool bridge: same defs/executor semantics as PiAgent (register_tools +
// routeToolCall), exposed to OMP via the `set_host_tools` / `host_tool_call` RPC.
import { SESSION_TOOL_NAMES } from './backend/pi/session-tool-defs.ts';
import { buildSessionToolDefs, type SessionToolDef } from './session-tool-defs.ts';
import type { McpClientPool } from '../mcp/mcp-pool.ts';
import type { SdkMcpServerConfig } from './backend/types.ts';
import {
  SESSION_TOOL_REGISTRY,
  type ToolResult as SessionToolResult,
} from '@craft-agent/session-tools-core';
import { createClaudeContext, type SessionToolContext } from './claude-context.ts';
import { attachSessionSelfManagementBindings } from './session-self-management-bindings.ts';
import {
  setLastPlanFilePath,
  getSessionScopedToolCallbacks,
} from './session-scoped-tools.ts';
import { executeBrowserToolCommand } from './browser-tool-runtime.ts';
import { executeGithubUserTool } from '../connections/github-user-tool.ts';
import { saveBinaryResponse } from '../utils/binary-detection.ts';

// ============================================================
// Constants
// ============================================================

/** One-shot print-mode timeout (runMiniCompletion / queryLlm). */
const OMP_ONESHOT_TIMEOUT_MS = 60_000;

/** Timeout awaiting an RPC command response. */
const OMP_COMMAND_TIMEOUT_MS = 15_000;

/** Craft-side execution timeout for a single host tool call (OMP waits). */
const OMP_HOST_TOOL_TIMEOUT_MS = 120_000;

/**
 * Runtime context briefing appended to OMP's system prompt at spawn.
 * NOTE: multi-line text is passed verbatim (OMP's resolvePromptInput treats
 * input containing '\n' as literal text, not a file path).
 */
const OMP_CRAFT_CONTEXT_PROMPT = [
  'You are running inside the Craft Agents desktop app as an embedded agent backend.',
  'In addition to your built-in tools, Craft exposes host tools (mcp__session__*):',
  '- mcp__session__spawn_session — create independent child sessions that run in parallel,',
  '  optionally with their own model, connection, sources and an initial prompt.',
  '  Use it to delegate subtasks instead of doing everything yourself.',
  '- mcp__session__call_llm — one-shot call to a fast auxiliary LLM (a default mini',
  '  model is preconfigured; omit the model parameter to use it).',
  '- mcp__session__browser_tool — control browser panes of the desktop app',
  '  (open windows, navigate, click, evaluate, screenshots).',
  'Session state (tags, statuses, user preferences) is managed by Craft — use the',
  'mcp__session__* session tools for it instead of editing files directly.',
  'Your transcript is mirrored by both Craft and OMP (OMP writes its session file',
  'inside the Craft session folder); never edit or delete session files.',
  'When Craft is in "Выполнение" (Execute / allow-all) mode, tools run without',
  'prompts; otherwise the user confirms sensitive calls via a dialog and a denial',
  'is final for that call.',
].join('\n');

/**
 * Compose the `--append-system-prompt` payload for OMP spawn.
 * Ordering mirrors getSystemPrompt: craft briefing → preferences → project →
 * context docs (rules/soul) → memory blocks → retrieved sources.
 */
export function composeOmpAppendSystemPrompt(input: {
  workingDirectory: string;
  preferences?: string | null;
  projectContextBlock?: string | null;
  memoryBlocks?: MemoryPromptBlocks | null;
}): string {
  const parts = [OMP_CRAFT_CONTEXT_PROMPT];
  if (input.preferences) parts.push(input.preferences);
  if (input.projectContextBlock) parts.push(input.projectContextBlock);
  // Runtime context documents (rules.md, soul.md, user *.md from
  // <CONFIG_DIR>/context/) — mirrors getSystemPrompt() placement
  // (after the project block, before memory). Project-level
  // soul.md/rules.md in the session cwd override same-named global docs.
  const contextDocsBlock = getContextDocsPromptBlock({ workingDirectory: input.workingDirectory });
  if (contextDocsBlock) parts.push(contextDocsBlock);
  const blocks = input.memoryBlocks;
  if (blocks?.lessonsBlock) parts.push(blocks.lessonsBlock);
  if (blocks?.memoryBlock) parts.push(blocks.memoryBlock);
  if (blocks?.sourcesBlock) parts.push(blocks.sourcesBlock);
  return parts.join('\n');
}

/** Spawn argv fragment that pushes composed system prompt into OMP. */
export function getOmpSpawnSystemPromptArgs(append: string): string[] {
  return ['--append-system-prompt', append];
}

/**
 * Map a transport `err.code` to an agent-facing string for `browser_tool`
 * failures (copied from pi-agent.ts to keep both backends independent).
 */
function mapBrowserToolErrorCode(code: string): string | null {
  switch (code) {
    case 'BROWSER_NO_CAPABLE_CLIENT':
    case 'CAPABILITY_UNAVAILABLE':
      return 'No connected desktop client supports browser tools, or no client is currently connected. ' +
        'Ask the user to open this workspace from the Craft Agent desktop app.';
    case 'CLIENT_DISCONNECTED':
      return 'The desktop client that owned this browser session disconnected. ' +
        'Ask the user to reconnect and retry.';
    case 'CLIENT_REQUEST_TIMEOUT':
      return 'Browser operation timed out (>30s). The desktop client may be unresponsive.';
    case 'BROWSER_INSTANCE_NOT_OWNED':
      return 'That browser instance ID doesn\'t belong to this session. ' +
        'Use `windows` to list owned instances, or `open` to create a new one.';
    case 'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED':
      return 'File upload from a remote agent is not supported. ' +
        'Ask the user to attach the file to the session.';
    case 'BROWSER_REMOTE_EVALUATE_BLOCKED':
      return 'JavaScript evaluation is disabled on this desktop client. ' +
        'Ask the user to enable it in settings.';
    default:
      return null;
  }
}

/** Craft ThinkingLevel → OMP thinking level string (cwd `--thinking` whitelist). */
function mapThinkingLevel(level: ThinkingLevel): string {
  switch (level) {
    case 'off': return 'off';
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high': return 'high';
    case 'max': return 'max';
    default: return 'high'; // unknown craft level → safe OMP default
  }
}

/** OMP extension_ui_request methods that are always safe to auto-answer. */
const AUTO_ANSWER_METHODS: Record<string, true> = { setWidget: true, cancel: true };

/** Normalize a model id for fuzzy matching (case/separator-insensitive). */
function normalizeModelId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * OMP session transcript entry (one JSONL line of the session file).
 * `id` is a short 8-hex entry id; `parentId` chains entries. Verified in
 * docs/omp-rpc-notes.md §Branching.
 */
interface OmpTranscriptEntry {
  type?: string;
  id?: string;
  parentId?: string | null;
  message?: { role?: string };
}

interface OmpUsage {  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

function toAgentEventUsage(usage: OmpUsage | undefined): AgentEventUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input ?? 0,
    outputTokens: usage.output ?? 0,
    cacheReadTokens: usage.cacheRead,
    cacheCreationTokens: usage.cacheWrite,
    costUsd: usage.cost?.total,
  };
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  /** Command type — used for side effects on get_state responses. */
  command: string;
  timer: NodeJS.Timeout;
}

interface PendingPermission {
  /** OMP extension_ui_request id to answer. */
  uiRequestId: string;
  toolName: string;
  description: string;
}

// ============================================================
// OmpAgent
// ============================================================

export class OmpAgent extends BaseAgent {
  protected backendName = 'OMP';

  // Subprocess state
  private subprocess: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private subprocessReady: Promise<void> | null = null;
  private subprocessReadyResolve: (() => void) | null = null;
  private spawnError: Error | null = null;

  /** Permission policy captured at spawn — respawn required to change. */
  private autoApproveAtSpawn = false;

  // RPC bookkeeping
  private rpcIdCounter = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingPermissions = new Map<string, PendingPermission>();

  // Host-tool bridge state
  private pendingHostToolCalls = new Map<string, { cancelled: boolean }>();
  private pendingHostToolPermissions = new Map<string, (allowed: boolean) => void>();
  /**
   * Fingerprint (name list) of the host tool set last acknowledged by
   * set_host_tools; null before the first successful registration. Used to
   * skip redundant set_host_tools re-sends between turns.
   */
  private registeredHostToolNames: string | null = null;

  /** Pool reference for convenience (from this.config.mcpPool, same as PiAgent). */
  private get mcpPool(): McpClientPool | undefined {
    return this.config.mcpPool;
  }

  /**
   * Look up the bound project (if any) and return a snapshot for system-prompt injection.
   * Mirrors PiAgent.resolveProjectContext — safe to call at spawn time.
   */
  private resolveProjectContext(): ProjectPromptContext | null {
    const projectId = this.config.session?.projectId;
    if (!projectId) return null;

    try {
      const root = this.config.workspace.rootPath;
      const project = loadProjectById(root, projectId);
      if (!project) return null;
      const slug = project.config.slug;
      return {
        name: project.config.name,
        description: project.config.description,
        details: project.config.details,
        assetsPath: getProjectAssetsPath(root, slug),
        assets: listProjectAssets(root, slug).map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
        memoryPath: getProjectMemoryPath(root, slug),
        memoryContent: loadProjectMemory(root, slug) ?? undefined,
      };
    } catch (error) {
      this.debug(`[resolveProjectContext] Failed to load project ${projectId}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Compose the --append-system-prompt payload: the static craft runtime
   * briefing plus (when present) user preferences, bound-project context, and
   * the self-learning memory blocks (learned lessons + workspace memory)
   * after the project memory block, mirroring getSystemPrompt ordering.
   * Evaluated at spawn time, so a respawn picks up memory updates.
   */
  private buildCraftContextPrompt(): string {
    const projectContext = this.resolveProjectContext();
    return composeOmpAppendSystemPrompt({
      workingDirectory: this.resolvedCwd(),
      preferences: formatPreferencesForPrompt(),
      projectContextBlock: projectContext ? formatProjectContextForPrompt(projectContext) : null,
      memoryBlocks: this.config.memoryBlocks,
    });
  }
  private _sessionToolContext: SessionToolContext | null = null;

  // Event stream
  private eventQueue = new EventQueue();
  private _isProcessing = false;
  private abortReason: AbortReason | undefined;

  // Turn state (mirrors PiEventAdapter bookkeeping)
  private toolNames = new Map<string, string>();
  private subTurnCounter = 0;
  private messageSubTurnId: string | null = null;
  private hasStreamedDeltas = false;
  /** Sub-turn id for the current thinking block (`${prefix}` scheme shared with text). */
  private thinkingSubTurnId: string | null = null;
  /** Accumulated thinking text for the in-flight thinking block. */
  private thinkingText = '';
  private lastUsage: AgentEventUsage | undefined;

  // OMP session identity (reported via get_state after ready)
  private ompSessionId: string | null = null;
  /** Path of the active OMP transcript (get_state.data.sessionFile); best effort. */
  private ompSessionFile: string | null = null;
  /** Number of branch anchors emitted this process run (supportsBranching gate). */
  private emittedAnchorCount = 0;
  /** Turn awaiting OMP-transcript anchor resolution (deferred to agent_end — transcript flushes after message_end). */
  private pendingAnchorTurnId: string | null = null;
  /** Whether the branch-fork handshake already ran for this agent instance. */
  private branchHandshakeApplied = false;

  constructor(config: BackendConfig) {
    super(config, config.model || '');

    // OMP branching (G3): supported via transcript entry anchors. The live
    // gate is the supportsBranching getter below — a branch needs at least
    // one anchor (fresh completed turn this run) or an initialized OMP
    // session identity from previous persisted state.
    this.ompSessionId = config.session?.sdkSessionId || null;

    if (!config.isHeadless) {
      this.startConfigWatcher();
    }
  }

  /**
   * OMP supports branching only when there is something to anchor the branch
   * point to: a completed assistant turn this run (anchor captured from the
   * OMP transcript JSONL), or a session identity persisted from earlier turns
   * (anchors for its messages live in the omp-turn-anchors sidecar).
   */
  override get supportsBranching(): boolean {
    return this._supportsBranching
      && (this.emittedAnchorCount > 0 || !!this.ompSessionId || !!this.config.session?.branchFromMessageId);
  }

  // ============================================================
  // Subprocess Management
  // ============================================================

  private resolvedCwd(): string {
    const wd = this.workingDirectory;
    if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
    if (wd === '~') return homedir();
    return wd;
  }

  private async ensureSubprocess(): Promise<void> {
    if (this.subprocess && this.subprocessReady) {
      await this.subprocessReady;
      if (this.spawnError) throw this.spawnError;
    } else {
      await this.spawnSubprocess();
    }
    // Branch fork: after spawn, attach to the parent OMP transcript and cut
    // it at the persisted anchor. Runs exactly once per agent instance.
    await this.applyOmpBranchHandshake();
  }

  // ============================================================
  // Branching (G3)
  // ============================================================

  /** OMP transcript directory for a craft session (`<session>/omp`). */
  private getOmpSessionDir(craftSessionId: string): string {
    return join(getSessionPath(this.config.workspace.rootPath, craftSessionId), 'omp');
  }

  /**
   * Latest OMP transcript file in a session dir.
   * Filenames carry a timestamp + sessionId suffix (`<ts>_<sessionId>.jsonl`,
   * docs/omp-rpc-notes.md §Branching): prefer an exact sessionId match,
   * otherwise fall back to the newest by name (timestamp-prefixed ⇒ sorted).
   */
  private resolveOmpTranscriptFile(ompDir: string, sessionId: string | null | undefined): string | null {
    let names: string[];
    try {
      names = readdirSync(ompDir).filter((n) => n.endsWith('.jsonl')).sort();
    } catch {
      return null;
    }
    if (names.length === 0) return null;
    if (sessionId) {
      const match = names.filter((n) => n.includes(sessionId)).at(-1);
      if (match) return join(ompDir, match);
    }
    const last = names.at(-1);
    return last ? join(ompDir, last) : null;
  }

  /**
   * Tolerantly parse an OMP session JSONL transcript into entry chain order.
   */
  private parseOmpTranscript(path: string): OmpTranscriptEntry[] {
    const entries: OmpTranscriptEntry[] = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as OmpTranscriptEntry);
      } catch {
        this.debug(`Skipped malformed OMP transcript line in ${path}`);
      }
    }
    return entries;
  }

  /**
   * Entry-id of the last assistant message entry in the OMP transcript.
   * OMP persists each message entry synchronously at message_end (verified in
   * session-manager.ts comment: "`message_end` persists the finished message"),
   * so at our message_end handler the just-finished reply is already on disk.
   */
  private readLastAssistantEntryId(): string | null {
    const file = this.ompSessionFile
      ?? (this.config.session?.id
        ? this.resolveOmpTranscriptFile(this.getOmpSessionDir(this.config.session.id), this.ompSessionId)
        : null);
    if (!file) return null;
    try {
      const entries = this.parseOmpTranscript(file);
      for (const e of [...entries].reverse()) {
        if (e.type === 'message' && e.message?.role === 'assistant' && e.id) return e.id;
      }
    } catch (error) {
      this.debug(`Failed reading OMP transcript for anchor: ${error}`);
    }
    return null;
  }

  /**
   * SessionManager preflight for branched sessions (createSession →
   * getOrCreateAgent → ensureBranchReady): spawn the subprocess and apply the
   * fork. Throws (rollback-worthy) on any failure — an OMP branch must never
   * silently start with the wrong context.
   */
  override async ensureBranchReady(): Promise<void> {
    if (!this.config.session?.branchFromMessageId) return;
    await this.ensureSubprocess(); // includes applyOmpBranchHandshake
  }

  /**
   * Fork the branch session from the parent OMP transcript at the persisted
   * anchor (branchFromSdkTurnId = assistant transcript entry id).
   *
   * OMP's `branch` RPC accepts only a USER message entry id and cuts the new
   * session at that entry's parentId (VERIFIED probes, docs/omp-rpc-notes.md
   * §Branching):
   * - mid-history branch: the cut entry is the user entry directly after the
   *   anchor; we `switch_session` to the parent transcript then `branch` —
   *   OMP writes a NEW file into OUR session-dir (parent file untouched).
   * - tail branch (no user entry after the anchor): copy the parent
   *   transcript into our session-dir and `switch_session` to the copy
   *   (full-history fork; new turns append to the copy only).
   */
  private async applyOmpBranchHandshake(): Promise<void> {
    if (this.branchHandshakeApplied) return;
    const session = this.config.session;
    if (!session?.branchFromMessageId) return;

    const parentSessionPath = session.branchFromSessionPath;
    const anchorId = session.branchFromSdkTurnId;
    if (!parentSessionPath) {
      throw new Error('OMP branch preflight failed: missing branchFromSessionPath metadata');
    }
    if (!anchorId) {
      throw new Error('OMP branch preflight failed: missing branchFromSdkTurnId metadata (no OMP transcript anchor for the branch message)');
    }
    if (!this.subprocess) {
      throw new Error('OMP branch preflight failed: subprocess unavailable for fork handshake');
    }

    const parentFile = this.resolveOmpTranscriptFile(
      join(parentSessionPath, 'omp'),
      session.branchFromSdkSessionId,
    );
    if (!parentFile) {
      throw new Error(`OMP branch preflight failed: parent OMP transcript not found under ${join(parentSessionPath, 'omp')}`);
    }

    const entries = this.parseOmpTranscript(parentFile);
    const anchorIdx = entries.findIndex((e) => e.type === 'message' && e.id === anchorId);
    if (anchorIdx === -1) {
      throw new Error(`OMP branch preflight failed: anchor entry ${anchorId} not found in parent transcript (rewritten by compaction?)`);
    }
    const cutUserEntry = entries
      .slice(anchorIdx + 1)
      .find((e) => e.type === 'message' && e.message?.role === 'user' && e.id);

    if (cutUserEntry) {
      await this.sendCommand('switch_session', { sessionPath: parentFile });
      const result = (await this.sendCommand('branch', { entryId: cutUserEntry.id }, 30_000)) as
        | { text?: string; cancelled?: boolean }
        | null;
      if (result?.cancelled) {
        throw new Error('OMP branch preflight failed: branch request was cancelled');
      }
      this.debug(
        `OMP branch applied: forked at entry ${anchorId} (cut before user entry ${cutUserEntry.id})`,
      );
    } else {
      const ownDir = this.getOmpSessionDir(session.id);
      const copyPath = join(ownDir, `branched-${Date.now()}.jsonl`);
      try {
        copyFileSync(parentFile, copyPath);
      } catch (error) {
        throw new Error(`OMP branch preflight failed: cannot copy parent transcript: ${error}`);
      }
      await this.sendCommand('switch_session', { sessionPath: copyPath });
      this.debug(`OMP branch applied: tail fork via transcript copy (anchor ${anchorId} is the last message entry)`);
    }

    // Capture the forked session identity (branch() allocates a fresh sessionId).
    try {
      const state = (await this.sendCommand('get_state', {})) as
        | { sessionId?: string; sessionFile?: string }
        | null;
      if (state?.sessionFile) this.ompSessionFile = state.sessionFile;
      if (state?.sessionId && state.sessionId !== this.ompSessionId) {
        this.ompSessionId = state.sessionId;
        this.config.onSdkSessionIdUpdate?.(state.sessionId);
      }
    } catch (error) {
      this.debug(`get_state after branch handshake failed: ${error}`);
    }
    this.branchHandshakeApplied = true;
  }

  // ============================================================
  // Subprocess spawn
  // ============================================================

  private async spawnSubprocess(): Promise<void> {
    // OMP_CLI_PATH env → toolchain/PATH lookup → friendly error while the
    // toolchain is still installing → last-resort 'omp' (ENOENT path preserved).
    const bin = await resolveOmpExecutableOrExplain();
    const cwd = this.resolvedCwd();

    this.autoApproveAtSpawn = this.permissionManager.getPermissionMode() === 'allow-all';

    // --mode rpc: JSONL protocol (docs/omp-rpc-notes.md).
    // --session-dir: OMP persists its own transcript inside the craft session
    //   folder (<workspace>/sessions/<craftSessionId>/omp) — per-craft-session
    //   isolation, history kept in both stores (mirror; craft owns history).
    // --append-system-prompt: craft runtime context (host tools, mirror policy).
    // --approval-mode yolo: craft permission mode 'allow-all' → full yolo
    //   (OMP's strongest auto mode: zero approval prompts, incl. destructive).
    const args = ['--mode', 'rpc'];
    const craftSessionId = this.config.session?.id || this._sessionId || '';
    const ompSessionDir = craftSessionId ? this.getOmpSessionDir(craftSessionId) : null;
    if (ompSessionDir) {
      try {
        mkdirSync(ompSessionDir, { recursive: true });
        args.push('--session-dir', ompSessionDir);
      } catch (error) {
        this.debug(`Failed to create OMP session dir ${ompSessionDir} (${error}); falling back to --no-session`);
        args.push('--no-session');
      }
    } else {
      args.push('--no-session');
    }
    args.push(...getOmpSpawnSystemPromptArgs(this.buildCraftContextPrompt()));
    if (this.autoApproveAtSpawn) {
      args.push('--approval-mode', 'yolo');
    }

    this.debug(`Spawning OMP subprocess: ${bin} ${args.join(' ')} (cwd=${cwd})`);

    this.subprocessReady = new Promise<void>((resolve) => {
      this.subprocessReadyResolve = resolve;
    });

    const env: NodeJS.ProcessEnv = await withToolchainPathPrefix({
      ...process.env,
      ...getProxyEnvVars(),
      // User-configured runtime env overrides (config runtime.envOverrides);
      // per-session envOverrides below always win.
      ...getRuntimeEnvOverrides(),
      ...(this.config.envOverrides ?? {}),
    });

    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.subprocess = child;

    this.readline = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    this.readline.on('line', (line: string) => this.handleLine(line));

    child.stderr?.on('data', (data: Buffer) => {
      const trimmed = data.toString().trim();
      if (trimmed) this.debug(`[omp stderr] ${trimmed}`);
    });

    child.on('exit', (code, signal) => this.handleSubprocessExit(code, signal));

    child.on('error', (error) => {
      this.spawnError = error;
      this.debug(`OMP subprocess error: ${error.message}`);
      this.subprocessReadyResolve?.();
      if (this._isProcessing) {
        this.eventQueue.enqueue({ type: 'error', message: `OMP subprocess error: ${error.message}` });
        this.eventQueue.complete();
      }
    });

    // Ready timeout — OMP prints the ready frame on startup (notes §Lifecycle.2).
    const childRef = child;
    await Promise.race([
      this.subprocessReady.then(() => {
        if (this.spawnError) throw this.spawnError;
      }),
      new Promise<void>((_, reject) => {
        const timer = setTimeout(() => {
          if (this.subprocess === childRef && this.subprocessReadyResolve) {
            reject(new Error('OMP did not send ready frame within 20s'));
          }
        }, 20_000);
        this.subprocessReady!.then(() => clearTimeout(timer));
      }),
    ]);

    // Capture the OMP session id for getSessionId(); best effort.
    this.sendCommand('get_state', {})
      .then((data) => {
        const state = (data as { sessionId?: string; sessionFile?: string } | null);
        const sid = state?.sessionId;
        if (sid && sid !== this.ompSessionId) {
          this.ompSessionId = sid;
          this.config.onSdkSessionIdUpdate?.(sid);
        }
        if (state?.sessionFile) this.ompSessionFile = state.sessionFile;
      })
      .catch((err) => this.debug(`get_state after ready failed: ${err}`));

    // Bridge craft session tools (spawn_session, call_llm, browser_tool, …)
    // into OMP via set_host_tools; best effort — the session still works
    // without them, tools just won't be visible to the OMP model.
    this.registerHostTools()
      .catch((err) => this.debug(`set_host_tools failed: ${err instanceof Error ? err.message : err}`));
  }

  /**
   * Graceful shutdown: close stdin → SIGTERM → SIGKILL fallback.
   */
  private async killSubprocessGracefully(timeoutMs = 2_000): Promise<void> {
    const child = this.subprocess;
    if (!child) return;

    const waitForExit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      if (child.exitCode !== null || child.signalCode) {
        resolve({ code: child.exitCode, signal: child.signalCode });
        return;
      }
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    try {
      child.stdin?.end();
    } catch {
      // stdin may already be closed
    }
    child.kill('SIGTERM');

    let result = await Promise.race([
      waitForExit,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!result && this.subprocess === child) {
      this.debug(`OMP subprocess did not exit after ${timeoutMs}ms; SIGKILL`);
      child.kill('SIGKILL');
      result = await Promise.race([
        waitForExit,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
      ]);
    }

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.subprocess === child) {
      this.subprocess = null;
    }
    this.subprocessReady = null;
    this.subprocessReadyResolve = null;
  }

  private killSubprocessSync(): void {
    const child = this.subprocess;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    child.kill('SIGTERM');
    // Do not block destroy() on exit; process will be reaped or SIGKILLed by
    // the OS on parent teardown. detach-free children die with us.
    this.subprocess = null;
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    this.subprocessReady = null;
    this.subprocessReadyResolve = null;
  }

  private handleSubprocessExit(code: number | null, signal: string | null): void {
    this.debug(`OMP subprocess exited: code=${code}, signal=${signal}`);

    this.subprocess = null;
    this.readline = null;
    this.subprocessReady = null;
    this.subprocessReadyResolve = null;
    this.registeredHostToolNames = null;

    const exitReason = signal ? `signal ${signal}` : `code ${code}`;
    if (this._isProcessing) {
      this.eventQueue.enqueue({
        type: 'error',
        message: `OMP subprocess exited unexpectedly (${exitReason})`,
      });
      this.eventQueue.complete();
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`OMP subprocess exited (${exitReason})`));
    }
    this.pendingRequests.clear();

    // Deny pending permissions so the UI unblocks.
    this.pendingPermissions.clear();
    for (const [, resolve] of this.pendingHostToolPermissions) resolve(false);
    this.pendingHostToolPermissions.clear();
    this.pendingHostToolCalls.clear();
  }

  // ============================================================
  // RPC Plumbing
  // ============================================================

  private send(msg: Record<string, unknown>): void {
    if (!this.subprocess?.stdin?.writable) {
      this.debug(`Cannot send to OMP subprocess (stdin closed): ${JSON.stringify(msg).slice(0, 120)}`);
      return;
    }
    this.subprocess.stdin.write(JSON.stringify(msg) + '\n');
  }

  /**
   * Send an RPC command and await its `response` frame.
   */
  private sendCommand(
    command: string,
    extra: Record<string, unknown>,
    timeoutMs = OMP_COMMAND_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = `omp-cmd-${++this.rpcIdCounter}`;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        rejectPromise(new Error(`omp ${command} timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        command,
        timer,
        resolve: (data) => {
          clearTimeout(timer);
          resolvePromise(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      });

      this.send({ type: command, id, ...extra });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.debug(`OMP non-JSON stdout line ignored: ${trimmed.slice(0, 200)}`);
      return;
    }

    const type = msg.type as string;

    // Response framing (id-matched)
    if (type === 'response') {
      const id = String(msg.id ?? '');
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if (msg.success === false) {
          pending.reject(new Error(String(msg.error ?? `omp ${pending.command} failed`)));
        } else {
          pending.resolve(msg.data ?? true);
        }
      }
      return;
    }

    switch (type) {
      case 'ready':
        this.debug(`OMP ready (protocol v${msg.protocolVersion ?? '?'})`);
        this.subprocessReadyResolve?.();
        break;

      case 'extension_ui_request':
        this.handleExtensionUiRequest(msg);
        break;

      case 'host_tool_call':
        this.handleHostToolCall(msg);
        break;

      case 'host_tool_cancel': {
        const targetId = String(msg.targetId ?? '');
        const entry = this.pendingHostToolCalls.get(targetId);
        if (entry) entry.cancelled = true;
        break;
      }

      case 'agent_start':
        break;

      case 'agent_end':
        this.handleAgentEnd(msg);
        break;

      case 'turn_start':
        this.subTurnCounter = 0;
        this.messageSubTurnId = null;
        this.hasStreamedDeltas = false;
        this.thinkingSubTurnId = null;
        this.thinkingText = '';
        break;

      case 'turn_end': {
        const message = msg.message as { usage?: OmpUsage } | undefined;
        const usage = toAgentEventUsage(message?.usage);
        if (usage) this.lastUsage = usage;
        break;
      }

      case 'message_update':
        this.handleMessageUpdate(msg);
        break;

      case 'message_end':
        this.handleMessageEnd(msg);
        break;

      case 'tool_execution_start':
        this.handleToolExecutionStart(msg);
        break;

      case 'tool_execution_update':
        // Partial tool output — craft has no streaming tool-output event; skip.
        break;

      case 'tool_execution_end':
        this.handleToolExecutionEnd(msg);
        break;

      case 'auto_compaction_start':
        this.eventQueue.enqueue({ type: 'status', message: 'Compacting context...' });
        break;

      case 'auto_compaction_end':
        if (msg.errorMessage) {
          this.eventQueue.enqueue({ type: 'error', message: `Compaction failed: ${msg.errorMessage}` });
        } else {
          this.eventQueue.enqueue({ type: 'info', message: 'Compacted context to fit within limits' });
        }
        break;

      case 'extension_error':
        this.eventQueue.enqueue({
          type: 'error',
          message: `OMP extension error: ${String(msg.error ?? msg.message ?? 'unknown')}`,
        });
        break;

      // Informational only: available_commands_update, thinking_level_changed,
      // model_update, message_start, toolcall_* (surfaced via tool_execution_*).
      default:
        break;
    }
  }

  // ============================================================
  // Extension UI Requests
  // ============================================================

  private respondExtensionUi(id: unknown, approved: boolean, value?: unknown): void {
    this.send({
      type: 'extension_ui_response',
      id: String(id),
      approved,
      value: value ?? approved,
    });
  }

  /**
   * CRITICAL (protocol blocker, notes §Lifecycle.3): EVERY extension_ui_request
   * must be answered, otherwise the prompt pipeline stalls.
   *
   * Policy:
   * - setWidget / cancel → auto-approve immediately (pure UI bookkeeping).
   * - With --auto-approve (craft allow-all) or no permission callback → approve.
   * - Otherwise (craft ask/safe) → permission dialog: surface through craft's
   *   onPermissionRequest; respondToPermission() answers the RPC.
   */
  private handleExtensionUiRequest(msg: Record<string, unknown>): void {
    const id = msg.id;
    const method = String(msg.method ?? '');

    if (AUTO_ANSWER_METHODS[method]) {
      this.respondExtensionUi(id, true, true);
      return;
    }

    if (this.autoApproveAtSpawn || !this.onPermissionRequest) {
      this.respondExtensionUi(id, true, true);
      return;
    }

    // Permission dialog — proxy into craft's permission flow.
    const requestId = `omp-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const description = String(
      msg.message ?? msg.title ?? msg.question ?? msg.description ?? `OMP requested ${method}`,
    );
    this.pendingPermissions.set(requestId, {
      uiRequestId: String(id),
      toolName: `OMP ${method}`,
      description,
    });

    this.debug(`Permission prompt from OMP (${method}): ${description.slice(0, 100)}`);
    this.onPermissionRequest({
      requestId,
      toolName: `OMP ${method}`,
      description,
      type: 'admin_approval',
    });
  }

  respondToPermission(requestId: string, allowed: boolean, _alwaysAllow?: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.pendingPermissions.delete(requestId);
      this.respondExtensionUi(pending.uiRequestId, allowed, allowed);
      return;
    }
    const hostResolve = this.pendingHostToolPermissions.get(requestId);
    if (hostResolve) {
      this.pendingHostToolPermissions.delete(requestId);
      hostResolve(allowed);
    }
  }

  // ============================================================
  // Host Tools Bridge (set_host_tools / host_tool_call RPC)
  // ============================================================

  /**
   * Build the host tool set for OMP and register it via set_host_tools.
   *
   * Session tools + MCP source-proxy defs from the mcpPool are merged by the
   * shared buildSessionToolDefs builder (same browser_tool gate and call_llm
   * mini-model hint as PiAgent), deduplicated by name, converted to
   * RpcHostToolDefinition ({name, label?, description, parameters}).
   *
   * Source-proxy execution shares the PiAgent pool path (mcpPool.callTool) —
   * see executeHostSessionTool.
   */
  private async registerHostTools(): Promise<void> {
    const unique = buildSessionToolDefs({
      mcpPool: this.mcpPool,
      includePoolProxyDefs: true,
      miniModel: this.config.miniModel,
    });

    const tools = unique.map((d: SessionToolDef) => ({
      name: d.name,
      label: d.name,
      description: d.description,
      parameters: d.inputSchema as Record<string, unknown>,
      // 'essential' pins them into the model's primary tool schema; the OMP
      // default ('discoverable') would hide them behind the xd:// device
      // discovery layer where craft tools are not reachable (v1 bridge).
      loadMode: 'essential' as const,
    }));

    const data = (await this.sendCommand('set_host_tools', { tools })) as
      | { toolNames?: string[] }
      | null;
    this.registeredHostToolNames = unique.map((d) => d.name).join('');
    this.debug(`Registered OMP host tools: ${(data?.toolNames ?? []).join(', ') || `(sent ${tools.length})`}`);
  }

  /**
   * Re-register host tools when the pool's proxy set changed and OMP is idle.
   * set_host_tools mid-turn is not supported by OMP, so this only runs from
   * setSourceServers / chat entry while `!this._isProcessing`.
   */
  private async refreshHostToolsFromPool(): Promise<void> {
    if (!this.subprocess || this._isProcessing) return;
    // First registration happens in spawnSubprocess; only refresh afterwards.
    if (this.registeredHostToolNames === null) return;
    const current = buildSessionToolDefs({
      mcpPool: this.mcpPool,
      includePoolProxyDefs: true,
      miniModel: this.config.miniModel,
    });
    if (current.map((d) => d.name).join('') === this.registeredHostToolNames) return;
    try {
      await this.registerHostTools();
    } catch (err) {
      this.debug(`set_host_tools refresh failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Source activation/deactivation syncs the pool (BaseAgent), then we
   * re-register host tools so newly connected source proxies become visible
   * to the OMP model without a respawn.
   */
  override async setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[],
  ): Promise<void> {
    await super.setSourceServers(mcpServers, apiServers, intendedSlugs);
    await this.refreshHostToolsFromPool();
  }

  /**
   * OMP needs craft to execute a registered host tool. Arrives mid-turn:
   * MUST resolve without making RPC calls back into OMP (deadlock).
   */
  private handleHostToolCall(msg: Record<string, unknown>): void {
    const frameId = String(msg.id ?? '');
    const toolName = String(msg.toolName ?? 'tool');
    const args = (msg.arguments as Record<string, unknown> | undefined) ?? {};
    if (!frameId) return;

    this.debug(`host_tool_call: ${toolName} (frame ${frameId})`);
    void this.executeHostToolCall(frameId, toolName, args).catch((error) => {
      this.debug(`host_tool_call ${toolName} crashed: ${error instanceof Error ? error.message : error}`);
    });
  }

  private async executeHostToolCall(
    frameId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const entry = { cancelled: false };
    this.pendingHostToolCalls.set(frameId, entry);

    const finish = (text: string, isError: boolean): void => {
      this.pendingHostToolCalls.delete(frameId);
      if (entry.cancelled) return; // OMP already moved on (host_tool_cancel)
      this.send({
        type: 'host_tool_result',
        id: frameId,
        result: { content: [{ type: 'text', text }] },
        ...(isError ? { isError: true } : {}),
      });
    };

    try {
      // Permission gate: yolo (craft allow-all) executes immediately;
      // ask/safe routes through craft's permission dialog like OMP's own
      // extension_ui permission prompts.
      if (!this.autoApproveAtSpawn && this.onPermissionRequest) {
        const allowed = await new Promise<boolean>((resolve) => {
          const requestId = `omp-host-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          this.pendingHostToolPermissions.set(requestId, resolve);
          this.onPermissionRequest!({
            requestId,
            toolName,
            description: `OMP agent wants to run craft tool '${toolName}'`,
            type: 'admin_approval',
          });
          // Fail-safe: never hang the turn if the dialog answer is lost.
          setTimeout(() => {
            if (this.pendingHostToolPermissions.delete(requestId)) resolve(false);
          }, OMP_HOST_TOOL_TIMEOUT_MS);
        });
        if (!allowed) {
          finish(`Denied by user: craft declined to execute '${toolName}'.`, true);
          return;
        }
      }

      const execution = this.executeHostSessionTool(toolName, args);
      const timeout = new Promise<{ content: string; isError: boolean }>((resolve) => {
        setTimeout(
          () => resolve({ content: `Host tool '${toolName}' timed out after ${Math.floor(OMP_HOST_TOOL_TIMEOUT_MS / 1000)}s`, isError: true }),
          OMP_HOST_TOOL_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([execution, timeout]);
      finish(result.content, result.isError);
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error), true);
    }
  }

  /**
   * Route + execute a host tool with the same semantics as
   * PiAgent.routeToolCall/handleToolExecute: MCP pool proxy tools dispatch to
   * mcpPool.callTool first, then the mcp__session__* session-tool registry.
   */
  private async executeHostSessionTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    // MCP source-proxy tool — same execution path as PiAgent.handleToolExecute
    // (mcpPool.callTool by proxy name). No SESSION_TOOL_REGISTRY entry exists
    // for these; the pool resolves mcp__{slug}__{tool} → original tool.
    if (this.mcpPool?.isProxyTool(toolName)) {
      try {
        const result = await this.mcpPool.callTool(toolName, args);
        return { content: result.content, isError: result.isError };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `MCP source tool '${toolName}' failed: ${msg}`, isError: true };
      }
    }

    const strippedName = toolName.startsWith('mcp__session__')
      ? toolName.slice('mcp__session__'.length)
      : toolName;

    if (!SESSION_TOOL_NAMES.has(strippedName)) {
      return { content: `Unknown host tool: ${toolName}`, isError: true };
    }

    try {
      // call_llm — shared BaseAgent pre-execution pipeline (uses this.queryLlm)
      if (strippedName === 'call_llm') {
        try {
          const result = await this.preExecuteCallLlm(args);
          return { content: result.text || '(Model returned empty response)', isError: false };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: `call_llm failed: ${msg}`, isError: true };
        }
      }

      // spawn_session — shared BaseAgent pre-execution pipeline (uses onSpawnSession)
      if (strippedName === 'spawn_session') {
        try {
          const result = await this.preExecuteSpawnSession(args);
          return { content: JSON.stringify(result, null, 2), isError: false };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: `spawn_session failed: ${msg}`, isError: true };
        }
      }

      // github_user — brokered GitHub /user (token stays inside broker.perform)
      if (strippedName === 'github_user') {
        try {
          const result = await executeGithubUserTool({
            workspaceId: String(args.workspaceId ?? ''),
            connectionId: String(args.connectionId ?? ''),
            consumerId: typeof args.consumerId === 'string' ? args.consumerId : undefined,
          });
          return { content: JSON.stringify(result), isError: false };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: `github_user failed: ${msg}`, isError: true };
        }
      }

      // browser_tool — desktop browser pane callbacks from the session registry
      if (strippedName === 'browser_tool') {
        const callbacks = getSessionScopedToolCallbacks(this._sessionId);
        const browserFns = callbacks?.browserPaneFns;
        if (!browserFns) {
          return { content: 'Browser window controls are not available. This tool requires the desktop app.', isError: true };
        }
        try {
          const result = await executeBrowserToolCommand({
            command: (args.command as string | string[]) ?? '',
            fns: browserFns,
            sessionId: this._sessionId,
          });

          let content = result.output;
          if (result.image) {
            const sessionPath = getSessionPath(this.config.workspace.rootPath, this._sessionId);
            const imageBuffer = Buffer.from(result.image.data, 'base64');
            const ext = result.image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
            const saved = saveBinaryResponse(sessionPath, `browser-screenshot.${ext}`, imageBuffer, result.image.mimeType);

            if (saved.type === 'file_download') {
              content += [
                '',
                `Saved screenshot: ${saved.path}`,
                '',
                '```image-preview',
                JSON.stringify({ src: saved.path, title: 'Browser Screenshot' }, null, 2),
                '```',
              ].join('\n');
            } else {
              content += `\n\n[Screenshot captured (${Math.round(result.image.sizeBytes / 1024)}KB ${result.image.mimeType}) but failed to save: ${saved.error}]`;
            }
          }

          return { content, isError: false };
        } catch (error) {
          const rawCode = (error as { code?: unknown } | null)?.code;
          const code = typeof rawCode === 'string' ? rawCode : '';
          const msg = error instanceof Error ? error.message : String(error);
          const friendly = mapBrowserToolErrorCode(code) ?? msg;
          return { content: friendly, isError: true };
        }
      }

      const def = SESSION_TOOL_REGISTRY.get(strippedName);
      if (!def) {
        return { content: `Unknown session tool: ${strippedName}`, isError: true };
      }
      if (!def.handler) {
        return {
          content: `Session tool '${strippedName}' is backend-executed (${def.executionMode}) but has no OmpAgent adapter implementation.`,
          isError: true,
        };
      }

      const ctx = this.getSessionToolContext();
      const result: SessionToolResult = await def.handler(ctx, args);
      const text = result.content.map((c) => c.text).join('\n');
      return { content: text, isError: !!result.isError };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.debug(`Host session tool ${strippedName} failed: ${msg}`);
      return { content: `Session tool error: ${msg}`, isError: true };
    }
  }

  /**
   * SessionToolContext for registry-executed tools — same construction as
   * PiAgent.getSessionToolContext, cached per agent instance.
   */
  private getSessionToolContext(): SessionToolContext {
    if (this._sessionToolContext) return this._sessionToolContext;

    const sessionId = this.config.session?.id || '';
    const workspacePath = this.config.workspace.rootPath;
    const workspaceId = this.config.workspace.id;

    this._sessionToolContext = createClaudeContext({
      sessionId,
      workspacePath,
      workspaceId,
      onPlanSubmitted: (planPath: string) => {
        setLastPlanFilePath(sessionId, planPath);
        this.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request: unknown) => {
        this.onAuthRequest?.(request as never);
      },
    });

    attachSessionSelfManagementBindings(this._sessionToolContext, sessionId);

    return this._sessionToolContext;
  }

  // ============================================================
  // Event Mapping (omp RPC events → craft AgentEvent)
  // ============================================================

  private nextSubTurnId(prefix: string): string {
    return `omp-${prefix}-${++this.subTurnCounter}`;
  }

  private handleMessageUpdate(msg: Record<string, unknown>): void {
    const amEvent = msg.assistantMessageEvent as { type?: string; delta?: string; content?: string } | undefined;
    if (!amEvent) return;

    if (amEvent.type === 'text_start' && !this.messageSubTurnId) {
      this.messageSubTurnId = this.nextSubTurnId('m');
    }

    // Thinking blocks (kimi-k3 reasoning etc.) stream as thinking_* events.
    // Runtime stream only — thinking never lands in history/title-gen/summary
    // (extractMessageText filters to type==='text' entries, and thinking
    // deltas are enqueued as separate thinking_* AgentEvents, not Message).
    if (amEvent.type === 'thinking_start') {
      this.thinkingSubTurnId = this.nextSubTurnId('t');
      this.thinkingText = '';
      return;
    }

    if (amEvent.type === 'thinking_delta' && amEvent.delta) {
      if (!this.thinkingSubTurnId) {
        this.thinkingSubTurnId = this.nextSubTurnId('t');
      }
      this.thinkingText += amEvent.delta;
      this.eventQueue.enqueue({
        type: 'thinking_delta',
        text: amEvent.delta,
        turnId: this.thinkingSubTurnId,
      });
      return;
    }

    if (amEvent.type === 'thinking_end') {
      const text = (amEvent.content ?? this.thinkingText) || this.thinkingText;
      if (text) {
        this.eventQueue.enqueue({
          type: 'thinking_complete',
          text,
          turnId: this.thinkingSubTurnId ?? this.nextSubTurnId('t'),
        });
      }
      this.thinkingSubTurnId = null;
      this.thinkingText = '';
      return;
    }

    if (amEvent.type === 'text_delta' && amEvent.delta) {
      this.hasStreamedDeltas = true;
      if (!this.messageSubTurnId) {
        this.messageSubTurnId = this.nextSubTurnId('m');
      }
      this.eventQueue.enqueue({
        type: 'text_delta',
        text: amEvent.delta,
        turnId: this.messageSubTurnId,
      });
    }
    // toolcall_* has no craft AgentEvent counterpart
    // (see PiEventAdapter parity in pi-agent.ts) — skipped.
  }

  private extractMessageText(message: { content?: unknown }): string {
    if (!Array.isArray(message.content)) return '';
    return message.content
      .filter((c): c is { type: string; text: string } =>
        typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text')
      .map((c) => c.text)
      .join('');
  }

  private handleMessageEnd(msg: Record<string, unknown>): void {
    const message = msg.message as {
      role?: string;
      content?: unknown;
      usage?: OmpUsage;
      stopReason?: string;
    } | undefined;
    if (!message || message.role !== 'assistant') return;

    const usage = toAgentEventUsage(message.usage);
    if (usage) this.lastUsage = usage;

    const text = this.extractMessageText(message);
    if (text) {
      const turnId = this.messageSubTurnId ?? this.nextSubTurnId('m');
      this.eventQueue.enqueue({
        type: 'text_complete',
        text,
        // A turn that ended for tool calls continues afterwards — mark
        // intermediate so the UI stitches the follow-up text.
        isIntermediate: message.stopReason === 'toolUse',
        turnId,
      });

      // Branch anchoring (G3): mark the final message of a turn for anchor
      // capture. The OMP transcript jsonl flushes AFTER message_end events,
      // so resolving the entry id here races the mirror write (observed: the
      // first turn after spawn loses its anchor, later turns by accident find
      // entries from prior turns). Resolution happens in handleAgentEnd.
      if (message.stopReason !== 'toolUse') {
        this.pendingAnchorTurnId = turnId;
      }
    }

    this.messageSubTurnId = null;
    this.hasStreamedDeltas = false;
  }

  private handleToolExecutionStart(msg: Record<string, unknown>): void {
    const toolCallId = String(msg.toolCallId ?? '');
    const toolName = String(msg.toolName ?? 'tool');
    this.toolNames.set(toolCallId, toolName);

    this.eventQueue.enqueue({
      type: 'tool_start',
      toolName,
      toolUseId: toolCallId,
      input: (msg.args as Record<string, unknown>) ?? {},
      intent: msg.intent as string | undefined,
    });
  }

  private handleToolExecutionEnd(msg: Record<string, unknown>): void {
    const toolCallId = String(msg.toolCallId ?? '');
    const result = msg.result as { content?: Array<{ type: string; text?: string }> } | undefined;

    const resultText = Array.isArray(result?.content)
      ? result.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
      : '';

    this.eventQueue.enqueue({
      type: 'tool_result',
      toolUseId: toolCallId,
      toolName: this.toolNames.get(toolCallId) ?? (msg.toolName as string | undefined),
      result: resultText,
      isError: Boolean(msg.isError),
    });
    this.toolNames.delete(toolCallId);
  }

  private handleAgentEnd(msg: Record<string, unknown>): void {
    // Final usage lives on the last assistant message (notes §Events.agent_end).
    if (!this.lastUsage && Array.isArray(msg.messages)) {
      for (let i = msg.messages.length - 1; i >= 0; i--) {
        const m = msg.messages[i] as { role?: string; usage?: OmpUsage };
        if (m?.role === 'assistant' && m.usage) {
          this.lastUsage = toAgentEventUsage(m.usage);
          break;
        }
      }
    }

    const usage = this.lastUsage;
    this.lastUsage = undefined;
    this._isProcessing = false;

    // Branch anchoring (G3): by agent_end OMP has flushed its transcript —
    // resolve the pending anchor now (craft → omp-turn-anchors sidecar role,
    // same as pi_turn_anchor).
    if (this.pendingAnchorTurnId) {
      const turnId = this.pendingAnchorTurnId;
      this.pendingAnchorTurnId = null;
      const entryId = this.readLastAssistantEntryId();
      if (entryId) {
        this.emittedAnchorCount += 1;
        this.eventQueue.enqueue({ type: 'omp_turn_anchor', turnId, entryId });
      } else {
        this.debug('No OMP transcript entry found for anchor — this turn is unbranchable');
      }
    }

    this.eventQueue.enqueue(usage ? { type: 'complete', usage } : { type: 'complete' });
    this.eventQueue.complete();

    // Session mirror debug: after each turn, log the OMP-side session state /
    // transcript path so it's traceable where OMP persisted its mirror files.
    this.sendCommand('get_state', {})
      .then((data) => {
        const state = (data ?? {}) as { sessionId?: string; sessionFile?: string; sessionName?: string };
        this.debug(
          `Post-turn OMP session state: sessionId=${state.sessionId ?? '?'}` +
          (state.sessionFile ? ` file=${state.sessionFile}` : '') +
          (state.sessionName ? ` name=${state.sessionName}` : ''),
        );
      })
      .catch((error) => this.debug(`Post-turn get_state failed: ${error instanceof Error ? error.message : error}`));
  }

  // ============================================================
  // Chat (AsyncGenerator backed by the subprocess event queue)
  // ============================================================

  protected async *chatImpl(
    message: string,
    attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    // Idle point between turns: pick up source-proxy changes since spawn.
    await this.refreshHostToolsFromPool();
    this._isProcessing = true;
    this.abortReason = undefined;
    this.eventQueue.reset();
    this.lastUsage = undefined;
    this.toolNames.clear();

    // Attachments: append textual references (OMP RPC prompt accepts images but
    // the wire contract for them is not part of the verified notes — keep to text).
    let effectiveMessage = message;
    if (attachments && attachments.length > 0) {
      const parts = attachments.map((a) =>
        a.text
          ? `[Attached file: ${a.name}]\n${a.text}`
          : `[Attached file: ${a.name} at ${a.path}]`,
      );
      effectiveMessage = `${message}\n\n${parts.join('\n\n')}`;
    }

    this.emitAutomationEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: message,
    });

    try {
      await this.ensureSubprocess();

      this.sendCommand('prompt', { message: effectiveMessage }).catch((error) => {
        // prompt is async — failure response = turn failed
        this.eventQueue.enqueue({ type: 'error', message: `OMP prompt failed: ${error.message}` });
        this.eventQueue.complete();
      });
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const typed = parseError(errorObj);
      if (typed.code !== 'unknown_error') {
        yield { type: 'typed_error', error: typed };
      }
      yield { type: 'error', message: errorObj.message };
      yield { type: 'complete' };
      this._isProcessing = false;
      return;
    }

    try {
      for await (const event of this.eventQueue.drain()) {
        yield event;
      }
    } finally {
      this._isProcessing = false;
    }
  }

  // ============================================================
  // Abort / Redirect
  // ============================================================

  isProcessing(): boolean {
    return this._isProcessing;
  }

  async abort(reason?: string): Promise<void> {
    this.debug(`abort(${reason ?? 'no reason'})`);
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop' });

    // Deny all pending permissions so the UI unblocks
    for (const [requestId, pending] of this.pendingPermissions) {
      this.respondExtensionUi(pending.uiRequestId, false, false);
      this.pendingPermissions.delete(requestId);
    }

    // RPC abort (notes §Commands.abort); don't hang if the subprocess is wedged.
    await this.sendCommand('abort', {}, 5_000).catch((error) => {
      this.debug(`OMP abort command failed: ${error.message}`);
    });

    this.eventQueue.complete();
  }

  forceAbort(reason: AbortReason): void {
    this.debug(`forceAbort(${reason})`);
    this.emitAutomationEvent('Stop', { hook_event_name: 'Stop' });

    this.abortReason = reason;
    this._isProcessing = false;

    for (const [, pending] of this.pendingPermissions) {
      this.respondExtensionUi(pending.uiRequestId, false, false);
    }
    this.pendingPermissions.clear();

    // For PlanSubmitted and AuthRequest, just interrupt the turn
    if (reason === AbortReason.PlanSubmitted || reason === AbortReason.AuthRequest) {
      this.eventQueue.complete();
      return;
    }

    // Hard stop: best-effort RPC abort, then SIGTERM → SIGKILL fallback.
    try {
      this.send({ type: 'abort' });
    } catch {
      // stdin may already be closed
    }
    this.eventQueue.complete();

    const child = this.subprocess;
    if (child) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && !child.signalCode) {
          this.debug('OMP subprocess still alive after forceAbort SIGTERM; SIGKILL');
          child.kill('SIGKILL');
        }
      }, 1_000).unref?.();
    }
  }

  /**
   * Redirect mid-stream via OMP's `steer` RPC command.
   * Delivered after the current tool finishes; events flow through the
   * existing generator. If OMP rejects the steer (response success:false),
   * emits steer_undelivered so the session layer can re-queue the message.
   */
  override redirect(message: string): boolean {
    if (!this._isProcessing || !this.subprocess) {
      this.forceAbort(AbortReason.Redirect);
      return false;
    }
    this.debug(`Steering mid-stream: "${message.slice(0, 100)}"`);
    this.sendCommand('steer', { message: message }).catch((error) => {
      this.debug(`OMP steer rejected: ${error.message}`);
      this.eventQueue.enqueue({ type: 'steer_undelivered', message });
    });
    return true;
  }

  // ============================================================
  // Model / Thinking Forwarding
  // ============================================================

  override setModel(model: string): void {
    super.setModel(model);
    if (!this.subprocess) return;
    void this.applyOmpModel(model);
  }

  /**
   * Resolve a craft model id to an OMP {provider, modelId} via a fuzzy match
   * against get_available_models, then send set_model. e.g. craft id
   * "kimi-K3" matches OMP entry {provider: 'rox', id: 'kimi-k3'}.
   */
  private async applyOmpModel(model: string): Promise<void> {
    try {
      const data = (await this.sendCommand('get_available_models', {})) as
        | Array<{ id?: string; modelId?: string; provider?: string; name?: string }>
        | { models?: Array<{ id?: string; modelId?: string; provider?: string; name?: string }> }
        | null;

      const models = (Array.isArray(data) ? data : data?.models) ?? [];
      const wanted = normalizeModelId(model);

      const candidate = models.find((m) => {
        const id = String(m.modelId ?? m.id ?? '');
        return normalizeModelId(id) === wanted || normalizeModelId(`${m.provider ?? ''}/${id}`) === wanted;
      }) ?? models.find((m) => {
        const id = normalizeModelId(String(m.modelId ?? m.id ?? ''));
        return id.endsWith(wanted) || wanted.endsWith(id);
      });

      if (!candidate) {
        this.debug(`No OMP model match for craft model "${model}" — keeping OMP default`);
        return;
      }

      const provider = String(candidate.provider ?? '');
      const modelId = String(candidate.modelId ?? candidate.id ?? '');
      await this.sendCommand('set_model', { provider, modelId });
      this.debug(`OMP model set to ${provider}/${modelId}`);
    } catch (error) {
      this.debug(`applyOmpModel(${model}) failed: ${error}`);
    }
  }

  override setThinkingLevel(level: ThinkingLevel): void {
    super.setThinkingLevel(level);
    if (!this.subprocess) return;
    const ompLevel = mapThinkingLevel(level);
    this.sendCommand('set_thinking_level', { level: ompLevel })
      .then(() => this.debug(`OMP thinking level set to ${ompLevel}`))
      .catch((error) => this.debug(`set_thinking_level(${ompLevel}) failed: ${error}`));
  }

  override setPermissionMode(mode: PermissionMode): void {
    super.setPermissionMode(mode);

    // The --approval-mode yolo flag is spawn-time. When the mode crosses the
    // allow-all boundary, the live subprocess has the wrong policy — kill it;
    // next chat() respawns with the correct flag. (Same constraint as model
    // pinning: no live-migration without respawn — documented in file header.)
    const wantAutoApprove = mode === 'allow-all';
    if (this.subprocess && this.autoApproveAtSpawn !== wantAutoApprove) {
      this.debug(`Permission mode flip requires OMP respawn (${this.autoApproveAtSpawn} → ${wantAutoApprove})`);
      void this.killSubprocessGracefully();
    }
  }

  // ============================================================
  // Session Identity
  // ============================================================

  override getSessionId(): string | null {
    return this.ompSessionId ?? this.config.session?.id ?? null;
  }

  override setSessionId(sessionId: string | null): void {
    this.ompSessionId = sessionId;
  }

  override setWorkspace(workspace: Workspace): void {
    super.setWorkspace(workspace);
    this.ompSessionId = null;
    this.killSubprocessSync();
  }

  override clearHistory(): void {
    this.ompSessionId = null;
    this.killSubprocessSync();
    super.clearHistory();
  }

  // ============================================================
  // One-shot LLM calls (`omp -p <prompt>`)
  // ============================================================

  private async runOneShot(prompt: string): Promise<string> {
    this.debug(`runOneShot: resolving bin (prompt ${prompt.length} chars)`);
    const bin = await resolveOmpExecutableOrExplain();
    this.debug(`runOneShot: bin=${bin}`);
    const cwd = this.resolvedCwd();
    const env = await withToolchainPathPrefix({
      ...process.env,
      ...getProxyEnvVars(),
      ...getRuntimeEnvOverrides(),
      ...(this.config.envOverrides ?? {}),
    });

    // spawn, not execFile: under Bun execFile ignores stdio overrides, and a
    // default piped stdin makes omp read the prompt from stdin and wait for
    // EOF forever (title generation / one-shot completions hang to timeout).
    // We explicitly end stdin → omp treats the argv prompt as authoritative.
    this.debug('runOneShot: spawning -p child');
    return new Promise<string>((resolve, reject) => {
      const child = spawn(bin, ['-p', prompt], { cwd, env });
      this.debug(`runOneShot: spawned pid=${child.pid}`);
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`omp -p timed out after ${OMP_ONESHOT_TIMEOUT_MS}ms`));
      }, OMP_ONESHOT_TIMEOUT_MS);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`omp -p failed: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`omp -p failed (exit ${code})${stderr ? ` (${stderr.trim().slice(0, 300)})` : ''}`));
          return;
        }
        resolve(stdout.trim());
      });
      child.stdin?.end();
    });
  }

  async runMiniCompletion(prompt: string): Promise<string | null> {
    try {
      const out = await this.runOneShot(prompt);
      return out || null;
    } catch (error) {
      this.debug(`runMiniCompletion failed: ${error}`);
      return null;
    }
  }

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const prompt = request.systemPrompt
      ? `${request.systemPrompt}\n\n${request.prompt}`
      : request.prompt;
    const text = await this.runOneShot(prompt);
    return { text, model: this._model };
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  async updateRuntimeConfig(update: BackendRuntimeUpdate): Promise<boolean> {
    this.config = { ...this.config, model: update.model };
    this._model = update.model;
    if (this.subprocess && update.model) {
      void this.applyOmpModel(update.model);
    }
    return true;
  }

  async disposeForRestart(): Promise<void> {
    this.stopConfigWatcher();
    await this.killSubprocessGracefully();
    this.debug('OmpAgent disposed for restart');
  }

  /**
   * Reconnect by killing subprocess — next chat() will spawn fresh.
   */
  async reconnect(): Promise<void> {
    this.killSubprocessSync();
    this.debug('OmpAgent reconnected (subprocess will be respawned on next chat)');
  }

  destroy(): void {
    this.stopConfigWatcher();

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('OmpAgent destroyed'));
    }
    this.pendingRequests.clear();
    this.pendingPermissions.clear();
    for (const [, resolve] of this.pendingHostToolPermissions) resolve(false);
    this.pendingHostToolPermissions.clear();
    this.pendingHostToolCalls.clear();

    this.killSubprocessSync();
    this.debug('OmpAgent destroyed');
  }

  protected override debug(message: string): void {
    this.onDebug?.(`[omp] ${message}`);
  }
}

/** Backward-compatible alias mirroring PiBackend naming. */
export { OmpAgent as OmpBackend };
