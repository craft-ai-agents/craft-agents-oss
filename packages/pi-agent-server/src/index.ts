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
import { mkdirSync } from 'node:fs';
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
import { shouldAllowToolInMode } from '../../shared/src/agent/mode-manager.ts';
import type { PermissionMode } from '../../shared/src/agent/mode-manager.ts';
import {
  expandToolPaths,
  qualifySkillName,
  stripToolMetadata,
  validateConfigWrite,
} from '../../shared/src/agent/core/pre-tool-use.ts';
import { handleLargeResponse, estimateTokens, TOKEN_LIMIT } from '../../shared/src/utils/large-response.ts';
import { getSessionPlansPath, getSessionPath } from '../../shared/src/sessions/storage.ts';
import { buildCallLlmRequest, withTimeout } from '../../shared/src/agent/llm-tool.ts';
import type { LLMQueryRequest, LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { PI_TOOL_NAME_MAP, THINKING_TO_PI } from '../../shared/src/agent/backend/pi/constants.ts';
import { getDefaultSummarizationModel } from '../../shared/src/config/models.ts';
import { webSearchTool } from './tools/web-search.ts';
import { webFetchTool } from './tools/web-fetch.ts';
import { createGoogleSearchTool } from './tools/google-search.ts';

// ============================================================
// Types — JSONL Protocol
// ============================================================

/** Messages from main process (stdin) */
type InboundMessage =
  | { type: 'init'; apiKey: string; model: string; cwd: string; thinkingLevel: string; workspaceRootPath: string; sessionId: string; sessionPath: string; workingDirectory: string; permissionMode: PermissionMode; plansFolderPath: string; activeSourceSlugs: string[]; miniModel?: string; agentDir?: string; providerType?: string; authType?: string; workspaceId?: string; piAuth?: { provider: string; credential: { type: 'api_key'; key: string } | { type: 'oauth'; access: string; refresh: string; expires: number } } }
  | { type: 'prompt'; id: string; message: string; systemPrompt: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }
  | { type: 'register_tools'; tools: ProxyToolDef[] }
  | { type: 'tool_execute_response'; requestId: string; result: { content: string; isError: boolean } }
  | { type: 'permission_response'; requestId: string; allowed: boolean }
  | { type: 'abort' }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'set_active_sources'; slugs: string[] }
  | { type: 'mini_completion'; id: string; prompt: string }
  | { type: 'set_model'; model: string }
  | { type: 'token_update'; piAuth: { provider: string; credential: { type: 'api_key'; key: string } | { type: 'oauth'; access: string; refresh: string; expires: number } } }
  | { type: 'shutdown' };

/** Proxy tool definition from main process */
interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Messages to main process (stdout) */
interface OutboundReady { type: 'ready'; sessionId: string | null; callbackPort: number }
interface OutboundEvent { type: 'event'; event: AgentSessionEvent }
interface OutboundPermReq { type: 'permission_request'; requestId: string; toolName: string; command?: string; description?: string; permissionType: string }
interface OutboundToolExecReq { type: 'tool_execute_request'; requestId: string; toolName: string; args: Record<string, unknown> }
interface OutboundSessionToolCompleted { type: 'session_tool_completed'; toolName: string; args: Record<string, unknown>; isError: boolean }
interface OutboundMiniResult { type: 'mini_completion_result'; id: string; text: string | null }
interface OutboundSessionIdUpdate { type: 'session_id_update'; sessionId: string }
interface OutboundError { type: 'error'; message: string; code?: string }

type OutboundMessage =
  | OutboundReady
  | OutboundEvent
  | OutboundPermReq
  | OutboundToolExecReq
  | OutboundSessionToolCompleted
  | OutboundMiniResult
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
let permissionMode: PermissionMode = 'ask';
let activeSourceSlugs: string[] = [];
let currentUserMessage = '';

