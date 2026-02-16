/**
 * Amp Backend (Amp CLI)
 *
 * Agent backend implementation using the Amp CLI from ampcode.com.
 * Wraps the Amp CLI via subprocess with JSON streaming I/O.
 *
 * Auth is handled by Amp's native auth system (ampcode.com/install).
 * Tokens are stored by Amp CLI, not in our credential store.
 *
 * Key features:
 * - Multi-model support (Opus 4.6, GPT-5.2 Codex, etc.)
 * - Three modes: smart, rush, deep
 * - Thread persistence and sharing
 * - Oracle for complex reasoning
 * - Subagents for parallel tasks
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import type { ThinkingLevel } from './thinking-levels.ts';
import { type PermissionMode, shouldAllowToolInMode } from './mode-manager.ts';

import type {
  BackendConfig,
  ChatOptions,
  SdkMcpServerConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';

import { BaseAgent } from './base-agent.ts';
import type { Workspace } from '../config/storage.ts';

import { AmpEventAdapter, type AmpStreamMessage } from './backend/amp/event-adapter.ts';
import { EventQueue } from './backend/event-queue.ts';

import { getSystemPrompt } from '../prompts/system.ts';
import { getCredentialManager } from '../credentials/manager.ts';
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';
import { parseError, type AgentError } from './errors.ts';

/**
 * Amp mode type - determines model selection and behavior.
 * - smart: uses Claude Opus 4.6 for maximum capability
 * - rush: faster, cheaper, suitable for small tasks
 * - deep: deep reasoning with GPT-5.2 Codex
 */
type AmpMode = 'smart' | 'rush' | 'deep';

/**
 * Map our model IDs to Amp modes.
 */
const MODEL_TO_AMP_MODE: Record<string, AmpMode> = {
  'amp-smart': 'smart',
  'amp-rush': 'rush',
  'amp-deep': 'deep',
};

/**
 * Map thinking levels to Amp modes as fallback.
 */
const THINKING_TO_AMP_MODE: Record<ThinkingLevel, AmpMode> = {
  off: 'rush',
  think: 'smart',
  max: 'deep',
};

/**
 * Map Amp tool names to our permission system's PascalCase names.
 */
const AMP_TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  task: 'Task',
  mcp: 'Mcp',
};

/**
 * Resolve the Amp CLI binary path.
 * Checks common installation locations.
 */
export function resolveAmpBinary(configPath?: string): { path: string; source: string } | null {
  if (configPath && existsSync(configPath)) {
    return { path: configPath, source: 'config' };
  }

  const possiblePaths = [
    join(homedir(), '.local', 'bin', 'amp'),
    '/usr/local/bin/amp',
    '/opt/homebrew/bin/amp',
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return { path: p, source: 'system' };
    }
  }

  return { path: 'amp', source: 'PATH' };
}

/**
 * Check if Amp CLI is installed and accessible.
 */
export async function isAmpInstalled(): Promise<boolean> {
  const commonPaths = [
    join(homedir(), '.local', 'bin', 'amp'),
    '/usr/local/bin/amp',
    '/opt/homebrew/bin/amp',
  ];

  for (const ampPath of commonPaths) {
    if (existsSync(ampPath)) {
      return true;
    }
  }

  return new Promise((resolve) => {
    const proc = spawn('amp', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      timeout: 5000,
    });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Get Amp CLI version string.
 */
export async function getAmpVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('amp', ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    proc.stdout?.on('data', (data) => { output += data.toString(); });

    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim().split('\n')[0] || null);
      }
      resolve(null);
    });
  });
}

/**
 * Backend implementation using the Amp CLI.
 *
 * Communication with Amp CLI:
 * - Spawns `amp --execute --stream-json --stream-json-input` subprocess
 * - Sends user messages as JSON on stdin
 * - Receives streaming JSON events on stdout
 * - Thread continuity via `amp threads continue`
 */
export class AmpAgent extends BaseAgent {
  private ampProcess: ChildProcess | null = null;
  private ampStdoutReader: ReadlineInterface | null = null;
  private ampThreadId: string | null = null;

