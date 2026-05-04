#!/usr/bin/env bun
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const execFileAsync = promisify(execFile);
const FIELD_THEORY_BIN = process.env.FIELD_THEORY_BIN || 'ft';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2_000_000;

type JsonObject = Record<string, unknown>;

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function toPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function runFt(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(FIELD_THEORY_BIN, args, {
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: process.env,
  });

  const trimmed = stdout.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
}

function args(request: unknown): JsonObject {
  return ((request as { params?: { arguments?: JsonObject } }).params?.arguments ?? {}) as JsonObject;
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

const tools: Tool[] = [
  {
    name: 'field_theory_status',
    description: 'Show Field Theory bookmark/library status and local data paths.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'field_theory_stats',
    description: 'Summarize the local X/Twitter bookmark archive: counts, authors, date range, and language mix.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'field_theory_search_bookmarks',
    description: 'Search local X/Twitter bookmarks with Field Theory BM25 search. Use for saved tweets, X bookmarks, and user reading-history context.',
    inputSchema: objectSchema({
      query: { type: 'string', description: 'Search query. Supports normal Field Theory search syntax.' },
      limit: { type: 'number', description: 'Maximum results to return. Default 10, max 50.' },
    }, ['query']),
  },
  {
    name: 'field_theory_list_bookmarks',
    description: 'List local X/Twitter bookmarks filtered by author, category, domain, folder, or date range.',
    inputSchema: objectSchema({
      limit: { type: 'number', description: 'Maximum results to return. Default 10, max 50.' },
      author: { type: 'string', description: 'Author handle, with or without @.' },
      category: { type: 'string', description: 'Bookmark category filter.' },
      domain: { type: 'string', description: 'Subject domain filter.' },
      folder: { type: 'string', description: 'X bookmark folder name.' },
      after: { type: 'string', description: 'Only bookmarks after YYYY-MM-DD.' },
      before: { type: 'string', description: 'Only bookmarks before YYYY-MM-DD.' },
    }),
  },
  {
    name: 'field_theory_show_bookmark',
    description: 'Show one bookmark in detail by its Field Theory/X tweet id.',
    inputSchema: objectSchema({
      id: { type: 'string', description: 'Bookmark or tweet id.' },
    }, ['id']),
  },
  {
    name: 'field_theory_search_library',
    description: 'Search local Field Theory Library markdown notes.',
    inputSchema: objectSchema({
      query: { type: 'string' },
      limit: { type: 'number', description: 'Maximum results to return. Default 10, max 50.' },
    }, ['query']),
  },
  {
    name: 'field_theory_show_library_page',
    description: 'Show one Field Theory Library page by path.',
    inputSchema: objectSchema({
      path: { type: 'string', description: 'Library page path.' },
    }, ['path']),
  },
  {
    name: 'field_theory_list_commands',
    description: 'List local Field Theory portable commands.',
    inputSchema: objectSchema({}),
  },
  {
    name: 'field_theory_show_command',
    description: 'Show one Field Theory portable command by name.',
    inputSchema: objectSchema({
      name: { type: 'string', description: 'Command name.' },
    }, ['name']),
  },
];

async function call(name: string, input: JsonObject): Promise<unknown> {
  switch (name) {
    case 'field_theory_status':
      return runFt(['status', '--json']);
    case 'field_theory_stats':
      return runFt(['stats', '--json']);
    case 'field_theory_search_bookmarks': {
      const query = optionalString(input.query);
      if (!query) throw new Error('query is required');
      const limit = toPositiveInteger(input.limit, 10, 50);
      return runFt(['search', query, '--limit', String(limit), '--json']);
    }
    case 'field_theory_list_bookmarks': {
      const ftArgs = ['list', '--limit', String(toPositiveInteger(input.limit, 10, 50)), '--json'];
      for (const key of ['author', 'category', 'domain', 'folder', 'after', 'before']) {
        const value = optionalString(input[key]);
        if (value) ftArgs.push(`--${key}`, value);
      }
      return runFt(ftArgs);
    }
    case 'field_theory_show_bookmark': {
      const id = optionalString(input.id);
      if (!id) throw new Error('id is required');
      return runFt(['show', id, '--json']);
    }
    case 'field_theory_search_library': {
      const query = optionalString(input.query);
      if (!query) throw new Error('query is required');
      const limit = toPositiveInteger(input.limit, 10, 50);
      return runFt(['library', 'search', query, '--limit', String(limit), '--json']);
    }
    case 'field_theory_show_library_page': {
      const path = optionalString(input.path);
      if (!path) throw new Error('path is required');
      return runFt(['library', 'show', path, '--json']);
    }
    case 'field_theory_list_commands':
      return runFt(['commands', 'list', '--json']);
    case 'field_theory_show_command': {
      const commandName = optionalString(input.name);
      if (!commandName) throw new Error('name is required');
      return runFt(['commands', 'show', commandName, '--json']);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'field-theory', version: '1.0.0' },
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
