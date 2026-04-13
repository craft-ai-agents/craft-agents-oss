/**
 * ACP Transport Layer
 *
 * Defines the AcpTransport interface and provides concrete implementations:
 * - InProcessAcpTransport: in-memory mock for unit tests
 * - StdioAcpTransport: spawns a local process via stdio (Task 3)
 * - HttpAcpTransport: connects via HTTP+SSE (Task 4)
 *
 * JSON-RPC 2.0 framing is handled at the transport layer.
 * The AcpAgent interacts only through the AcpTransport interface.
 */

import type { BackendConfig } from './backend/types.ts';

// ============================================================
// AcpTransport Interface
// ============================================================

/**
 * Transport abstraction for Agent Client Protocol (ACP) JSON-RPC 2.0.
 *
 * Implementations handle framing, connection lifecycle, and JSON-RPC
 * request/response correlation. The AcpAgent uses this interface exclusively.
 *
 * Error contract for onRequest:
 *   Transport implementations MUST wrap handler invocations in try/catch.
 *   On handler throw, the transport sends a JSON-RPC error response with
 *   { code: error.code ?? -32603, message: error.message }.
 */
export interface AcpTransport {
  /**
   * Send a JSON-RPC request and await the response.
   * Rejects if the peer returns a JSON-RPC error response or transport fails.
   */
  sendRequest(method: string, params?: unknown): Promise<unknown>;

  /**
   * Register a handler for incoming JSON-RPC notifications (no response expected).
   * Replaces any previously registered handler.
   */
  onNotification(handler: (method: string, params: unknown) => void): void;

  /**
   * Register a handler for incoming JSON-RPC requests (response required).
   * The transport sends the return value as the JSON-RPC result.
   * If the handler throws, the transport sends a JSON-RPC error response.
   * Replaces any previously registered handler.
   */
  onRequest(handler: (method: string, params: unknown, id: string | number) => Promise<unknown>): void;

  /**
   * Tear down the transport. Resolves when cleanup is complete.
   * Safe to call multiple times (idempotent).
   */
  dispose(): Promise<void>;
}

// ============================================================
// JSON-RPC Types (internal)
// ============================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  result: unknown;
  id: string | number;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  error: { code: number; message: string; data?: unknown };
  id: string | number;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg);
}

function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg && 'id' in msg;
}

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

// ============================================================
// InProcessAcpTransport
// ============================================================

/**
 * In-memory ACP transport for unit testing.
 *
 * createLinkedTransports() returns two paired transports [client, server]
 * that exchange messages directly in-memory without I/O. Both sides expose
 * helper methods (triggerNotification, triggerRequest) to simulate messages
 * sent from that side to the other.
 */
export class InProcessAcpTransport implements AcpTransport {
  private _disposed = false;
  private _peer: InProcessAcpTransport | null = null;
  private _notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private _requestHandler: ((method: string, params: unknown, id: string | number) => Promise<unknown>) | null = null;
  private _pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private _nextId = 1;

  /** Called by createLinkedTransports to wire the two halves together */
  _setPeer(peer: InProcessAcpTransport): void {
    this._peer = peer;
  }

