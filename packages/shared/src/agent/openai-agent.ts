/**
 * OpenAI Agent Backend
 *
 * Native OpenAI API backend using the openai npm package.
 * Unlike CodexAgent, this does NOT require the external Codex app-server binary.
 * Users authenticate with a standard OpenAI API key.
 *
 * Supported provider types:
 *   - 'openai_direct' → api.openai.com with API key
 *   - (future) also handles 'openai_direct' with custom base URLs for compatible APIs
 *
 * Architecture:
 * - Extends BaseAgent for common state, permissions, sources, prompt building
 * - Implements the agentic loop in-process: call API → parse tool calls → execute → loop
 * - Uses ToolExecutor for core dev tools (Read, Write, Edit, Bash, Glob, Grep)
 * - Uses McpClientManager for MCP source integrations
 * - Permission requests are surfaced via 'permission_request' AgentEvents and resolved
 *   through respondToPermission() / a promise-based wait mechanism
 */

import OpenAI from 'openai';
import type { AgentEvent } from '@craft-agent/core/types';
import { BaseAgent } from './base-agent.ts';
import type { BackendConfig, ChatOptions, SdkMcpServerConfig } from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import type { FileAttachment } from '../utils/files.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { getLlmConnection } from '../config/storage.ts';
import { getSystemPrompt } from '../prompts/system.ts';
import { OPENAI_DIRECT_MODELS } from '../config/models.ts';
import { McpClientManager } from './core/mcp-client-manager.ts';
import { executeTool, ALL_TOOL_SCHEMAS } from './core/tool-executor.ts';
import type { ToolExecutionContext } from './core/tool-executor.ts';
import { debug } from '../utils/debug.ts';
import { readFileSync } from 'node:fs';

// ============================================================
// Constants
// ============================================================

const DEFAULT_MODEL = OPENAI_DIRECT_MODELS[0]?.id ?? 'gpt-4o';
const DEFAULT_CONTEXT_WINDOW = 128_000;
const MAX_TOOL_ITERATIONS = 50; // safety limit for tool call loops

// ============================================================
// OpenAI message types (chat completions)
// ============================================================

type OpenAIMessage =
  | OpenAI.Chat.ChatCompletionSystemMessageParam
  | OpenAI.Chat.ChatCompletionUserMessageParam
  | OpenAI.Chat.ChatCompletionAssistantMessageParam
  | OpenAI.Chat.ChatCompletionToolMessageParam;

// ============================================================
// OpenAIAgent
// ============================================================

export class OpenAIAgent extends BaseAgent {
  // OpenAI client (lazily initialized once API key is known)
  private openaiClient: OpenAI | null = null;

  // Persistent conversation history for this session
  private messages: OpenAIMessage[] = [];

  // AbortController for the current streaming API call
  private currentAbortController: AbortController | null = null;

  // AbortReason for forceAbort (non-user-facing)
  private forceAbortReason: AbortReason | null = null;

  // Whether a chat() call is currently active
  private _isProcessing = false;

  // MCP manager for source integrations
  private mcpManager: McpClientManager = new McpClientManager();

