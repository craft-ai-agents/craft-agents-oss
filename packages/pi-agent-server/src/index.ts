#!/usr/bin/env node
/**
 * Pi Agent Server
 *
 * Out-of-process Pi agent server communicating via JSONL over stdio.
 * Wraps @mariozechner/pi-coding-agent SDK and communicates with the main
 * Electron process using a line-delimited JSON protocol.
 *
 * The main process spawns this as a child process. All Pi SDK interactions
 * (session creation, prompting, tool execution, permissions) happen here,
 * with events forwarded back to the main process for UI rendering.
 *
 * This design isolates the Pi SDK's ESM + heavy dependencies into a
 * separate process, avoiding bundling issues in the Electron main process.
 */

import http from 'node:http';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

// Pi SDK
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  AuthStorage as PiAuthStorage,
  ModelRegistry as PiModelRegistry,
  codingTools,
} from '@mariozechner/pi-coding-agent';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentToolResult,
  CreateAgentSessionOptions,
  ToolDefinition,
} from '@mariozechner/pi-coding-agent';

// Pi Agent Core types
import type {
  AgentTool,
} from '@mariozechner/pi-agent-core';

// Pi AI types
import type { TextContent as PiTextContent } from '@mariozechner/pi-ai';

// Direct source imports from shared (bundled by bun build)
import { handleLargeResponse, estimateTokens, TOKEN_LIMIT } from '../../shared/src/utils/large-response.ts';
import { getSessionPlansPath, getSessionPath } from '../../shared/src/sessions/storage.ts';
import { buildCallLlmRequest, withTimeout, LLM_QUERY_TIMEOUT_MS } from '../../shared/src/agent/llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { PI_TOOL_NAME_MAP, THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import { getDefaultSummarizationModel } from '../../shared/src/config/models.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { resolveSearchProvider } from './tools/search/resolve-provider.ts';
import { createSearchTool } from './tools/search/create-search-tool.ts';

// ============================================================
// Types — JSONL Protocol
// ============================================================