  /**
   * Deliver a JSON-RPC message to this transport (called by the peer).
   * @internal
   */
  async _receive(msg: JsonRpcMessage): Promise<void> {
    if (this._disposed) return;

    if (isResponse(msg)) {
      const pending = this._pendingRequests.get(msg.id);
      if (!pending) return;
      this._pendingRequests.delete(msg.id);

      if ('error' in msg) {
        pending.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (isRequest(msg)) {
      const handler = this._requestHandler;
      if (!handler) {
        // No handler registered — send method not found error
        void this._peer?._receive({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${msg.method}` },
          id: msg.id,
        });
        return;
      }

      try {
        const result = await handler(msg.method, msg.params ?? null, msg.id);
        void this._peer?._receive({ jsonrpc: '2.0', result, id: msg.id });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const code = (err as any).code ?? -32603;
        void this._peer?._receive({
          jsonrpc: '2.0',
          error: { code, message: err.message },
          id: msg.id,
        });
      }
      return;
    }

    if (isNotification(msg)) {
      this._notificationHandler?.(msg.method, msg.params ?? null);
      return;
    }
  }

  // ---- AcpTransport interface ----

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (this._disposed) {
      return Promise.reject(new Error('Transport disposed'));
    }

    const id = this._nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', method, id };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
      // Deliver to peer asynchronously (matches real transport behaviour)
      Promise.resolve().then(() => {
        this._peer?._receive(msg);
      });
    });
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this._notificationHandler = handler;
  }

  onRequest(handler: (method: string, params: unknown, id: string | number) => Promise<unknown>): void {
    this._requestHandler = handler;
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    // Reject all in-flight requests
    for (const [id, pending] of this._pendingRequests) {
      pending.reject(new Error('Transport disposed'));
      this._pendingRequests.delete(id);
    }
  }

  // ---- Test helpers ----

  /**
   * Simulate a notification sent from this side to the peer (i.e. peer's
   * onNotification handler is invoked).
   */
  triggerNotification(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method };
    if (params !== undefined) msg.params = params;
    // Deliver asynchronously to match real transport
    Promise.resolve().then(() => {
      this._peer?._receive(msg);
    });
  }

  /**
   * Simulate a request sent from this side to the peer.
   * Returns the peer's response (or rejects on JSON-RPC error).
   */
  triggerRequest(method: string, params?: unknown): Promise<unknown> {
    if (this._disposed) {
      return Promise.reject(new Error('Transport disposed'));
    }

    const id = this._nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', method, id };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      // Register resolution handler on THIS transport (peer sends response back to us)
      this._pendingRequests.set(id, { resolve, reject });
      Promise.resolve().then(() => {
        this._peer?._receive(msg);
      });
    });
  }
}

/**
 * Create a pair of linked in-process transports for testing.
 * Returns [clientTransport, serverTransport].
 * Messages sent from client arrive at server and vice versa.
 */
export function createLinkedTransports(): [InProcessAcpTransport, InProcessAcpTransport] {
  const client = new InProcessAcpTransport();
  const server = new InProcessAcpTransport();
  client._setPeer(server);
  server._setPeer(client);
  return [client, server];
}

// ============================================================
// Environment sanitization helpers
// ============================================================

/**
 * Prefixes of environment variables that MUST NOT be forwarded to ACP
 * subprocesses. These carry credentials for the host application's own
 * integrations and must never be visible to external agent processes.
 */
const BLOCKED_ENV_PREFIXES = [
  'ANTHROPIC_',
  'CLAUDE_',
  'AWS_',
  'OPENAI_',
  'GEMINI_',
  'GOOGLE_',
  'AZURE_',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'CRAFT_',
];

/**
 * Exact variable names that MUST NOT be forwarded regardless of prefix.
 */
const BLOCKED_ENV_EXACT = new Set([
  'BEARER_TOKEN',
  'ACCESS_TOKEN',
  'SECRET_KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PASSWD',
  'API_KEY',
]);

/**
 * Build a sanitized environment for ACP subprocesses.
 *
 * Strategy: start from an allowlist of safe system variables, then merge in
 * any explicitly configured `acpEnv` overrides. This ensures credentials
 * present in `process.env` (API keys, AWS secrets, OAuth tokens) are never
 * forwarded to an external agent process.
 *
 * Safe system variables forwarded by default:
 *   PATH, HOME, USER, LOGNAME, SHELL, LANG, LC_*, TERM, TMPDIR, TMP, TEMP,
 *   XDG_*, DISPLAY, COLORTERM, NO_COLOR, CI (non-sensitive build context).
 *
 * @param extraEnv - Per-connection overrides from `LlmConnection.acpEnv`.
 *   Keys in this map ARE forwarded as-is (operator-configured, intentional).
 */
/** @internal exported for unit testing only */
export function _buildSafeEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const safeEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // Block exact matches
    if (BLOCKED_ENV_EXACT.has(key.toUpperCase())) continue;

    // Block by prefix
    const keyUpper = key.toUpperCase();
    if (BLOCKED_ENV_PREFIXES.some(prefix => keyUpper.startsWith(prefix))) continue;

    // Block anything that looks like a credential by heuristic suffix
    if (keyUpper.endsWith('_KEY') || keyUpper.endsWith('_SECRET') || keyUpper.endsWith('_TOKEN') || keyUpper.endsWith('_PASSWORD')) continue;

    safeEnv[key] = value;
  }

  // Merge explicitly configured ACP env overrides (operator-controlled, intentional)
  if (extraEnv) {
    Object.assign(safeEnv, extraEnv);
  }

  return safeEnv;
}

// ============================================================
// StdioAcpTransport
// ============================================================

/**
 * ACP transport that communicates with a local process via stdio.
 *
 * Spawns the process using node:child_process.spawn() (not Bun.spawn —
 * Electron uses Node.js runtime). Reads newline-delimited JSON-RPC messages
 * from stdout via node:readline.
 *
 * Dispose sequence: SIGTERM → 5000 ms → SIGKILL → await exit → cleanup.
 * Guards against double-disposal with a `_disposed` flag set before the
 * first SIGTERM to prevent race conditions.
 */
export class StdioAcpTransport implements AcpTransport {
  private _disposed = false;
  private _process: ReturnType<typeof import('node:child_process').spawn> | null = null;
  private _pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private _nextId = 1;
  private _notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private _requestHandler: ((method: string, params: unknown, id: string | number) => Promise<unknown>) | null = null;
  private _exitPromise: Promise<void> | null = null;

  constructor(
    private readonly _command: string[],
    private readonly _env?: Record<string, string>,
  ) {
    this._start();
  }

  private _start(): void {
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    const { createInterface } = require('node:readline') as typeof import('node:readline');

    const [cmd, ...args] = this._command;
    if (!cmd) throw new Error('StdioAcpTransport: command must not be empty');

    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: _buildSafeEnv(this._env),
    });
    this._process = child;

    this._exitPromise = new Promise<void>(resolve => {
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        void this._receive(msg);
      } catch (_) {
        // Ignore non-JSON lines (e.g. process startup messages)
      }
    });

    child.on('exit', () => {
      if (!this._disposed) {
        // Process exited unexpectedly — reject all pending requests
        this._rejectAllPending(new Error('ACP process exited unexpectedly'));
      }
    });
  }

  private _rejectAllPending(err: Error): void {
    for (const [id, pending] of this._pendingRequests) {
      pending.reject(err);
      this._pendingRequests.delete(id);
    }
  }

  private _send(msg: JsonRpcMessage): void {
    if (this._disposed || !this._process?.stdin?.writable) return;
    try {
      this._process.stdin.write(JSON.stringify(msg) + '\n');
    } catch (_) {
      // stdin may have closed — ignore write errors after disposal
    }
  }

  private async _receive(msg: JsonRpcMessage): Promise<void> {
    if (this._disposed) return;

    if (isResponse(msg)) {
      const pending = this._pendingRequests.get(msg.id);
      if (!pending) return;
      this._pendingRequests.delete(msg.id);
      if ('error' in msg) {
        pending.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (isRequest(msg)) {
      const handler = this._requestHandler;
      if (!handler) {
        this._send({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${msg.method}` },
          id: msg.id,
        });
        return;
      }
      try {
        const result = await handler(msg.method, msg.params ?? null, msg.id);
        this._send({ jsonrpc: '2.0', result, id: msg.id });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        const code = (err as any).code ?? -32603;
        this._send({ jsonrpc: '2.0', error: { code, message: err.message }, id: msg.id });
      }
      return;
    }

    if (isNotification(msg)) {
      this._notificationHandler?.(msg.method, msg.params ?? null);
      return;
    }
  }

  // ---- AcpTransport interface ----

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (this._disposed) return Promise.reject(new Error('Transport disposed'));

    const id = this._nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', method, id };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
      this._send(msg);
    });
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this._notificationHandler = handler;
  }

  onRequest(handler: (method: string, params: unknown, id: string | number) => Promise<unknown>): void {
    this._requestHandler = handler;
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    this._rejectAllPending(new Error('Transport disposed'));

    const child = this._process;
    if (!child) return;

    const killed = child.killed || child.exitCode !== null;
    if (!killed) {
      child.kill('SIGTERM');

      const killTimeout = setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);

      await this._exitPromise;
      clearTimeout(killTimeout);
    } else {
      await this._exitPromise;
    }

    this._process = null;
  }
}

// ============================================================
// Factory function (placeholder stubs for Task 3 & 4)
// ============================================================

/**
 * Create the appropriate AcpTransport based on the connection's acpTransport field.
 * - 'stdio' → StdioAcpTransport (implemented in Task 3)
 * - 'http'  → HttpAcpTransport (implemented in Task 4)
 */
export function createAcpTransport(config: BackendConfig): AcpTransport {
  const acpConfig = config as BackendConfig & {
    acpTransport?: string;
    acpCommand?: string[];
    acpUrl?: string;
    acpEnv?: Record<string, string>;
  };

  switch (acpConfig.acpTransport) {
    case 'stdio':
      if (!acpConfig.acpCommand?.length) {
        throw new Error("acpCommand is required for stdio ACP transport");
      }
      return new StdioAcpTransport(acpConfig.acpCommand, acpConfig.acpEnv);
    case 'http':
      throw new Error('HttpAcpTransport not yet implemented (Task 4)');
    default:
      throw new Error(
        `acpTransport field is required and must be 'stdio' or 'http', got: ${String(acpConfig.acpTransport)}`
      );
  }
}