  // Pending permission approvals: requestId → { resolve }
  private pendingPermissions: Map<string, { resolve: (granted: boolean) => void }> = new Map();

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig) {
    super(config, DEFAULT_MODEL, DEFAULT_CONTEXT_WINDOW);
    if (!config.isHeadless) {
      this.startConfigWatcher();
    }
  }

  // ============================================================
  // AgentBackend implementation
  // ============================================================

  async *chat(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    if (this._isProcessing) {
      yield { type: 'error', message: 'Agent is already processing a request' };
      return;
    }
    this._isProcessing = true;
    this.forceAbortReason = null;

    try {
      const client = await this.getOrCreateClient();

      // Extract skill mentions from the message (like CodexAgent / CopilotAgent)
      const { skillContents, cleanMessage } = this.extractSkillContent(message);

      // Build context parts (date/time, permission mode, source state, workspace info)
      const activeSlugs = this.getActiveSourceSlugs();
      const contextParts = this.promptBuilder.buildContextParts({
        permissionMode: this.permissionManager.getPermissionMode(),
        activeSources: activeSlugs,
        inactiveSources: this.getAllSources().filter(
          s => !activeSlugs.includes(s.config.slug)
        ),
      });

      // Compose user message text: skills + context + message
      const userContentParts: string[] = [
        ...skillContents,
        ...contextParts,
        ...(cleanMessage ? [cleanMessage] : []),
      ];

      // Handle file attachments
      const userContent = await buildUserContent(
        userContentParts.join('\n\n'),
        attachments ?? []
      );

      // Add user message to history
      this.messages.push({ role: 'user', content: userContent });

      // Collect all tools: core dev tools + MCP tools
      const mcpTools = await this.mcpManager.listTools();
      const allTools: OpenAI.Chat.ChatCompletionTool[] = [
        ...(ALL_TOOL_SCHEMAS as unknown as OpenAI.Chat.ChatCompletionTool[]),
        ...mcpTools,
      ];

      // Build execution context for tool runner
      const toolContext: ToolExecutionContext = {
        workingDirectory: this.workingDirectory,
        permissionManager: this.permissionManager,
        requestPermission: async (requestId, command, description) => {
          // Surface permission_request event then wait for respondToPermission()
          return new Promise<boolean>((resolve) => {
            this.pendingPermissions.set(requestId, { resolve });
            // Note: we can't yield here because we're in a callback, not the generator.
            // The caller (the agentic loop) must observe the permission event via
            // the onPermissionRequest callback and emit it as an AgentEvent externally.
            this.onPermissionRequest?.({
              requestId,
              toolName: 'Bash',
              command,
              description,
              type: 'bash',
            });
          });
        },
      };

      // Agentic loop
      let iterations = 0;
      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Check for force abort
        if (this.forceAbortReason !== null) {
          this.debug(`[OpenAIAgent] Force aborted: ${this.forceAbortReason}`);
          return;
        }

        // Build system prompt on first message only (for caching efficiency)
        const systemPrompt = getSystemPrompt(
          undefined,
          this.config.debugMode,
          this.config.workspace.rootPath,
          this.workingDirectory,
          this.config.systemPromptPreset ?? 'default',
          'OpenAI'
        );

        this.currentAbortController = new AbortController();
        const stream = await client.chat.completions.create(
          {
            model: this._model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...this.messages,
            ],
            tools: allTools.length > 0 ? allTools : undefined,
            tool_choice: allTools.length > 0 ? 'auto' : undefined,
            stream: true,
          },
          { signal: this.currentAbortController.signal }
        );

        // Collect streamed response
        let assistantText = '';
        const toolCallsAccumulator: Map<number, {
          id: string;
          name: string;
          argsJson: string;
        }> = new Map();
        let finishReason: string | null = null;
        let turnId: string | undefined;

        try {
          for await (const chunk of stream) {
            // Check for force abort mid-stream
            if (this.forceAbortReason !== null) {
              this.currentAbortController.abort();
              return;
            }

            const choice = chunk.choices[0];
            if (!choice) continue;

            // Capture turn ID from first chunk
            if (!turnId && chunk.id) {
              turnId = chunk.id;
            }

            const delta = choice.delta;

            // Stream text content
            if (delta.content) {
              assistantText += delta.content;
              yield { type: 'text_delta', text: delta.content, turnId };
            }

            // Accumulate tool calls (streamed in pieces)
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallsAccumulator.get(tc.index);
                if (existing) {
                  existing.argsJson += tc.function?.arguments ?? '';
                } else {
                  toolCallsAccumulator.set(tc.index, {
                    id: tc.id ?? `call_${tc.index}`,
                    name: tc.function?.name ?? '',
                    argsJson: tc.function?.arguments ?? '',
                  });
                }
              }
            }

            finishReason = choice.finish_reason ?? finishReason;
          }
        } catch (err: unknown) {
          if ((err as { name?: string }).name === 'AbortError') {
            return; // Stream was aborted (user stop or force abort)
          }
          yield { type: 'error', message: `Stream error: ${errorMessage(err)}` };
          return;
        } finally {
          this.currentAbortController = null;
        }

        // Emit complete text
        if (assistantText) {
          yield { type: 'text_complete', text: assistantText, turnId };
        }

        const toolCalls = [...toolCallsAccumulator.values()];

        // Append assistant message to history
        this.messages.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: toolCalls.length > 0
            ? toolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.argsJson },
              }))
            : undefined,
        });

        // If no tool calls, the turn is complete
        if (toolCalls.length === 0 || finishReason === 'stop') {
          break;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          // Check for force abort before each tool
          if (this.forceAbortReason !== null) return;

          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(tc.argsJson || '{}');
          } catch {
            toolArgs = {};
          }

          // Emit tool_start
          yield {
            type: 'tool_start',
            toolName: tc.name,
            toolUseId: tc.id,
            input: toolArgs,
            turnId,
          };

          let resultText: string;
          let isError = false;

          try {
            if (this.mcpManager.isMcpTool(tc.name)) {
              // Route to MCP server
              resultText = await this.mcpManager.callTool(tc.name, toolArgs);
            } else {
              // Execute core tool in-process
              const result = await executeTool(tc.name, toolArgs, toolContext);
              resultText = result.text;
              isError = result.isError;

              // Handle session MCP tool completions (SubmitPlan, auth triggers)
              if (!isError) {
                this.handleSessionMcpToolCompletion(tc.name, toolArgs);
              }
            }
          } catch (err) {
            resultText = `Tool execution error: ${errorMessage(err)}`;
            isError = true;
          }

          // Emit tool_result
          yield {
            type: 'tool_result',
            toolUseId: tc.id,
            toolName: tc.name,
            result: resultText,
            isError,
            input: toolArgs,
            turnId,
          };

          // Add tool result to history
          this.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: resultText,
          });

          // Check if force abort was triggered by a tool (e.g., SubmitPlan)
          if (this.forceAbortReason !== null) return;
        }
      }

      if (iterations >= MAX_TOOL_ITERATIONS) {
        yield { type: 'error', message: `Exceeded maximum tool iteration limit (${MAX_TOOL_ITERATIONS})` };
      }

      yield { type: 'complete' };
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') {
        return;
      }
      yield { type: 'error', message: `Agent error: ${errorMessage(err)}` };
    } finally {
      this._isProcessing = false;
      this.currentAbortController = null;
    }
  }

  async abort(reason?: string): Promise<void> {
    this.debug(`[OpenAIAgent] abort() called: ${reason ?? '(no reason)'}`);
    this.currentAbortController?.abort();
    this._isProcessing = false;
    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve(false);
    }
    this.pendingPermissions.clear();
  }

  forceAbort(reason: AbortReason): void {
    this.debug(`[OpenAIAgent] forceAbort(${reason})`);
    this.forceAbortReason = reason;
    this.currentAbortController?.abort();
    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve(false);
    }
    this.pendingPermissions.clear();
  }

  isProcessing(): boolean {
    return this._isProcessing;
  }

  respondToPermission(requestId: string, allowed: boolean, _alwaysAllow?: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      this.debug(`[OpenAIAgent] respondToPermission: unknown requestId ${requestId}`);
      return;
    }
    this.pendingPermissions.delete(requestId);
    pending.resolve(allowed);
  }

  // ============================================================
  // Source (MCP) Management
  // ============================================================

  override setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    _apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): void {
    super.setSourceServers(mcpServers, _apiServers, intendedSlugs);
    // Update MCP manager asynchronously; errors are non-fatal
    this.mcpManager.update(mcpServers).catch(err => {
      this.debug(`[OpenAIAgent] MCP update error: ${errorMessage(err)}`);
    });
  }

  // ============================================================
  // Simple completions (title generation, summarization, call_llm)
  // ============================================================

  async runMiniCompletion(prompt: string): Promise<string | null> {
    try {
      const result = await this.queryLlm({ prompt });
      return result.text || null;
    } catch (err) {
      this.debug(`[OpenAIAgent] runMiniCompletion failed: ${errorMessage(err)}`);
      return null;
    }
  }

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const client = await this.getOrCreateClient();
    const model = request.model ?? this.config.miniModel ?? this._model;

    const response = await client.chat.completions.create({
      model,
      messages: [
        ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
        { role: 'user', content: request.prompt },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: false,
    });

    const text = response.choices[0]?.message.content ?? '';
    return {
      text,
      model: response.model,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    };
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  override destroy(): void {
    super.destroy();
    this.currentAbortController?.abort();
    this.mcpManager.destroy().catch(() => {});
    this.pendingPermissions.clear();
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private async getOrCreateClient(): Promise<OpenAI> {
    if (this.openaiClient) return this.openaiClient;

    const { apiKey, baseURL } = await this.resolveCredentials();

    this.openaiClient = new OpenAI({
      apiKey,
      baseURL: baseURL ?? undefined,
    });

    return this.openaiClient;
  }

  /**
   * Resolve API key and optional base URL from:
   * 1. Environment variables (OPENAI_API_KEY / OPENAI_BASE_URL)
   * 2. Credential manager (stored by onboarding flow under connectionSlug)
   * 3. Connection config baseUrl field
   */
  private async resolveCredentials(): Promise<{ apiKey: string; baseURL: string | null }> {
    // Check env var first (useful for headless / CI use)
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
      return {
        apiKey: envKey,
        baseURL: process.env.OPENAI_BASE_URL ?? null,
      };
    }

    // Look up from credential manager using the connection slug
    const slug = this.config.connectionSlug;
    if (!slug) {
      throw new Error('[OpenAIAgent] No connectionSlug set and OPENAI_API_KEY env var is not present');
    }

    const credManager = getCredentialManager();
    const apiKey = await credManager.getLlmApiKey(slug);
    if (!apiKey) {
      throw new Error(`[OpenAIAgent] No API key found for connection "${slug}". Please re-authenticate in Settings.`);
    }

    // Get baseURL from connection config (for openai_direct with custom endpoint)
    const connection = getLlmConnection(slug);
    const baseURL = connection?.baseUrl ?? null;

    return { apiKey, baseURL };
  }
}

// ============================================================
// Utilities
// ============================================================

/**
 * Build the user message content array for the OpenAI API.
 * Supports text and image attachments.
 */
async function buildUserContent(
  text: string,
  attachments: FileAttachment[]
): Promise<string | OpenAI.Chat.ChatCompletionContentPart[]> {
  if (attachments.length === 0) {
    return text;
  }

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];

  if (text) {
    parts.push({ type: 'text', text });
  }

  for (const attachment of attachments) {
    if (attachment.type === 'image' && attachment.path) {
      try {
        const data = readFileSync(attachment.path);
        const base64 = data.toString('base64');
        const mimeType = (attachment.mimeType || 'image/png') as
          | 'image/jpeg'
          | 'image/png'
          | 'image/gif'
          | 'image/webp';
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` },
        });
      } catch {
        // Skip unreadable attachments
        debug(`[OpenAIAgent] Could not read attachment: ${attachment.path}`);
      }
    }
  }

  return parts.length > 0 ? parts : text;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