  private _isProcessing: boolean = false;
  private abortReason?: AbortReason;

  private adapter: AmpEventAdapter;
  private eventQueue = new EventQueue();

  private pendingPermissions: Map<string, {
    resolve: (allowed: boolean) => void;
    toolName: string;
  }> = new Map();

  private currentUserMessage: string = '';
  private sourceMcpServers: Record<string, SdkMcpServerConfig> = {};
  private sourceApiServers: Record<string, unknown> = {};
  private ampBinaryPath: string;

  /** Called when Amp auth is required */
  onAmpAuthRequired: ((reason: string) => void) | null = null;

  constructor(config: BackendConfig) {
    const defaultModel = 'amp-smart';
    super({ ...config, model: config.model || defaultModel }, defaultModel, 200_000);

    this.adapter = new AmpEventAdapter();

    // only use sdkSessionId if it's a valid Amp thread ID (starts with "T-")
    const candidateThreadId = config.session?.sdkSessionId || null;
    this.ampThreadId = this.isValidAmpThreadId(candidateThreadId) ? candidateThreadId : null;

    if (candidateThreadId && !this.ampThreadId) {
      this.debug(`Ignoring non-Amp session ID: ${candidateThreadId}`);
    }

    // resolve amp binary
    const resolved = resolveAmpBinary(config.ampPath);
    this.ampBinaryPath = resolved?.path || 'amp';
    this.debug(`Amp binary resolved: ${this.ampBinaryPath} (source: ${resolved?.source || 'fallback'})`);

    if (!config.isHeadless) {
      this.startConfigWatcher();
    }
  }

  /**
   * Check if a string is a valid Amp thread ID.
   * Amp thread IDs have the format: T-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   */
  private isValidAmpThreadId(id: string | null | undefined): boolean {
    if (!id) return false;
    return id.startsWith('T-') && id.length > 3;
  }

  protected override debug(message: string): void {
    this.onDebug?.(`[Amp] ${message}`);
  }

  /**
   * Get Amp mode from model ID or thinking level.
   */
  private getAmpMode(): AmpMode {
    if (this._model && MODEL_TO_AMP_MODE[this._model]) {
      return MODEL_TO_AMP_MODE[this._model];
    }
    return THINKING_TO_AMP_MODE[this._thinkingLevel] || 'smart';
  }

  /**
   * Spawn a new Amp CLI subprocess for a chat turn.
   * Each message spawns a fresh process with --stream-json-input for multi-turn support.
   */
  private spawnAmpProcess(): ChildProcess {
    // kill existing process if any
    if (this.ampProcess && !this.ampProcess.killed) {
      this.ampProcess.kill();
      this.ampProcess = null;
    }

    const args: string[] = [];

    // thread continuation if we have a thread ID
    if (this.ampThreadId) {
      args.push('threads', 'continue', this.ampThreadId);
    }

    // core flags for streaming JSON I/O
    args.push('--execute');
    args.push('--stream-json');
    args.push('--stream-json-input');
    args.push('--stream-json-thinking');

    // use dangerously-allow-all since we handle permissions ourselves
    args.push('--dangerously-allow-all');

    // resolve full binary path if needed
    let binaryPath = this.ampBinaryPath;
    if (binaryPath === 'amp') {
      // try common locations
      const commonPaths = [
        join(homedir(), '.local', 'bin', 'amp'),
        '/usr/local/bin/amp',
        '/opt/homebrew/bin/amp',
      ];
      for (const p of commonPaths) {
        if (existsSync(p)) {
          binaryPath = p;
          break;
        }
      }
    }

    this.debug(`Spawning Amp: ${binaryPath} ${args.join(' ')}`);
    this.debug(`Working directory: ${this.workingDirectory}`);

    const proc = spawn(binaryPath, args, {
      cwd: this.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${join(homedir(), '.local', 'bin')}:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
      },
    });

    this.ampProcess = proc;