/** Messages from main process (stdin) */
type InboundMessage =
  | { type: 'init'; apiKey: string; model: string; cwd: string; thinkingLevel: string; workspaceRootPath: string; sessionId: string; sessionPath: string; workingDirectory: string; plansFolderPath: string; miniModel?: string; agentDir?: string; providerType?: string; authType?: string; workspaceId?: string; baseUrl?: string; branchFromSdkSessionId?: string; branchFromSessionPath?: string; piAuth?: { provider: string; credential: { type: 'api_key'; key: string } | { type: 'oauth'; access: string; refresh: string; expires: number } } }
  | { type: 'prompt'; id: string; message: string; systemPrompt: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }
  | { type: 'register_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'pre_tool_use_response'; requestId: string; action: 'allow' | 'block' | 'modify'; input?: Record<string, unknown>; reason?: string }
  | { type: 'abort' }
  | { type: 'mini_completion'; id: string; prompt: string }
  | { type: 'ensure_session_ready'; id: string }
  | { type: 'set_model'; model: string }
  | { type: 'compact'; id: string; customInstructions?: string }
  | { type: 'set_auto_compaction'; id: string; enabled: boolean }
  | { type: 'steer'; message: string }
  | { type: 'token_update'; piAuth: { provider: string; credential: { type: 'api_key'; key: string } | { type: 'oauth'; access: string; refresh: string; expires: number } } }
  | { type: 'shutdown' };

/** Proxy tool definition from main process */
interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Canonical tool metadata propagated on Pi tool start events */
interface ToolExecutionMetadata {
  intent?: string;
  displayName?: string;
  source: 'interceptor';
}

type EnrichedToolExecutionStartEvent = Extract<AgentSessionEvent, { type: 'tool_execution_start' }> & {
  toolMetadata?: ToolExecutionMetadata;
};

type OutboundAgentEvent = AgentSessionEvent | EnrichedToolExecutionStartEvent;

/** Messages to main process (stdout) */
interface OutboundReady { type: 'ready'; sessionId: string | null; callbackPort: number }
interface OutboundEvent { type: 'event'; event: OutboundAgentEvent }
interface OutboundPreToolUseReq {
  type: 'pre_tool_use_request';
  requestId: string;
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
}
interface OutboundToolExecReq { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown> }
interface OutboundSessionToolCompleted { type: 'session_tool_completed'; toolName: string; args: Record<string, unknown>; isError: boolean }
interface OutboundMiniResult { type: 'mini_completion_result'; id: string; text: string | null }
interface OutboundEnsureSessionReadyResult { type: 'ensure_session_ready_result'; id: string; sessionId: string | null }
interface OutboundCompactResult {
  type: 'compact_result';
  id: string;
  success: boolean;
  result?: { summary: string; firstKeptEntryId: string; tokensBefore: number };
  errorMessage?: string;
}
interface OutboundSetAutoCompactionResult {
  type: 'set_auto_compaction_result';
  id: string;
  success: boolean;
  enabled: boolean;
  errorMessage?: string;
}
interface OutboundSessionIdUpdate { type: 'session_id_update'; sessionId: string }
interface OutboundError { type: 'error'; message: string; code?: string }

type OutboundMessage =
  | OutboundReady
  | OutboundEvent
  | OutboundPreToolUseReq
  | OutboundToolExecReq
  | OutboundSessionToolCompleted
  | OutboundMiniResult
  | OutboundEnsureSessionReadyResult
  | OutboundCompactResult
  | OutboundSetAutoCompactionResult
  | OutboundSessionIdUpdate
  | OutboundError;

// ============================================================
// State
// ============================================================

let piSession: AgentSession | null = null;
let piModelRegistry: PiModelRegistry | null = null;
let moduleAuthStorage: PiAuthStorage | null = null;
let unsubscribeEvents: (() => void) | null = null;

// Init config (set on 'init' message)
let initConfig: Extract<InboundMessage, { type: 'init' }> | null = null;

// Mutable state
let currentUserMessage = '';

// Pending promises for async handshakes
const pendingPreToolUse = new Map<string, { resolve: (response: { action: string; input?: Record<string, unknown>; reason?: string }) => void }>();
const pendingToolExecutions = new Map<string, { resolve: (result: { content: string; isError: boolean }) => void }>();

// Pending session MCP tool calls for completion detection
const pendingSessionToolCalls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();

// Proxy tool definitions from main process
let proxyToolDefs: ProxyToolDef[] = [];

// Flag: proxy tools changed since last session creation — session needs recreation
let toolsChanged = false;

// Callback server for call_llm
let callbackServer: http.Server | null = null;
let callbackPort = 0;

// ============================================================
// JSONL I/O
// ============================================================

function send(msg: OutboundMessage): void {
  const line = JSON.stringify(msg);
  process.stdout.write(line + '\n');
}

function debugLog(message: string): void {
  // Write debug messages to stderr so they don't interfere with JSONL protocol
  process.stderr.write(`[pi-server] ${message}\n`);
}

/** Find the most recent .jsonl session file in a directory. */
function findMostRecentSessionFile(sessionDir: string): string | null {
  if (!existsSync(sessionDir)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const entry of readdirSync(sessionDir)) {
    if (!entry.endsWith('.jsonl')) continue;
    const fullPath = join(sessionDir, entry);
    const mtime = statSync(fullPath).mtimeMs;
    if (!best || mtime > best.mtime) {
      best = { path: fullPath, mtime };
    }
  }
  return best?.path ?? null;
}

// ============================================================
// Callback Server (for call_llm from session MCP server)
// ============================================================

async function startCallbackServer(): Promise<void> {
  if (callbackServer) return;

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/call-llm') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

      debugLog('Received call_llm request via callback server');
      const result = await preExecuteCallLlm(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      debugLog(`call_llm via callback failed: ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
      debugLog(`Callback server listening on 127.0.0.1:${callbackPort}`);
      resolve();
    });
    server.on('error', reject);
  });

  callbackServer = server;
}

function stopCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
    callbackPort = 0;
  }
}

// ============================================================
// Pi Session Management
// ============================================================

function resolvedCwd(): string {
  const wd = initConfig?.cwd || initConfig?.workingDirectory || process.cwd();
  if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
  if (wd === '~') return homedir();
  return wd;
}

function resolvePiModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
): PiModel<any> | undefined {
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-6")
  const bareId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;

  // If we know the auth provider, do an exact provider+model lookup first.
  // This avoids the getAll() ambiguity where the same model ID exists under
  // multiple providers (e.g., "gpt-5.2" under both "openai" and
  // "azure-openai-responses") and the wrong one matches first.
  if (piAuthProvider) {
    const exact = modelRegistry.find(piAuthProvider, bareId);
    if (exact) return exact;
  }

  // Fallback: search all available models
  const allModels = modelRegistry.getAll();
  const match = allModels.find(m => m.id === bareId || m.name === bareId);
  if (match) return match;

  // Try common providers with the model ID
  const providers = ['anthropic', 'openai', 'google'];
  for (const provider of providers) {
    const model = modelRegistry.find(provider, bareId);
    if (model) return model;
  }

  return undefined;
}

/**
 * Expose the active Pi model API/provider/base URL to the interceptor process.
 * This gives the interceptor a robust routing hint (instead of brittle URL-only matching).
 */
function setInterceptorApiHints(model: { api?: string; provider?: string; baseUrl?: string } | undefined): void {
  if (!model) {
    delete process.env.CRAFT_PI_MODEL_API;
    delete process.env.CRAFT_PI_MODEL_PROVIDER;
    delete process.env.CRAFT_PI_MODEL_BASE_URL;
    return;
  }

  process.env.CRAFT_PI_MODEL_API = model.api || '';
  process.env.CRAFT_PI_MODEL_PROVIDER = model.provider || '';
  process.env.CRAFT_PI_MODEL_BASE_URL = model.baseUrl || '';

  debugLog(
    `[interceptor-hint] api=${process.env.CRAFT_PI_MODEL_API || '-'} provider=${process.env.CRAFT_PI_MODEL_PROVIDER || '-'} baseUrl=${process.env.CRAFT_PI_MODEL_BASE_URL || '-'}`,
  );
}

/**
 * Create an in-memory auth storage pre-loaded with the user's credentials
 * and a model registry backed by it. Used by both the main session and
 * ephemeral queryLlm sessions.
 */
function createAuthenticatedRegistry(): {
  authStorage: PiAuthStorage;
  modelRegistry: PiModelRegistry;
} {
  // Reuse module-level authStorage if already created (allows token_update to mutate it).
  // Only create a new one on first call or after re-init.
  if (!moduleAuthStorage) {
    moduleAuthStorage = PiAuthStorage.inMemory();
  }
  const authStorage = moduleAuthStorage;
  if (initConfig?.piAuth) {
    const { provider, credential } = initConfig.piAuth;
    authStorage.set(provider, credential);
    debugLog(`Injected ${credential.type} credential for provider: ${provider}`);
  } else if (initConfig?.apiKey) {
    const hasCustomEndpoint = !!initConfig.baseUrl?.trim();
    if (hasCustomEndpoint) {
      throw new Error(
        'Custom endpoint in Craft Agents Backend mode requires explicit provider selection. ' +
        'Use a provider preset in Pi API key mode, or use Anthropic API key mode for arbitrary compatible endpoints.'
      );
    }

    authStorage.set('anthropic', { type: 'api_key', key: initConfig.apiKey });
    debugLog('Injected API key into auth storage (legacy fallback)');
  }
  return { authStorage, modelRegistry: new PiModelRegistry(authStorage) };
}

async function ensureSession(): Promise<AgentSession> {
  if (piSession) return piSession;
  if (!initConfig) throw new Error('Cannot create session: init not received');

  const cwd = resolvedCwd();

  const { authStorage, modelRegistry } = createAuthenticatedRegistry();
  // Store at module scope for set_model handler
  piModelRegistry = modelRegistry;

  // Build tools: coding tools + web tools wrapped with permission hooks + proxy tools.
  // Search provider is selected based on the user's LLM connection:
  //   - OpenAI/OpenRouter → Responses API built-in web_search
  //   - ChatGPT Plus (openai-codex) → ChatGPT backend responses endpoint
  //   - Google → Gemini API with googleSearch grounding
  //   - Others → DuckDuckGo fallback
  //
  // IMPORTANT: resolve dynamically on each search call so token_update refreshes
  // are used without recreating the session.
  const searchProvider = {
    get name() {
      return resolveSearchProvider(initConfig?.piAuth).name;
    },
    async search(query: string, count: number) {
      return resolveSearchProvider(initConfig?.piAuth).search(query, count);
    },
  };
  const searchTool = createSearchTool(searchProvider);
  const webFetchTool = createWebFetchTool(() =>
    initConfig ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId) : null
  );
  const webTools = [searchTool, webFetchTool];
  const wrappedCodingTools = wrapToolsWithHooks([...codingTools, ...webTools]);
  const proxyTools = buildProxyTools();
  const allTools = [...wrappedCodingTools, ...proxyTools];
  debugLog(`Session tools: ${wrappedCodingTools.length} coding + ${proxyTools.length} proxy = ${allTools.length} total`);

  // Build session options
  const sessionOptions: CreateAgentSessionOptions = {
    cwd,
    authStorage,
    modelRegistry,
    tools: allTools,
  };

  // Extension isolation: set agentDir to a temp directory under session path
  // to prevent loading global Pi extensions from ~/.pi/agent
  if (initConfig.sessionPath) {
    const agentDir = initConfig.agentDir || join(initConfig.sessionPath, '.pi-agent');
    mkdirSync(agentDir, { recursive: true });
    sessionOptions.agentDir = agentDir;

    // Session resume: use a per-Craft-session directory so the Pi SDK can
    // persist and resume its own session across subprocess restarts.
    // continueRecent() loads the existing session if one exists, otherwise
    // creates a new one — so this handles both first-run and resume.
    const sessionDir = join(initConfig.sessionPath, '.pi-sessions');
    mkdirSync(sessionDir, { recursive: true });

    if (initConfig.branchFromSessionPath) {
      // Branching: fork from the parent session's Pi session file.
      // Branches must not silently degrade to fresh sessions.
      const parentPiSessionDir = join(initConfig.branchFromSessionPath, '.pi-sessions');
      const parentPiSessionFile = findMostRecentSessionFile(parentPiSessionDir);
      if (!parentPiSessionFile) {
        throw new Error(`Pi branch preflight failed: no parent Pi session file found in ${parentPiSessionDir}`);
      }

      debugLog(`Forking Pi session from parent: ${parentPiSessionFile}`);
      sessionOptions.sessionManager = PiSessionManager.forkFrom(parentPiSessionFile, cwd, sessionDir);
    } else {
      sessionOptions.sessionManager = PiSessionManager.continueRecent(cwd, sessionDir);
    }

  }

  // Set model if specified
  if (initConfig.model) {
    try {
      const piModel = resolvePiModel(modelRegistry, initConfig.model, initConfig.piAuth?.provider);
      if (piModel) {
        sessionOptions.model = piModel;
        setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
      } else {
        setInterceptorApiHints(undefined);
      }
    } catch {
      debugLog(`Could not resolve Pi model: ${initConfig.model}`);
      setInterceptorApiHints(undefined);
    }
  } else {
    setInterceptorApiHints(undefined);
  }

  // Set thinking level
  const piThinkingLevel = THINKING_TO_PI[initConfig.thinkingLevel as keyof typeof THINKING_TO_PI];
  if (piThinkingLevel) {
    sessionOptions.thinkingLevel = piThinkingLevel;
  }

  // Create the session
  const { session } = await createAgentSession(sessionOptions);
  piSession = session;

  // HACK: Pi SDK's createAgentSession ignores our wrapped tool objects — it
  // extracts only tool names and creates its own internal instances via
  // createAllTools(). Our wrapSingleTool permission/summarization hooks are
  // silently discarded. Inject our wrapped tools via the internal
  // _baseToolsOverride property and rebuild the runtime.
  //
  // Pinned to @mariozechner/pi-coding-agent@0.53.x — will break on SDK updates.
  // TODO: Upstream a public API for custom tool injection.
  const sessionInternal = piSession as any;
  if (typeof sessionInternal._buildRuntime !== 'function') {
    throw new Error(
      'Pi SDK internal API changed: _buildRuntime not found. ' +
      'Update ensureSession() for the new SDK version.',
    );
  }

  const baseToolsOverride: Record<string, AgentTool<any>> = {};
  for (const tool of allTools) {
    baseToolsOverride[tool.name] = tool;
  }
  sessionInternal._baseToolsOverride = baseToolsOverride;
  sessionInternal._buildRuntime({
    activeToolNames: Object.keys(baseToolsOverride),
    includeAllExtensionTools: true,
  });

  toolsChanged = false;
  debugLog(`Created Pi session: ${session.sessionId} (${Object.keys(baseToolsOverride).length} tools)`);

  // Notify main process of session ID
  send({ type: 'session_id_update', sessionId: session.sessionId });

  return session;
}


// ============================================================
// Tool Wrapping (Permission Enforcement + Large Response Summarization)
// ============================================================

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
/**
 * Send pre_tool_use_request to main process and wait for response.
 * Returns the (potentially modified) input if approved, throws if blocked.
 * All permission checking, transforms, and source activation happen in the main process.
 */
async function requestPreToolUseApproval(
  sdkToolName: string,
  input: Record<string, unknown>,
  toolCallId?: string,
): Promise<Record<string, unknown>> {
  const requestId = `pi-ptu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  send({
    type: 'pre_tool_use_request',
    requestId,
    toolName: sdkToolName,
    ...(toolCallId ? { toolCallId } : {}),
    input,
  });

  const response = await new Promise<{ action: string; input?: Record<string, unknown>; reason?: string }>((resolve) => {
    pendingPreToolUse.set(requestId, { resolve });
  });

  if (response.action === 'block') {
    throw new Error(response.reason || `Tool "${sdkToolName}" is not allowed`);
  }

  return response.action === 'modify' && response.input ? response.input : input;
}

function wrapToolsWithHooks(tools: AgentTool<any>[]): AgentTool<any>[] {
  return tools.map(tool => wrapSingleTool(tool));
}

function makeErrorResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: 'text', text: message }],
    details: { isError: true },
  };
}

