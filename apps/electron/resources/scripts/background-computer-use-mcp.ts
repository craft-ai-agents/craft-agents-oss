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
    kind: { type: 'string', enum: ['display_index', 'role', 'label', 'identifier'] },
    value: {},
  },
  required: ['kind', 'value'],
  additionalProperties: false,
};

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
    description: 'List windows. Pass an app name to narrow results, for example Chrome or Safari.',
    inputSchema: objectSchema({
      app: { type: 'string', description: 'Optional app name filter.' },
    }),
  },
  {
    name: 'computer_use_observe_window',
    description: 'Read a window state and capture a screenshot path. Use before any click/type action.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      imageMode: { type: 'string', enum: ['path', 'base64', 'none'], default: 'path' },
      maxNodes: { type: 'number', default: 6500 },
    }, ['window']),
  },
  {
    name: 'computer_use_click',
    description: 'Click in a window by target or coordinates. Only use after observe_window confirms the intended target; ask the user before risky actions like submit, purchase, delete, send, or irreversible navigation.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      target: targetSchema,
      x: { type: 'number' },
      y: { type: 'number' },
      clickCount: { type: 'number', default: 1 },
      imageMode: { type: 'string', enum: ['path', 'base64', 'none'], default: 'path' },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'intent']),
  },
  {
    name: 'computer_use_type_text',
    description: 'Type text into a focused or targeted control. Use after observe_window confirms the field; ask the user before sending credentials, payments, public posts, or destructive commands.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      target: targetSchema,
      text: { type: 'string' },
      focusAssistMode: { type: 'string', default: 'focus_and_caret_end' },
      imageMode: { type: 'string', enum: ['path', 'base64', 'none'], default: 'path' },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'text', 'intent']),
  },
  {
    name: 'computer_use_press_key',
    description: 'Press a keyboard key or shortcut in a window. Use after observe_window confirms focus; ask the user before Enter/Return on risky forms.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      key: { type: 'string', description: 'Key name, for example Enter, Escape, Tab, a.' },
      modifiers: {
        type: 'array',
        items: { type: 'string', enum: ['command', 'shift', 'option', 'control'] },
      },
      imageMode: { type: 'string', enum: ['path', 'base64', 'none'], default: 'path' },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'key', 'intent']),
  },
  {
    name: 'computer_use_scroll',
    description: 'Scroll a window. Prefer this over drag for normal page/document movement.',
    inputSchema: objectSchema({
      window: { type: 'string' },
      deltaX: { type: 'number', default: 0 },
      deltaY: { type: 'number' },
      x: { type: 'number' },
      y: { type: 'number' },
      imageMode: { type: 'string', enum: ['path', 'base64', 'none'], default: 'path' },
      cursor: cursorSchema,
      intent: { type: 'string', description: 'Plain-language reason for this UI action.' },
    }, ['window', 'deltaY', 'intent']),
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
    case 'computer_use_type_text':
      return requestRuntime('/v1/type_text', { imageMode: 'path', focusAssistMode: 'focus_and_caret_end', ...input });
    case 'computer_use_press_key':
      return requestRuntime('/v1/press_key', { imageMode: 'path', ...input });
    case 'computer_use_scroll':
      return requestRuntime('/v1/scroll', { imageMode: 'path', ...input });
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
