/**
 * Tests for _meta merging in extractToolResults.
 *
 * extractMcpMeta and mergeMetaIntoResult are private — tested through
 * extractToolResults which is the public entry point.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  ToolIndex,
  extractToolResults,
  type ToolResultBlock,
  type ContentBlock,
} from '../tool-matching'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolResultBlock(
  toolUseId: string,
  content: unknown = 'success',
  isError = false,
): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  }
}

/** Narrow an AgentEvent to a tool_result and return the result string */
function getResultStr(events: ReturnType<typeof extractToolResults>, idx = 0): string {
  const ev = events[idx]! as { type: 'tool_result'; result: string }
  expect(ev.type).toBe('tool_result')
  return ev.result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractToolResults — _meta merging', () => {
  let index: ToolIndex

  beforeEach(() => {
    index = new ToolIndex()
  })

  it('merges _meta from toolUseResultValue into MCP tool result (primary path)', () => {
    index.register('toolu_1', 'mcp__my-server__render', {})

    const blocks: ContentBlock[] = [
      makeToolResultBlock('toolu_1', [{ type: 'text', text: '{"ok":true}' }]),
    ]
    const toolUseResultValue = {
      content: [{ type: 'text', text: '{"ok":true}' }],
      _meta: { 'mcp-use/widget': { type: 'mcpApps', html: '<div>hi</div>' } },
    }

    const events = extractToolResults(blocks, 'toolu_1', toolUseResultValue, index)
    expect(events.length).toBeGreaterThanOrEqual(1)

    const resultStr = getResultStr(events)
    const parsed = JSON.parse(resultStr)
    expect(parsed._meta).toBeDefined()
    expect(parsed._meta['mcp-use/widget'].type).toBe('mcpApps')
  })

  it('does NOT merge _meta for non-MCP tools (primary path)', () => {
    index.register('toolu_2', 'Read', { file_path: '/foo' })

    const blocks: ContentBlock[] = [
      makeToolResultBlock('toolu_2', [{ type: 'text', text: 'file contents' }]),
    ]
    const toolUseResultValue = {
      content: [{ type: 'text', text: 'file contents' }],
      _meta: { 'mcp-use/widget': { type: 'mcpApps', html: '<div>hi</div>' } },
    }

    const events = extractToolResults(blocks, 'toolu_2', toolUseResultValue, index)
    expect(events.length).toBeGreaterThanOrEqual(1)

    const resultStr = getResultStr(events)
    // _meta should NOT be present because tool name doesn't start with mcp__
    expect(resultStr).not.toContain('mcp-use/widget')
  })

  it('merges _meta in the fallback path (no content blocks, MCP tool)', () => {
    index.register('toolu_3', 'mcp__server__tool', {})

    // toolUseResultValue WITHOUT _meta at the top level — _meta is extracted
    // separately by extractMcpMeta and merged back in by mergeMetaIntoResult.
    // Use a simple string content so the original serialization won't contain _meta.
    const toolUseResultValue = {
      content: [{ type: 'text', text: 'hello' }],
      _meta: { 'mcp-use/widget': { type: 'mcpApps', html: '<b>bold</b>' } },
    }

    // Empty content blocks → fallback path
    const events = extractToolResults([], 'toolu_3', toolUseResultValue, index)
    expect(events.length).toBeGreaterThanOrEqual(1)

    const resultStr = getResultStr(events)
    const parsed = JSON.parse(resultStr)
    // _meta should be merged back in for MCP tools
    expect(parsed._meta).toBeDefined()
    expect(parsed._meta['mcp-use/widget'].html).toBe('<b>bold</b>')
  })

  it('does NOT double-merge _meta in fallback path for non-MCP tools', () => {
    // For non-MCP tools in the fallback path, the serialized toolUseResultValue
    // will naturally contain _meta (since we serialize the whole object), but
    // mergeMetaIntoResult should NOT be called, meaning no double-merging occurs.
    index.register('toolu_4', 'Bash', { command: 'ls' })

    // Use a toolUseResultValue where _meta has a distinctive marker
    const toolUseResultValue = {
      output: 'some output',
      _meta: { 'mcp-use/widget': { type: 'mcpApps', html: '<div/>' } },
    }

    const events = extractToolResults([], 'toolu_4', toolUseResultValue, index)
    expect(events.length).toBeGreaterThanOrEqual(1)

    const resultStr = getResultStr(events)
    const parsed = JSON.parse(resultStr)

    // The original _meta is present because the entire object was serialized,
    // but mergeMetaIntoResult was NOT called (non-MCP tool) so the structure
    // should match the original object exactly — no wrapping or duplication.
    expect(parsed.output).toBe('some output')
    expect(parsed._meta).toEqual({ 'mcp-use/widget': { type: 'mcpApps', html: '<div/>' } })
  })

  it('does not add _meta when toolUseResultValue has no _meta', () => {
    index.register('toolu_5', 'mcp__server__tool', {})

    const blocks: ContentBlock[] = [
      makeToolResultBlock('toolu_5', [{ type: 'text', text: 'plain result' }]),
    ]
    const toolUseResultValue = {
      content: [{ type: 'text', text: 'plain result' }],
    }

    const events = extractToolResults(blocks, 'toolu_5', toolUseResultValue, index)
    const resultStr = getResultStr(events)
    expect(resultStr).not.toContain('_meta')
  })

  it('merges _meta for MCP tool but not for non-MCP tool in same message', () => {
    index.register('toolu_mcp', 'mcp__server__render', {})
    index.register('toolu_read', 'Read', { file_path: '/x' })

    const blocks: ContentBlock[] = [
      makeToolResultBlock('toolu_mcp', [{ type: 'text', text: 'widget result' }]),
      makeToolResultBlock('toolu_read', [{ type: 'text', text: 'file data' }]),
    ]
    const toolUseResultValue = {
      content: [],
      _meta: { 'mcp-use/widget': { type: 'mcpApps', html: '<div>w</div>' } },
    }

    const events = extractToolResults(blocks, null, toolUseResultValue, index)
    const toolResults = events.filter(e => e.type === 'tool_result')
    expect(toolResults).toHaveLength(2)

    // MCP tool should have _meta merged
    const mcpResult = (toolResults.find(e =>
      (e as { toolUseId: string }).toolUseId === 'toolu_mcp'
    )! as { result: string }).result
    expect(mcpResult).toContain('mcp-use/widget')

    // Non-MCP tool should NOT have _meta
    const readResult = (toolResults.find(e =>
      (e as { toolUseId: string }).toolUseId === 'toolu_read'
    )! as { result: string }).result
    expect(readResult).not.toContain('mcp-use/widget')
  })
})