function wrapSingleTool(tool: AgentTool<any>): AgentTool<any> {
  const originalExecute = tool.execute;

  const wrappedExecute = async (
    toolCallId: string,
    params: any,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<any>) => void,
  ): Promise<AgentToolResult<any>> => {
    const sdkToolName = PI_TOOL_NAME_MAP[tool.name] || tool.name;
    let inputObj: Record<string, unknown> = { ...(params as Record<string, unknown>) };

    // Extract intent before main process strips metadata (used for summarization)
    const intent = typeof inputObj._intent === 'string' ? inputObj._intent : undefined;

    // Normalize Pi SDK parameter names: path → file_path
    if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
        && typeof inputObj.path === 'string' && !inputObj.file_path) {
      inputObj = { ...inputObj, file_path: inputObj.path };
    }

    // Send to main process for permission checking + transforms
    inputObj = await requestPreToolUseApproval(sdkToolName, inputObj, toolCallId);

    // Execute original tool with (potentially modified) input
    const result = await originalExecute(toolCallId, inputObj, signal, onUpdate);

    // --- Post-execute: large response summarization ---

    const resultText = result.content
      .filter((c): c is PiTextContent => c.type === 'text')
      .map(c => c.text)
      .join('');

    if (estimateTokens(resultText) > TOKEN_LIMIT && initConfig) {
      try {
        const sessionPath = getSessionPath(
          initConfig.workspaceRootPath,
          initConfig.sessionId,
        );

        const largeResult = await handleLargeResponse({
          text: resultText,
          sessionPath,
          context: {
            toolName: sdkToolName,
            input: inputObj,
            intent,
            userRequest: currentUserMessage,
          },
          summarize: runMiniCompletion,
        });

        if (largeResult) {
          return {
            content: [{ type: 'text', text: largeResult.message }],
            details: result.details,
          };
        }
      } catch (error) {
        debugLog(
          `Large response handling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  };

  return {
    ...tool,
    execute: wrappedExecute,
  };
}

// ============================================================
// Proxy Tools (tools executed in main process)
// ============================================================

function buildProxyTools(): AgentTool<any>[] {
  debugLog(`Building proxy tools from ${proxyToolDefs.length} definitions: ${proxyToolDefs.map(t => t.name).join(', ')}`);

  return proxyToolDefs.map(def => ({
    name: def.name,
    label: def.name
      .replace(/^mcp__.*?__/, '')
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: def.description,
    parameters: def.inputSchema,
    execute: async (
      toolCallId: string,
      params: any,
    ): Promise<AgentToolResult<any>> => {
      const inputObj = params as Record<string, unknown>;

      // Permission checking via main process
      const approvedInput = await requestPreToolUseApproval(def.name, inputObj, toolCallId);

      // Execute via main process
      const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      send({
        type: 'tool_execute_request',
        requestId,
        toolName: def.name,
        args: approvedInput,
      });

      const result = await new Promise<{ content: string; isError: boolean }>((resolve) => {
        pendingToolExecutions.set(requestId, { resolve });
      });

      return {
        content: [{ type: 'text', text: result.content }],
        details: result.isError ? { isError: true } : undefined,
      };
    },
  }));
}

// ============================================================
// LLM Query (ephemeral session for call_llm + mini completions)
// ============================================================

async function queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
  if (!initConfig) throw new Error('Cannot run queryLlm: init not received');

  debugLog('[queryLlm] Starting');

  // Pick mini model. If the configured miniModel uses a different provider than
  // what the user authenticated with (e.g. gemini-2.5-pro when only anthropic
  // credentials exist), fall back to the default summarization model which uses
  // the same provider family.
  let model = request.model ?? initConfig.miniModel ?? getDefaultSummarizationModel();

  // Create authenticated registry upfront — used by both the provider guard and the ephemeral session.
  const { authStorage, modelRegistry } = createAuthenticatedRegistry();

  const isModelNotFoundError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('model_not_found') ||
      normalized.includes('does not exist') ||
      normalized.includes('no such model') ||
      normalized.includes('requested model') && normalized.includes('not') && normalized.includes('exist')
    );
  };

  const isDeniedMiniModelId = (modelId: string): boolean => {
    const bare = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;
    return bare === 'codex-mini-latest';
  };

  // If piAuth is set, ensure the mini model uses the same provider.
  // Pi SDK will fail with "No API key found" if the model requires a different provider.
  if (initConfig.piAuth) {
    const authProvider = initConfig.piAuth.provider;
    const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
    const resolved = resolvePiModel(modelRegistry, bareModel, authProvider);
    if (!resolved || (resolved as any).provider !== authProvider || isDeniedMiniModelId(model)) {
      const fallback = getDefaultSummarizationModel();
      debugLog(`[queryLlm] Model ${bareModel} incompatible with ${authProvider}, falling back to ${fallback}`);
      model = fallback;
    }
  }

  const runQueryWithModel = async (modelId: string): Promise<string> => {
    debugLog(`[queryLlm] Using model: ${modelId}`);

    // Create minimal ephemeral session
    const ephemeralOptions: CreateAgentSessionOptions = {
      cwd: resolvedCwd(),
      authStorage,
      modelRegistry,
      tools: [],
      sessionManager: PiSessionManager.inMemory(),
    };

    // Resolve model
    let piModel: ReturnType<typeof resolvePiModel>;
    try {
      piModel = resolvePiModel(modelRegistry, modelId, initConfig.piAuth?.provider);
      if (piModel) {
        ephemeralOptions.model = piModel;
      }
    } catch {
      debugLog(`[queryLlm] Could not resolve model: ${modelId}`);
    }

    const { session: ephemeralSession } = await createAgentSession(ephemeralOptions);

    // Pi SDK ignores options.model for ephemeral sessions (same issue as options.tools).
    // Explicitly set the model after creation to ensure the mini model is used.
    if (piModel) {
      try {
        await ephemeralSession.setModel(piModel);
      } catch {
        debugLog(`[queryLlm] Failed to set model on ephemeral session, proceeding with default`);
      }
    }

    debugLog(`[queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

    // Set system prompt
    if (request.systemPrompt) {
      ephemeralSession.agent.setSystemPrompt(request.systemPrompt);
    } else {
      ephemeralSession.agent.setSystemPrompt('Reply with ONLY the requested text. No explanation.');
    }

    // Collect response text and errors from events
    let result = '';
    let lastError = '';
    let completionResolve: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      completionResolve = resolve;
    });

    const unsub = ephemeralSession.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'message_end') {
        // Only capture assistant messages — Pi SDK emits message_end for user messages too
        const msg = event.message as {
          role?: string;
          content?: string | Array<{ type: string; text?: string }>;
          stopReason?: string;
          errorMessage?: string;
        };
        if (msg.role !== 'assistant') return;

        // Capture API errors from message_end (e.g. auth failures, model errors)
        if (msg.stopReason === 'error' && msg.errorMessage) {
          lastError = msg.errorMessage;
          debugLog(`[queryLlm] API error in message_end: ${msg.errorMessage}`);
        }

        if (typeof msg.content === 'string') {
          result = msg.content;
        } else if (Array.isArray(msg.content)) {
          result = msg.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text!)
            .join('');
        }
      }
      if (event.type === 'agent_end') {
        completionResolve();
      }
    });

    try {
      await ephemeralSession.prompt(request.prompt);
      await withTimeout(
        completionPromise,
        LLM_QUERY_TIMEOUT_MS,
        `queryLlm timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`
      );
      debugLog(`[queryLlm] Result length: ${result.trim().length}`);

      // If we got no text but captured an error, throw so callers see the real issue
      if (!result.trim() && lastError) {
        throw new Error(lastError);
      }

      return result.trim();
    } finally {
      unsub();
      ephemeralSession.dispose();
    }
  };

  const fallbackCandidates = [
    'pi/gpt-5.1-codex-mini',
    'pi/gpt-5-mini',
    initConfig.miniModel,
    getDefaultSummarizationModel(),
  ].filter((candidate): candidate is string => !!candidate && !isDeniedMiniModelId(candidate));

  const triedModels = new Set<string>();
  let currentModel = model;

  while (true) {
    triedModels.add(currentModel);
    try {
      const text = await runQueryWithModel(currentModel);
      return { text, model: currentModel };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const shouldRetry = isModelNotFoundError(errorMsg);

      if (!shouldRetry) {
        throw error;
      }

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(candidate)) return false;
        try {
          const resolved = resolvePiModel(modelRegistry, candidate, initConfig.piAuth?.provider);
          if (!resolved) return false;
          if (initConfig.piAuth && (resolved as any).provider !== initConfig.piAuth.provider) {
            return false;
          }
          return true;
        } catch {
          return false;
        }
      });

      if (!retryModel) {
        throw error;
      }

      debugLog(`[queryLlm] Model ${currentModel} not found, retrying with ${retryModel}`);
      currentModel = retryModel;
    }
  }
}

