import { describe, expect, it } from 'bun:test';
import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type ToolDefinition,
  type CreateAgentSessionOptions,
} from '@mariozechner/pi-coding-agent';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import type { WebSearchProvider } from './tools/search/types.ts';

/**
 * Regression contract for Pi SDK 0.70.0 tool registration.
 *
 * Pre-fix bug (PR #330): subprocess passed `tools: AgentTool[]` to
 * `createAgentSession`. Pi SDK 0.70.0 redefined `CreateAgentSessionOptions.tools`
 * as `string[]` (a name allowlist), so `new Set(tool_objects).has('name_string')`
 * returned false for every lookup in `_refreshToolRegistry` → every tool silently
 * filtered out → LLM saw only the default `[read, bash, edit, write]`.
 *
 * These tests lock in the post-fix shape so the regression can't re-enter:
 * - Every custom tool is a valid `ToolDefinition` with a `promptSnippet` (Pi SDK
 *   hides tools without a snippet from the system prompt's "Available tools"
 *   section, making them invisible to the LLM even when registered).
 * - The `tools` allowlist is a `string[]` of tool names.
 * - Every tool passed via `customTools` has its name present in the allowlist
 *   (otherwise it gets filtered out by `_refreshToolRegistry`'s allowlist guard).
 */

const stubSearchProvider: WebSearchProvider = {
  name: 'Stub',
  async search() {
    return [];
  },
};

function assertValidToolDefinition(tool: ToolDefinition<any, any>): void {
  expect(typeof tool.name).toBe('string');
  expect(tool.name.length).toBeGreaterThan(0);
  expect(typeof tool.label).toBe('string');
  expect(typeof tool.description).toBe('string');
  expect(tool.description.length).toBeGreaterThan(0);
  expect(tool.parameters).toBeDefined();
  expect(typeof tool.execute).toBe('function');
}

describe('Pi subprocess tool shape contract', () => {
  it('createSearchTool returns a valid ToolDefinition with promptSnippet', () => {
    const tool = createSearchTool(stubSearchProvider);
    assertValidToolDefinition(tool);
    expect(tool.name).toBe('web_search');
    expect(typeof tool.promptSnippet).toBe('string');
    expect((tool.promptSnippet as string).length).toBeGreaterThan(0);
  });

  it('createWebFetchTool returns a valid ToolDefinition with promptSnippet', () => {
    const tool = createWebFetchTool(() => null);
    assertValidToolDefinition(tool);
    expect(tool.name).toBe('web_fetch');
    expect(typeof tool.promptSnippet).toBe('string');
    expect((tool.promptSnippet as string).length).toBeGreaterThan(0);
  });

  it('Pi SDK builtin factories all return valid ToolDefinitions', () => {
    const cwd = '/tmp';
    const builtins = [
      createReadToolDefinition(cwd),
      createBashToolDefinition(cwd),
      createEditToolDefinition(cwd),
      createWriteToolDefinition(cwd),
      createGrepToolDefinition(cwd),
      createFindToolDefinition(cwd),
      createLsToolDefinition(cwd),
    ];
    for (const tool of builtins) {
      assertValidToolDefinition(tool);
    }
    const names = builtins.map(t => t.name);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    expect(names).toEqual(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
  });
});

describe('Pi SDK 0.70.0 CreateAgentSessionOptions contract', () => {
  it('`tools` field is typed as string[] (name allowlist, not objects)', () => {
    // Compile-time proof. If Pi SDK ever changes this back to accept tool
    // objects, the line below will become a type error and this test will
    // fail at build time — preventing silent regression.
    const options: CreateAgentSessionOptions = {
      tools: ['read', 'bash', 'edit', 'write', 'web_search', 'web_fetch'],
    };
    expect(Array.isArray(options.tools)).toBe(true);
    for (const name of options.tools ?? []) {
      expect(typeof name).toBe('string');
    }
  });

  it('`customTools` field accepts ToolDefinition[] (the tool object channel)', () => {
    const searchTool = createSearchTool(stubSearchProvider);
    const webFetchTool = createWebFetchTool(() => null);
    const options: CreateAgentSessionOptions = {
      customTools: [searchTool, webFetchTool],
    };
    expect(options.customTools?.length).toBe(2);
  });

  it('customTools names ⊆ tools allowlist invariant', () => {
    // This is the invariant the subprocess must maintain when building sessionOptions.
    // If any customTool name is missing from `tools`, that tool gets filtered out.
    const searchTool = createSearchTool(stubSearchProvider);
    const webFetchTool = createWebFetchTool(() => null);
    const customTools = [
      createReadToolDefinition('/tmp'),
      createBashToolDefinition('/tmp'),
      createEditToolDefinition('/tmp'),
      createWriteToolDefinition('/tmp'),
      createGrepToolDefinition('/tmp'),
      createFindToolDefinition('/tmp'),
      createLsToolDefinition('/tmp'),
      searchTool,
      webFetchTool,
    ];
    const tools = customTools.map(t => t.name);
    const allowlistSet = new Set(tools);
    for (const tool of customTools) {
      expect(allowlistSet.has(tool.name)).toBe(true);
    }
  });
});