// Pending promises for async handshakes
const pendingPermissions = new Map<string, { resolve: (allowed: boolean) => void; toolName: string }>();
const pendingToolExecutions = new Map<string, { resolve: (result: { content: string; isError: boolean }) => void }>();

// Pending session MCP tool calls for completion detection
const pendingSessionToolCalls = new Map<string, { toolName: string; arguments: Record<string, unknown> }>();

// Proxy tool definitions from main process
let proxyToolDefs: ProxyToolDef[] = [];

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
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-5")
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
  // When the provider is Google, replace DuckDuckGo web_search with a Google Search
  // grounding tool that makes a separate Gemini API call with { googleSearch: {} }.
  // (The main session can't combine googleSearch with function calling in one request.)
  const isGoogleProvider = initConfig.piAuth?.provider === 'google';
  const googleApiKey = initConfig.piAuth?.credential?.type === 'api_key'
    ? initConfig.piAuth.credential.key : undefined;
  const searchTool = isGoogleProvider && googleApiKey
    ? createGoogleSearchTool(googleApiKey)
    : webSearchTool;
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
    sessionOptions.sessionManager = PiSessionManager.continueRecent(cwd, sessionDir);

  }

  // Set model if specified
  if (initConfig.model) {
    try {
      const piModel = resolvePiModel(modelRegistry, initConfig.model, initConfig.piAuth?.provider);
      if (piModel) {
        sessionOptions.model = piModel;
      }
    } catch {
      debugLog(`Could not resolve Pi model: ${initConfig.model}`);
    }
  }

  // Set thinking level
  const piThinkingLevel = THINKING_TO_PI[initConfig.thinkingLevel as keyof typeof THINKING_TO_PI];
  if (piThinkingLevel) {
    sessionOptions.thinkingLevel = piThinkingLevel;
  }

  // Create the session
  const { session } = await createAgentSession(sessionOptions);

  // CRITICAL: Pi SDK's createAgentSession ignores our wrapped tool objects.
  // It extracts only tool names from options.tools and creates its own internal
  // tool instances via createAllTools(). Our wrapSingleTool permission enforcement
  // is silently discarded. To fix this, we set piSession first and then call
  // rebuildSessionTools() which injects our wrapped tools via the session's
  // baseToolsOverride mechanism and rebuilds the runtime.
  piSession = session;
  rebuildSessionTools();
  debugLog(`Created Pi session: ${session.sessionId}`);

  // Notify main process of session ID
  send({ type: 'session_id_update', sessionId: session.sessionId });

  return session;
}

/**
 * Rebuild the session's tool registry in-place when proxy tools change.
 *
 * HACK: Pi SDK's createAgentSession() ignores custom tool wrappers — it
 * extracts only tool names and creates its own internal tool instances.
 * We inject our wrapped tools via the internal _baseToolsOverride property
 * and trigger a runtime rebuild via _buildRuntime().
 *
 * This WILL break on SDK updates — pinned to @mariozechner/pi-coding-agent@0.53.x.
 * TODO: Upstream a public API for custom tool injection.
 */
function rebuildSessionTools(): void {
  if (!piSession) return;

  // Guard: fail fast if internal API changed
  const internal = piSession as Record<string, unknown>;
  if (typeof internal._buildRuntime !== 'function') {
    throw new Error(
      'Pi SDK internal API changed: _buildRuntime not found. ' +
      'Update rebuildSessionTools() for the new SDK version.',
    );
  }

  const isGoogleProvider = initConfig?.piAuth?.provider === 'google';
  const googleApiKey = initConfig?.piAuth?.credential?.type === 'api_key'
    ? initConfig.piAuth.credential.key : undefined;
  const searchTool = isGoogleProvider && googleApiKey
    ? createGoogleSearchTool(googleApiKey)
    : webSearchTool;
  const webTools = [searchTool, webFetchTool];
  const wrappedCodingTools = wrapToolsWithHooks([...codingTools, ...webTools]);
  const proxyTools = buildProxyTools();

  const baseToolsOverride: Record<string, AgentTool<any>> = {};
  for (const tool of wrappedCodingTools) {
    baseToolsOverride[tool.name] = tool;
  }
  for (const tool of proxyTools) {
    baseToolsOverride[tool.name] = tool;
  }

  const sessionInternal = piSession as any;
  sessionInternal._baseToolsOverride = baseToolsOverride;
  sessionInternal._buildRuntime({
    activeToolNames: Object.keys(baseToolsOverride),
    includeAllExtensionTools: true,
  });
  debugLog(`Rebuilt session tools in-place: ${Object.keys(baseToolsOverride).length} tools`);
}

