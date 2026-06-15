#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

function resolveRuntimeTempDir(): string {
  if (process.env.TMPDIR) return process.env.TMPDIR;

  if (process.platform === 'darwin') {
    try {
      const output = execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim();
      if (output) return output;
    } catch {
      // Fall through to Node's temp dir.
    }
  }

  return tmpdir();
}

const MANIFEST_PATH = join(resolveRuntimeTempDir(), 'background-computer-use', 'runtime-manifest.json');

type JsonObject = Record<string, unknown>;

function readBaseUrl(): string {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`BackgroundComputerUse is not running. Missing runtime manifest: ${MANIFEST_PATH}`);
  }

  const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { baseURL?: unknown };
  if (typeof parsed.baseURL !== 'string' || !parsed.baseURL.startsWith('http://127.0.0.1:')) {
    throw new Error('BackgroundComputerUse manifest does not contain a valid local baseURL.');
  }
  return parsed.baseURL.replace(/\/$/, '');
}

async function requestRuntime(path: string, body?: JsonObject): Promise<unknown> {
  const baseUrl = readBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep raw text for non-JSON failures.
  }

  if (!response.ok) {
    throw new Error(`BackgroundComputerUse ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: { result: payload },
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { error: message },
  };
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

const targetSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['display_index', 'node_id', 'refetch_fingerprint'] },
    value: {
      description: 'Integer for display_index; string for node_id or refetch_fingerprint.',
    },
  },
  required: ['kind', 'value'],
  additionalProperties: false,
};

const imageModeSchema = { type: 'string', enum: ['path', 'base64', 'omit'], default: 'path' };

const cursorSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    color: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
};

const tools: Tool[] = [
  {
    name: 'computer_use_status',
    description: 'Check whether the local BackgroundComputerUse macOS runtime is running and permissioned.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'computer_use_list_apps',
    description: 'List visible macOS applications that can be inspected through Accessibility.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'computer_use_list_windows',
    description: 'List windows for an app name, bundle ID, or target query, for example Chrome, Safari, or com.apple.finder.',
    inputSchema: objectSchema({
      app: { type: 'string', description: 'App name, bundle ID, or target query.' },
    }, ['app']),
  },
  {
    name: 'computer_use_observe_window',
    description: 'Read a window state and capture a screenshot path. Use before any click/type action.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      imageMode: imageModeSchema,
      maxNodes: { type: 'number', default: 6500 },
      includeMenuBar: { type: 'boolean' },
      menuPath: { type: 'array', items: { type: 'string' } },
      debug: { type: 'boolean', default: false },
    }, ['window']),
  },
  {
    name: 'computer_use_click',
    description: 'Click in a window by target or coordinates. Only use after observe_window confirms the intended target; ask the user before risky actions like submit, purchase, delete, send, or irreversible navigation.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      stateToken: { type: 'string', description: 'State token from the observed window state.' },
      target: targetSchema,
      x: { type: 'number' },
      y: { type: 'number' },
      mode: { type: 'string', enum: ['primary', 'secondary'] },
      clickCount: { type: 'number', default: 1 },
      mouseButton: { type: 'string', enum: ['left', 'right', 'middle'] },
      imageMode: imageModeSchema,
      cursor: cursorSchema,
      includeMenuBar: { type: 'boolean' },
      maxNodes: { type: 'number' },
      debug: { type: 'boolean', default: false },
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'intent']),
  },
  {
    name: 'computer_use_perform_secondary_action',
    description: 'Invoke an exposed secondary action label from an observed node, such as Close or Show Menu. Use only after observe_window shows that exact action on the target.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      stateToken: { type: 'string' },
      target: targetSchema,
      action: { type: 'string', description: 'Exact public label from the target node secondaryActions array.' },
      actionID: { type: 'string' },
      menuPath: { type: 'array', items: { type: 'string' } },
      cursor: cursorSchema,
      includeMenuBar: { type: 'boolean' },
      maxNodes: { type: 'number' },
      imageMode: imageModeSchema,
      debug: { type: 'boolean', default: false },
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'target', 'action', 'intent']),
  },
  {
    name: 'computer_use_type_text',
    description: 'Type text into a focused or targeted control. Use after observe_window confirms the field; ask the user before sending credentials, payments, public posts, or destructive commands.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      stateToken: { type: 'string' },
      target: targetSchema,
      text: { type: 'string' },
      focusAssistMode: { type: 'string', enum: ['none', 'focus', 'focus_and_caret_end'], default: 'focus_and_caret_end' },
      imageMode: imageModeSchema,
      cursor: cursorSchema,
      includeMenuBar: { type: 'boolean' },
      maxNodes: { type: 'number' },
      debug: { type: 'boolean', default: false },
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'text', 'intent']),
  },
  {
    name: 'computer_use_set_value',
    description: 'Set a supported value directly on a semantic target. Prefer this for fields that expose value-set support; it does not submit or press Return.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      stateToken: { type: 'string' },
      target: targetSchema,
      value: { type: 'string' },
      imageMode: imageModeSchema,
      cursor: cursorSchema,
      includeMenuBar: { type: 'boolean' },
      maxNodes: { type: 'number' },
      debug: { type: 'boolean', default: false },
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'target', 'value', 'intent']),
  },
  {
    name: 'computer_use_press_key',
    description: 'Press a key or shortcut in a window, for example Escape, Tab, Return, or command+f. Use after observe_window confirms focus; ask the user before Return on risky forms.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      stateToken: { type: 'string' },
      key: { type: 'string', description: 'Key name or chord, for example Return, Escape, Tab, a, or command+f.' },
      imageMode: imageModeSchema,
      cursor: cursorSchema,
      includeMenuBar: { type: 'boolean' },
      maxNodes: { type: 'number' },
      debug: { type: 'boolean', default: false },
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'key', 'intent']),
  },
  {
    name: 'computer_use_scroll',
    description: 'Scroll a semantic target in a window. Prefer this over drag for normal page/document movement.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      stateToken: { type: 'string' },
      target: targetSchema,
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      pages: { type: 'number' },
      verificationMode: { type: 'string', enum: ['strict', 'fast'] },
      imageMode: imageModeSchema,
      cursor: cursorSchema,
      includeMenuBar: { type: 'boolean' },
      maxNodes: { type: 'number' },
      debug: { type: 'boolean', default: false },
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'target', 'direction', 'intent']),
  },
  {
    name: 'computer_use_set_window_frame',
    description: 'Set a window frame directly. Prefer this over drag/resize for deterministic window layout.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      animate: { type: 'boolean', default: true },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'x', 'y', 'width', 'height', 'intent']),
  },
  {
    name: 'computer_use_drag',
    description: 'Drag a window or drag-capable target to a screen coordinate. Prefer set_window_frame for deterministic window layout.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      toX: { type: 'number' },
      toY: { type: 'number' },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'toX', 'toY', 'intent']),
  },
  {
    name: 'computer_use_resize',
    description: 'Resize a window by dragging a named edge or corner handle. Prefer set_window_frame for deterministic window layout.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      handle: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'] },
      toX: { type: 'number' },
      toY: { type: 'number' },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'handle', 'toX', 'toY', 'intent']),
  },
];

function args(request: unknown): JsonObject {
  return ((request as { params?: { arguments?: JsonObject } }).params?.arguments ?? {}) as JsonObject;
}

async function call(name: string, input: JsonObject): Promise<unknown> {
  switch (name) {
    case 'computer_use_status': {
      const [health, bootstrap] = await Promise.all([
        requestRuntime('/health'),
        requestRuntime('/v1/bootstrap'),
      ]);
      return { manifestPath: MANIFEST_PATH, health, bootstrap };
    }
    case 'computer_use_list_apps':
      return requestRuntime('/v1/list_apps', {});
    case 'computer_use_list_windows':
      return requestRuntime('/v1/list_windows', input);
    case 'computer_use_observe_window':
      return requestRuntime('/v1/get_window_state', { imageMode: 'path', maxNodes: 6500, ...input });
    case 'computer_use_click':
      return requestRuntime('/v1/click', { imageMode: 'path', ...input });
    case 'computer_use_perform_secondary_action':
      return requestRuntime('/v1/perform_secondary_action', { imageMode: 'path', ...input });
    case 'computer_use_type_text':
      return requestRuntime('/v1/type_text', { imageMode: 'path', focusAssistMode: 'focus_and_caret_end', ...input });
    case 'computer_use_set_value':
      return requestRuntime('/v1/set_value', { imageMode: 'path', ...input });
    case 'computer_use_press_key':
      return requestRuntime('/v1/press_key', { imageMode: 'path', ...input });
    case 'computer_use_scroll':
      return requestRuntime('/v1/scroll', { imageMode: 'path', ...input });
    case 'computer_use_set_window_frame':
      return requestRuntime('/v1/set_window_frame', input);
    case 'computer_use_drag':
      return requestRuntime('/v1/drag', input);
    case 'computer_use_resize':
      return requestRuntime('/v1/resize', input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'background-computer-use', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return ok(await call(request.params.name, args(request)));
  } catch (error) {
    return fail(error);
  }
});

await server.connect(new StdioServerTransport());