async function preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
  const sessionPath = initConfig
    ? getSessionPath(initConfig.workspaceRootPath, initConfig.sessionId)
    : undefined;
  const request = await buildCallLlmRequest(input, { backendName: 'Pi', sessionPath });
  return queryLlm(request);
}

async function runMiniCompletion(prompt: string): Promise<string | null> {
  try {
    const result = await queryLlm({ prompt });
    const text = result.text || null;
    debugLog(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  } catch (error) {
    debugLog(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================================
// Event Handling
// ============================================================

function extractToolExecutionMetadata(args: Record<string, unknown> | undefined): ToolExecutionMetadata | undefined {
  if (!args) return undefined;

  const intent = typeof args._intent === 'string' ? args._intent : undefined;
  const displayName = typeof args._displayName === 'string' ? args._displayName : undefined;

  if (!intent && !displayName) return undefined;

  return {
    intent,
    displayName,
    source: 'interceptor',
  };
}

function handleSessionEvent(event: AgentSessionEvent): void {
  let forwardedEvent: OutboundAgentEvent = event;

  // Log API errors for debugging
  if (event.type === 'message_end') {
    const msg = event.message as { stopReason?: string; errorMessage?: string } | undefined;
    if (msg?.stopReason === 'error') {
      debugLog(`API error in message_end: ${msg.errorMessage || 'unknown'}`);
    }
  }

  // Detect session MCP tool completions + enrich tool starts with canonical metadata
  if (event.type === 'tool_execution_start') {
    const toolName = event.toolName;
    if (toolName.startsWith('session__') || toolName.startsWith('mcp__session__')) {
      const mcpToolName = toolName.replace(/^(mcp__session__|session__)/, '');
      pendingSessionToolCalls.set(event.toolCallId, {
        toolName: mcpToolName,
        arguments: (event.args ?? {}) as Record<string, unknown>,
      });
    }

    const toolMetadata = extractToolExecutionMetadata((event.args ?? {}) as Record<string, unknown>);
    if (toolMetadata) {
      forwardedEvent = {
        ...event,
        toolMetadata,
      };
    }
  }

  if (event.type === 'tool_execution_end') {
    const pending = pendingSessionToolCalls.get(event.toolCallId);
    if (pending) {
      pendingSessionToolCalls.delete(event.toolCallId);
      send({
        type: 'session_tool_completed',
        toolName: pending.toolName,
        args: pending.arguments,
        isError: !!event.isError,
      });
    }
  }

  // Forward all events to main process
  send({ type: 'event', event: forwardedEvent });
}

// ============================================================
// Command Handlers
// ============================================================

async function handleInit(msg: Extract<InboundMessage, { type: 'init' }>): Promise<void> {
  // Clean up any existing session from a previous init
  if (piSession) {
    if (unsubscribeEvents) {
      unsubscribeEvents();
      unsubscribeEvents = null;
    }
    piSession.dispose();
    piSession = null;
    moduleAuthStorage = null; // Reset so createAuthenticatedRegistry() creates fresh storage
    debugLog('Cleaned up existing session for re-init');
  }

  initConfig = msg;

  // Azure OpenAI requires a tenant-specific endpoint URL.
  // The Pi SDK (via Vercel AI SDK) reads AZURE_OPENAI_BASE_URL from env.
  if (msg.piAuth?.provider === 'azure-openai-responses' && msg.baseUrl) {
    process.env.AZURE_OPENAI_BASE_URL = msg.baseUrl;
    debugLog(`Set AZURE_OPENAI_BASE_URL=${msg.baseUrl}`);
  }

  // Start callback server for call_llm (idempotent — skips if already running)
  await startCallbackServer();

  send({
    type: 'ready',
    sessionId: null,
    callbackPort,
  });
}

function isContextOverflowErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('context_length_exceeded') ||
    normalized.includes('exceeds the context window') ||
    normalized.includes('context window') && normalized.includes('exceed') ||
    normalized.includes('too many tokens') ||
    normalized.includes('token limit exceeded')
  );
}

async function handlePrompt(msg: Extract<InboundMessage, { type: 'prompt' }>): Promise<void> {
  currentUserMessage = msg.message;

  try {
    // If proxy tools changed since last session creation, dispose and recreate.
    // This avoids calling _buildRuntime() for dynamic tool updates — instead
    // we create a fresh session via continueRecent() with all tools known upfront.
    if (toolsChanged && piSession) {
      debugLog('Recreating session due to tool changes');
      if (unsubscribeEvents) {
        unsubscribeEvents();
        unsubscribeEvents = null;
      }
      piSession.dispose();
      piSession = null;
    }

    const session = await ensureSession();

    // Set system prompt
    if (msg.systemPrompt) {
      session.agent.setSystemPrompt(msg.systemPrompt);
    }

    // Wire up event handler
    if (unsubscribeEvents) {
      unsubscribeEvents();
    }
    unsubscribeEvents = session.subscribe(handleSessionEvent);

    // Fire prompt — use followUp when session is already streaming so the
    // message is queued instead of throwing "Agent is already processing".
    await session.prompt(msg.message, {
      images: msg.images && msg.images.length > 0 ? msg.images : undefined,
      streamingBehavior: 'followUp',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Fallback hardening: if the provider surfaced a context-overflow error,
    // force a manual compact and retry this prompt once.
    if (isContextOverflowErrorMessage(errorMsg)) {
      debugLog(`Prompt overflow detected, attempting compact+retry: ${errorMsg}`);
      try {
        const session = await ensureSession();
        await session.compact();
        await session.prompt(msg.message, {
          images: msg.images && msg.images.length > 0 ? msg.images : undefined,
          streamingBehavior: 'followUp',
        });
        debugLog('Compact+retry succeeded after overflow');
        return;
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        debugLog(`Compact+retry failed: ${retryMsg}`);
        send({
          type: 'error',
          message: `Prompt overflow recovery failed: ${retryMsg}`,
          code: 'prompt_overflow_recovery_failed',
        });
        send({ type: 'event', event: { type: 'agent_end' } });
        return;
      }
    }

    debugLog(`Prompt failed: ${errorMsg}`);
    send({ type: 'error', message: errorMsg, code: 'prompt_error' });
    // Send synthetic agent_end so the main process event queue unblocks
    send({ type: 'event', event: { type: 'agent_end' } });
  }
}

function handleRegisterTools(msg: Extract<InboundMessage, { type: 'register_tools' }>): void {
  // Merge: replace existing tools by name, add new ones
  const incoming = new Map(msg.tools.map(t => [t.name, t]));
  proxyToolDefs = [
    ...proxyToolDefs.filter(t => !incoming.has(t.name)),
    ...msg.tools,
  ];
  debugLog(`Registered ${msg.tools.length} proxy tools (total: ${proxyToolDefs.length}): ${msg.tools.map(t => t.name).join(', ')}`);

  // If session exists, mark for recreation on next prompt.
  // Don't dispose mid-generation — the flag is checked in handlePrompt().
  if (piSession) {
    toolsChanged = true;
    debugLog('Proxy tools changed — session will be recreated on next prompt');
  }
}

function handleToolExecuteResponse(msg: Extract<InboundMessage, { type: 'tool_execute_response' }>): void {
  const pending = pendingToolExecutions.get(msg.requestId);
  if (pending) {
    pendingToolExecutions.delete(msg.requestId);
    pending.resolve(msg.result);
  } else {
    debugLog(`No pending tool execution for requestId: ${msg.requestId}`);
  }
}

function handlePreToolUseResponse(msg: Extract<InboundMessage, { type: 'pre_tool_use_response' }>): void {
  const pending = pendingPreToolUse.get(msg.requestId);
  if (pending) {
    pendingPreToolUse.delete(msg.requestId);
    pending.resolve({ action: msg.action, input: msg.input, reason: msg.reason });
  } else {
    debugLog(`No pending pre_tool_use for requestId: ${msg.requestId}`);
  }
}

async function handleAbort(): Promise<void> {
  if (piSession) {
    try {
      await piSession.abort();
    } catch (error) {
      debugLog(`Abort failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Reject all pending pre-tool-use requests
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Aborted' });
  }
  pendingPreToolUse.clear();
}

async function handleMiniCompletion(msg: Extract<InboundMessage, { type: 'mini_completion' }>): Promise<void> {
  // Call queryLlm directly (not runMiniCompletion) so auth errors propagate
  // as 'error' messages instead of being swallowed and returned as null.
  // runMiniCompletion is kept for the summarize callback where null is acceptable.
  try {
    const result = await queryLlm({ prompt: msg.prompt });
    send({ type: 'mini_completion_result', id: msg.id, text: result.text || null });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[handleMiniCompletion] Error: ${errorMsg}`);
    send({ type: 'error', message: errorMsg });
  }
}

async function handleEnsureSessionReady(msg: Extract<InboundMessage, { type: 'ensure_session_ready' }>): Promise<void> {
  const session = await ensureSession();
  send({
    type: 'ensure_session_ready_result',
    id: msg.id,
    sessionId: session.sessionId || null,
  });
}

async function handleCompact(msg: Extract<InboundMessage, { type: 'compact' }>): Promise<void> {
  try {
    const session = await ensureSession();
    const result = await session.compact(msg.customInstructions);
    send({
      type: 'compact_result',
      id: msg.id,
      success: true,
      result: {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[compact] Failed: ${errorMsg}`);
    send({
      type: 'compact_result',
      id: msg.id,
      success: false,
      errorMessage: errorMsg,
    });
  }
}

async function handleSetAutoCompaction(msg: Extract<InboundMessage, { type: 'set_auto_compaction' }>): Promise<void> {
  try {
    const session = await ensureSession();
    session.setAutoCompactionEnabled(msg.enabled);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: true,
      enabled: session.autoCompactionEnabled,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_auto_compaction] Failed: ${errorMsg}`);
    send({
      type: 'set_auto_compaction_result',
      id: msg.id,
      success: false,
      enabled: msg.enabled,
      errorMessage: errorMsg,
    });
  }
}

async function handleSetModel(msg: Extract<InboundMessage, { type: 'set_model' }>): Promise<void> {
  debugLog(`[set_model] Received: ${msg.model}`);
  if (!piSession || !piModelRegistry) {
    debugLog(`[set_model] No active session or model registry, ignoring`);
    return;
  }
  const piModel = resolvePiModel(piModelRegistry, msg.model, initConfig?.piAuth?.provider);
  if (!piModel) {
    debugLog(`[set_model] Could not resolve model: ${msg.model}`);
    setInterceptorApiHints(undefined);
    return;
  }
  try {
    await piSession.setModel(piModel);
    setInterceptorApiHints(piModel as { api?: string; provider?: string; baseUrl?: string });
    debugLog(`[set_model] Model changed to: ${msg.model} (resolved: ${piModel.provider}/${piModel.id})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debugLog(`[set_model] Failed to set model: ${errorMsg}`);
  }
}

function handleShutdown(): void {
  debugLog('Shutdown requested');

  // Unsubscribe events
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }

  // Dispose session
  if (piSession) {
    piSession.dispose();
    piSession = null;
  }

  // Stop callback server
  stopCallbackServer();

  // Reject pending promises
  for (const [, pending] of pendingPreToolUse) {
    pending.resolve({ action: 'block', reason: 'Server shutting down' });
  }
  pendingPreToolUse.clear();

  for (const [, pending] of pendingToolExecutions) {
    pending.resolve({ content: 'Server shutting down', isError: true });
  }
  pendingToolExecutions.clear();

  process.exit(0);
}

// ============================================================
// Main JSONL Reader Loop
// ============================================================

async function processMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;

    case 'prompt':
      await handlePrompt(msg);
      break;

    case 'register_tools':
      handleRegisterTools(msg);
      break;

    case 'tool_execute_response':
      handleToolExecuteResponse(msg);
      break;

    case 'pre_tool_use_response':
      handlePreToolUseResponse(msg);
      break;

    case 'abort':
      await handleAbort();
      break;

    case 'mini_completion':
      await handleMiniCompletion(msg);
      break;

    case 'ensure_session_ready':
      await handleEnsureSessionReady(msg);
      break;

    case 'set_model':
      await handleSetModel(msg);
      break;

    case 'compact':
      await handleCompact(msg);
      break;

    case 'set_auto_compaction':
      await handleSetAutoCompaction(msg);
      break;

    case 'steer':
      if (piSession) {
        debugLog(`Steering with: "${msg.message.slice(0, 100)}"`);
        await piSession.steer(msg.message);
      } else {
        debugLog('Steer ignored — no active session');
      }
      break;

    case 'token_update':
      if (moduleAuthStorage) {
        const { provider, credential } = msg.piAuth;
        moduleAuthStorage.set(provider, credential);
        if (initConfig) {
          initConfig.piAuth = msg.piAuth;
        }
        debugLog(`Updated ${credential.type} credential for provider: ${provider}`);
      } else {
        debugLog('token_update received but no authStorage initialized');
      }
      break;

    case 'shutdown':
      handleShutdown();
      break;

    default:
      debugLog(`Unknown message type: ${(msg as any).type}`);
  }
}

function main(): void {
  debugLog('Pi agent server starting');

  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as InboundMessage;
      processMessage(msg).catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debugLog(`Error processing message: ${errorMsg}`);
        send({ type: 'error', message: errorMsg });
      });
    } catch (parseError) {
      debugLog(`Failed to parse JSONL: ${parseError}`);
    }
  });

  rl.on('close', () => {
    debugLog('stdin closed, shutting down');
    handleShutdown();
  });

  // Handle unexpected errors
  process.on('uncaughtException', (error) => {
    debugLog(`Uncaught exception: ${error.message}`);
    send({ type: 'error', message: `Uncaught exception: ${error.message}`, code: 'uncaught' });
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    debugLog(`Unhandled rejection: ${msg}`);
    send({ type: 'error', message: `Unhandled rejection: ${msg}`, code: 'unhandled_rejection' });
  });
}

main();