// ============================================================
// Tool Wrapping (Permission Enforcement + Large Response Summarization)
// ============================================================

/**
 * Shared permission enforcement for both coding tools and proxy tools.
 * Checks mode-manager rules and, in Ask mode, prompts the user via the
 * pending-permissions handshake. Throws on deny or block.
 */
async function enforcePermission(
  toolName: string,
  params: Record<string, unknown>,
  opts?: { permissionType?: string },
): Promise<void> {
  const plansFolderPath = initConfig
    ? getSessionPlansPath(initConfig.workspaceRootPath, initConfig.sessionId)
    : undefined;

  const check = shouldAllowToolInMode(toolName, params, permissionMode, {
    plansFolderPath,
    permissionsContext: {
      workspaceRootPath: initConfig?.workspaceRootPath || resolvedCwd(),
      activeSourceSlugs,
    },
  });

  if (!check.allowed) {
    debugLog(`Tool blocked by ${permissionMode} mode: ${toolName} — ${check.reason}`);
    throw new Error(
      `Tool "${toolName}" is not allowed in ${permissionMode} mode: ${check.reason}`,
    );
  }

  if (check.requiresPermission) {
    const requestId = `pi-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const command = typeof params.command === 'string'
      ? params.command
      : typeof params.file_path === 'string'
        ? params.file_path
        : typeof params.path === 'string'
          ? params.path
          : undefined;

    debugLog(`Prompting user for ${toolName} — ${check.description}`);

    send({
      type: 'permission_request',
      requestId,
      toolName,
      command,
      description: check.description,
      permissionType: opts?.permissionType ?? getPermissionType(toolName),
    });

    const allowed = await new Promise<boolean>((resolve) => {
      pendingPermissions.set(requestId, { resolve, toolName });
    });

    if (!allowed) {
      debugLog(`Tool denied by user: ${toolName}`);
      throw new Error(`Tool "${toolName}" was denied by the user.`);
    }
  }
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

function getPermissionType(toolName: string): string {
  if (toolName === 'Bash') return 'bash';
  if (toolName === 'Write' || toolName === 'Edit') return 'file_write';
  if (toolName.startsWith('mcp__')) return 'mcp_mutation';
  return 'bash';
}

function wrapSingleTool(tool: AgentTool<any>): AgentTool<any> {
  const originalExecute = tool.execute;

  const wrappedExecute = async (
    toolCallId: string,
    params: any,
    signal?: AbortSignal,
    onUpdate?: (partialResult: AgentToolResult<any>) => void,
  ): Promise<AgentToolResult<any>> => {
    // Map Pi tool name to SDK PascalCase name
    const sdkToolName = PI_TOOL_NAME_MAP[tool.name] || tool.name;
    let inputObj: Record<string, unknown> = { ...(params as Record<string, unknown>) };

    // --- Pre-execute: shared transformations ---

    // 1. Expand ~ in file paths
    const pathResult = expandToolPaths(sdkToolName, inputObj, debugLog);
    if (pathResult.modified) inputObj = pathResult.input;

    // 2. Validate config writes
    if (initConfig?.workspaceRootPath) {
      const configResult = validateConfigWrite(
        sdkToolName,
        inputObj,
        initConfig.workspaceRootPath,
        debugLog,
      );
      if (!configResult.valid) {
        return makeErrorResult(configResult.error || 'Config validation failed');
      }
    }

    // 3. Qualify skill names
    if (initConfig?.workspaceId && initConfig?.workspaceRootPath) {
      const skillResult = qualifySkillName(
        inputObj,
        initConfig.workspaceId,
        initConfig.workspaceRootPath,
        initConfig.workingDirectory,
        debugLog,
      );
      if (skillResult.modified) inputObj = skillResult.input;
    }

    // 4. Strip metadata (save _intent before stripping for summarization)
    const intent = typeof inputObj._intent === 'string' ? inputObj._intent : undefined;
    const metaResult = stripToolMetadata(sdkToolName, inputObj, debugLog);
    if (metaResult.modified) inputObj = metaResult.input;

    // --- Pre-execute: permission mode enforcement ---

    // Normalize Pi SDK parameter names for shouldAllowToolInMode compatibility.
    // Pi SDK tools use 'path' but mode-manager checks 'file_path'.
    const permissionInput = (sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'MultiEdit' || sdkToolName === 'NotebookEdit')
      && typeof inputObj.path === 'string' && !inputObj.file_path
      ? { ...inputObj, file_path: inputObj.path }
      : inputObj;

    await enforcePermission(sdkToolName, permissionInput);

    // --- Execute original tool ---

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
    // Pi SDK's AgentTool requires `label` (human-readable name for UI).
    // Derive from tool name: 'mcp__session__SubmitPlan' → 'Submit Plan'
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
      // --- Permission mode enforcement ---
      // Proxy tools (session tools, MCP sources) must respect Explore mode.
      // Use the full prefixed name (e.g., 'mcp__session__SubmitPlan') so
      // shouldAllowToolInMode() matches the mcp__session__ rules.
      await enforcePermission(def.name, params as Record<string, unknown>, {
        permissionType: 'mcp_mutation',
      });

      // --- Execute via main process ---
      const requestId = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const args = params as Record<string, unknown>;

      send({
        type: 'tool_execute_request',
        requestId,
        toolName: def.name,
        args,
      });

      // Wait for main process to send back the result
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

  // If piAuth is set, ensure the mini model uses the same provider.
  // Pi SDK will fail with "No API key found" if the model requires a different provider.
  if (initConfig.piAuth) {
    const authProvider = initConfig.piAuth.provider;
    const bareModel = model.startsWith('pi/') ? model.slice(3) : model;
    // Check if the model belongs to the authenticated provider
    const modelRegistry = new PiModelRegistry(PiAuthStorage.inMemory());
    const resolved = resolvePiModel(modelRegistry, bareModel, authProvider);
    if (!resolved || (resolved as any).provider !== authProvider) {
      // Model doesn't exist in registry or belongs to a different provider — use miniModel
      const fallback = initConfig.miniModel ?? getDefaultSummarizationModel();
      debugLog(`[queryLlm] Model ${bareModel} incompatible with ${authProvider}, falling back to ${fallback}`);
      model = fallback;
    }
  }

  debugLog(`[queryLlm] Using model: ${model}`);

  const { authStorage, modelRegistry } = createAuthenticatedRegistry();

  // Create minimal ephemeral session
  const ephemeralOptions: CreateAgentSessionOptions = {
    cwd: resolvedCwd(),
    authStorage,
    modelRegistry,
    tools: [],
    sessionManager: PiSessionManager.inMemory(),
  };

  // Resolve model
  try {
    const piModel = resolvePiModel(modelRegistry, model, initConfig.piAuth?.provider);
    if (piModel) {
      ephemeralOptions.model = piModel;
    }
  } catch {
    debugLog(`[queryLlm] Could not resolve model: ${model}`);
  }

  const { session: ephemeralSession } = await createAgentSession(ephemeralOptions);
  debugLog(`[queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

  // Set system prompt
  if (request.systemPrompt) {
    ephemeralSession.agent.setSystemPrompt(request.systemPrompt);
  } else {
    ephemeralSession.agent.setSystemPrompt('Reply with ONLY the requested text. No explanation.');
  }

  // Collect response text from events
  let result = '';
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
      };
      if (msg.role !== 'assistant') return;

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
    await withTimeout(completionPromise, 30000, 'queryLlm timed out after 30s');
    debugLog(`[queryLlm] Result length: ${result.trim().length}`);
    return { text: result.trim(), model };
  } finally {
    unsub();
    ephemeralSession.dispose();
  }
}