    if (proc.stdout) {
      this.ampStdoutReader = createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });
    }

    proc.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        this.debug(`stderr: ${msg}`);
      }
    });

    proc.on('close', (code) => {
      this.debug(`Amp process exited with code ${code}`);
      this.ampProcess = null;
      this.ampStdoutReader = null;
    });

    proc.on('error', (err) => {
      this.debug(`Amp process error: ${err.message}`);
      if (err.message.includes('ENOENT')) {
        this.onAmpAuthRequired?.('Amp CLI not found. Please install from ampcode.com/install');
      }
    });

    return proc;
  }

  async *chat(
    messageParam: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    let message = messageParam;

    this._isProcessing = true;
    this.abortReason = undefined;
    this.eventQueue.reset();
    this.currentUserMessage = message;
    this.adapter.startTurn();

    try {
      const proc = this.spawnAmpProcess();

      // build context parts
      const sourceContext = this.sourceManager.formatSourceState();
      const contextParts = this.promptBuilder.buildContextParts(
        { plansFolderPath: getSessionPlansPath(this.config.workspace.rootPath, this._sessionId) },
        sourceContext
      );

      // process attachments
      const attachmentParts: string[] = [];
      for (const att of attachments || []) {
        if (att.mimeType?.startsWith('image/') && (att.storedPath || att.path)) {
          attachmentParts.push(`[Attached image: ${att.name}]\n[Stored at: ${att.storedPath || att.path}]`);
        } else if (att.mimeType === 'application/pdf' && att.storedPath) {
          attachmentParts.push(`[Attached PDF: ${att.name}]\n[Stored at: ${att.storedPath}]`);
        } else if (att.storedPath) {
          let pathInfo = `[Attached file: ${att.name}]\n[Stored at: ${att.storedPath}]`;
          if (att.markdownPath) {
            pathInfo += `\n[Markdown version: ${att.markdownPath}]`;
          }
          attachmentParts.push(pathInfo);
        }
      }

      // extract skill content
      const { skillContents, cleanMessage: effectiveMessage } = this.extractSkillContent(message);

      // combine message parts
      const messageParts = [
        ...skillContents,
        ...contextParts,
        ...attachmentParts,
        effectiveMessage,
      ].filter(Boolean);
      const fullMessage = messageParts.join('\n\n');

      // build JSON input message per Amp's streaming JSON input format
      const inputMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: fullMessage }],
        },
      };

      this.debug(`Sending message: ${fullMessage.substring(0, 100)}...`);

      // write message to stdin
      if (proc.stdin) {
        const jsonLine = JSON.stringify(inputMessage) + '\n';
        proc.stdin.write(jsonLine);
        this.debug(`Wrote ${jsonLine.length} bytes to stdin`);
      }

      // wait a bit for process to start processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // process streaming output
      if (this.ampStdoutReader) {
        this.debug('Starting to read stdout...');

        for await (const line of this.ampStdoutReader) {
          if (!line.trim()) continue;

          this.debug(`Received line: ${line.substring(0, 200)}`);

          try {
            const msg = JSON.parse(line) as AmpStreamMessage;

            // capture thread ID from session info
            if (msg.session_id && !this.ampThreadId) {
              this.ampThreadId = msg.session_id;
              this.config.onSdkSessionIdUpdate?.(msg.session_id);
              this.debug(`Thread ID captured: ${msg.session_id}`);
            }

            // track usage/cost
            if (msg.cost_usd !== undefined) {
              const estimatedTokens = Math.round((msg.cost_usd / 0.01) * 1000);
              this.usageTracker.recordMessageUsage({
                inputTokens: estimatedTokens,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
              });
            }

            // handle errors (can be object or string)
            if (msg.error) {
              const typedError = this.parseAmpError(msg.error);
              if (typedError.code === 'invalid_credentials') {
                this.onAmpAuthRequired?.(typedError.message);
              }
              yield { type: 'typed_error', error: typedError };
              continue;
            }

            // handle result errors (is_error flag or error_during_execution subtype)
            if (msg.type === 'result' && (msg.is_error || msg.subtype === 'error_during_execution')) {
              const errorStr = typeof msg.error === 'string' ? msg.error : (msg.result || 'Unknown Amp error');
              const typedError = this.parseAmpError(errorStr);
              yield { type: 'typed_error', error: typedError };
              this.eventQueue.complete();
              break;
            }

            // adapt message to AgentEvents
            for (const event of this.adapter.adaptMessage(msg)) {
              this.eventQueue.enqueue(event);
            }

            // check for completion
            if (msg.type === 'result' || msg.message?.stop_reason) {
              this.debug('Received completion signal');
              this.eventQueue.complete();
              break;
            }
          } catch (parseError) {
            this.debug(`Failed to parse JSON line: ${line}`);
          }
        }
      }

      yield* this.eventQueue.drain();
    } catch (error) {
      if (error instanceof Error && error.message.includes('abort')) {
        if (this.abortReason === AbortReason.PlanSubmitted) {
          return;
        }
        if (this.abortReason === AbortReason.AuthRequest) {
          return;
        }
        return;
      }

      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.debug(`Chat error: ${errorObj.message}`);
      const typedError = this.parseAmpError({ code: 'unknown', message: errorObj.message });

      yield { type: 'typed_error', error: typedError };
      yield { type: 'complete' };
    } finally {
      this._isProcessing = false;
      // close stdin to signal end of input
      if (this.ampProcess?.stdin) {
        this.ampProcess.stdin.end();
      }
    }
  }

  private parseAmpError(error: { code?: string; message: string } | string): AgentError {
    const errorMessage = typeof error === 'string' ? error.toLowerCase() : error.message.toLowerCase();
    const errorCode = typeof error === 'string' ? undefined : error.code;

    if (errorMessage.includes('not authenticated') ||
        errorMessage.includes('login') ||
        errorMessage.includes('sign in') ||
        errorCode === 'auth_required') {
      return {
        code: 'invalid_credentials',
        title: 'Amp Authentication Required',
        message: 'Please run `amp` in your terminal to sign in.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: false,
      };
    }

    if (errorMessage.includes('rate limit') || errorCode === 'rate_limited') {
      return {
        code: 'rate_limited',
        title: 'Rate Limited',
        message: 'Amp rate limit reached. Please wait a moment.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
      };
    }

    if (errorMessage.includes('credit') || errorMessage.includes('billing') || 
        errorMessage.includes('paid credits') || errorMessage.includes('402') ||
        errorMessage.includes('ampcode.com/pay') || errorCode === 'insufficient_credits') {
      return {
        code: 'insufficient_credits',
        title: 'Amp Credits Required',
        message: 'Amp\'s execute mode requires paid credits. The free tier only works in interactive mode. Add credits at ampcode.com/pay',
        actions: [
          { key: 'o', label: 'Add Credits', action: 'open_url' },
        ],
        canRetry: false,
      };
    }

    return {
      code: 'api_error',
      title: 'Amp Error',
      message: error.message || 'An unknown error occurred',
      actions: [
        { key: 'r', label: 'Retry', action: 'retry' },
      ],
      canRetry: true,
    };
  }

  // BaseAgent interface implementations

  override get isProcessing(): boolean {
    return this._isProcessing;
  }

  override async abort(): Promise<void> {
    if (this.ampProcess && !this.ampProcess.killed) {
      this.ampProcess.kill('SIGTERM');
    }
    this._isProcessing = false;
    this.eventQueue.complete();
  }

  override forceAbort(reason?: AbortReason): void {
    this.abortReason = reason;
    if (this.ampProcess && !this.ampProcess.killed) {
      this.ampProcess.kill('SIGKILL');
    }
    this._isProcessing = false;
    this.eventQueue.complete();
  }

  override async resolvePermission(requestId: string, allowed: boolean): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      pending.resolve(allowed);
      this.pendingPermissions.delete(requestId);
    }
  }

  override setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    slugs: string[]
  ): void {
    this.sourceMcpServers = mcpServers;
    this.sourceApiServers = apiServers;
    this.sourceManager.setEnabledSlugs(slugs);
  }

  override async dispose(): Promise<void> {
    if (this.ampProcess && !this.ampProcess.killed) {
      this.ampProcess.kill();
    }
    this.ampProcess = null;
    this.ampStdoutReader = null;
    await super.dispose();
  }
}

/** @deprecated Use AmpAgent instead */
export { AmpAgent as AmpBackend };