async function preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
  const request = await buildCallLlmRequest(input, { backendName: 'Pi' });
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

function handleSessionEvent(event: AgentSessionEvent): void {
  // Log API errors for debugging
  if (event.type === 'message_end') {
    const msg = event.message as { stopReason?: string; errorMessage?: string } | undefined;
    if (msg?.stopReason === 'error') {
      debugLog(`API error in message_end: ${msg.errorMessage || 'unknown'}`);
    }
  }

  // Detect session MCP tool completions
  if (event.type === 'tool_execution_start') {
    const toolName = event.toolName;
    if (toolName.startsWith('session__') || toolName.startsWith('mcp__session__')) {
      const mcpToolName = toolName.replace(/^(mcp__session__|session__)/, '');
      pendingSessionToolCalls.set(event.toolCallId, {
        toolName: mcpToolName,
        arguments: (event.args ?? {}) as Record<string, unknown>,
      });
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
  send({ type: 'event', event });
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
  permissionMode = msg.permissionMode || 'ask';
  activeSourceSlugs = msg.activeSourceSlugs || [];

  // Start callback server for call_llm (idempotent — skips if already running)
  await startCallbackServer();

  send({
    type: 'ready',
    sessionId: null,
    callbackPort,
  });
}

async function handlePrompt(msg: Extract<InboundMessage, { type: 'prompt' }>): Promise<void> {
  currentUserMessage = msg.message;

  try {
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

    // Fire prompt
    await session.prompt(msg.message, {
      images: msg.images && msg.images.length > 0 ? msg.images : undefined,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
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

  // If session exists, rebuild tools in-place (no disposal needed)
  rebuildSessionTools();
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

function handlePermissionResponse(msg: Extract<InboundMessage, { type: 'permission_response' }>): void {
  const pending = pendingPermissions.get(msg.requestId);
  if (pending) {
    pendingPermissions.delete(msg.requestId);
    pending.resolve(msg.allowed);
  } else {
    debugLog(`No pending permission for requestId: ${msg.requestId}`);
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

  // Reject all pending permissions
  for (const [, pending] of pendingPermissions) {
    pending.resolve(false);
  }
  pendingPermissions.clear();
}

async function handleMiniCompletion(msg: Extract<InboundMessage, { type: 'mini_completion' }>): Promise<void> {
  const text = await runMiniCompletion(msg.prompt);
  send({ type: 'mini_completion_result', id: msg.id, text });
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
    return;
  }
  try {
    await piSession.setModel(piModel);
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
  for (const [, pending] of pendingPermissions) {
    pending.resolve(false);
  }
  pendingPermissions.clear();

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

    case 'permission_response':
      handlePermissionResponse(msg);
      break;

    case 'abort':
      await handleAbort();
      break;

    case 'set_permission_mode':
      permissionMode = msg.mode;
      debugLog(`Permission mode set to: ${msg.mode}`);
      break;

    case 'set_active_sources':
      activeSourceSlugs = msg.slugs;
      debugLog(`Active sources set to: ${msg.slugs.join(', ')}`);
      break;

    case 'mini_completion':
      await handleMiniCompletion(msg);
      break;

    case 'set_model':
      await handleSetModel(msg);
      break;

    case 'token_update':
      if (moduleAuthStorage) {
        const { provider, credential } = msg.piAuth;
        moduleAuthStorage.set(provider, credential);
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
