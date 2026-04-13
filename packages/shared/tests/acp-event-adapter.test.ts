/**
 * Task 5: AcpEventAdapter
 *
 * Verifies all 10 mapping rules from execution-brief section "AcpEventAdapter 映射规则".
 */
import { describe, it, expect } from 'bun:test'
import { AcpEventAdapter } from '../src/agent/acp-event-adapter'

// Helper: call adapt and collect events
function adapt(update: unknown) {
  return AcpEventAdapter.adapt(update as any)
}

// ============================================================
// Rule 1: content.type === 'text', is_final !== true → text_delta
// ============================================================

describe('AcpEventAdapter — text (streaming)', () => {
  it("content.type='text' without is_final → text_delta", () => {
    const events = adapt({
      status: 'running',
      content: [{ type: 'text', text: 'Hello ' }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('text_delta')
    expect((events[0] as any).text).toBe('Hello ')
  })

  it("content.type='text' with is_final=false → text_delta", () => {
    const events = adapt({
      status: 'running',
      content: [{ type: 'text', text: 'part', is_final: false }],
    })
    expect(events[0]!.type).toBe('text_delta')
  })
})

// ============================================================
// Rule 2: content.type === 'text', is_final === true → text_complete
// ============================================================

describe('AcpEventAdapter — text (final)', () => {
  it("content.type='text' with is_final=true → text_complete", () => {
    const events = adapt({
      status: 'running',
      content: [{ type: 'text', text: 'Full answer.', is_final: true }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('text_complete')
    expect((events[0] as any).text).toBe('Full answer.')
  })
})

// ============================================================
// Rule 3: content.type === 'tool_call' without result → tool_start
// ============================================================

describe('AcpEventAdapter — tool_call (start)', () => {
  it("tool_call without result → tool_start", () => {
    const events = adapt({
      status: 'running',
      content: [{
        type: 'tool_call',
        id: 'tc-001',
        name: 'ReadFile',
        input: { path: '/foo' },
      }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('tool_start')
    const e = events[0] as any
    expect(e.toolName).toBe('ReadFile')
    expect(e.toolUseId).toBe('tc-001')
    expect(e.input).toEqual({ path: '/foo' })
  })
})

// ============================================================
// Rule 4: content.type === 'tool_call' with result field → tool_result
// ============================================================

describe('AcpEventAdapter — tool_call (inline result)', () => {
  it("tool_call with result → tool_result", () => {
    const events = adapt({
      status: 'running',
      content: [{
        type: 'tool_call',
        id: 'tc-002',
        name: 'ReadFile',
        input: {},
        result: 'file contents here',
      }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('tool_result')
    const e = events[0] as any
    expect(e.toolUseId).toBe('tc-002')
    expect(e.result).toBe('file contents here')
    expect(e.isError).toBe(false)
  })

  it("tool_call with result and is_error=true → tool_result isError=true", () => {
    const events = adapt({
      status: 'running',
      content: [{
        type: 'tool_call',
        id: 'tc-003',
        name: 'WriteFile',
        input: {},
        result: 'permission denied',
        is_error: true,
      }],
    })
    const e = events[0] as any
    expect(e.type).toBe('tool_result')
    expect(e.isError).toBe(true)
  })
})

// ============================================================
// Rule 5: content.type === 'embedded_resource' → info
// ============================================================

describe('AcpEventAdapter — embedded_resource', () => {
  it("embedded_resource → info with '<name> (<resource_type>)'", () => {
    const events = adapt({
      status: 'running',
      content: [{
        type: 'embedded_resource',
        name: 'schema.json',
        resource_type: 'application/json',
      }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('info')
    expect((events[0] as any).message).toBe('schema.json (application/json)')
  })
})

// ============================================================
// Rule 6: content.type === 'diff' → tool_start + tool_result pair
// ============================================================

describe('AcpEventAdapter — diff', () => {
  it("diff → [tool_start(WriteFile), tool_result] pair", () => {
    const events = adapt({
      status: 'running',
      content: [{
        type: 'diff',
        path: '/src/app.ts',
        diff: '@@ -1 +1 @@\n-old\n+new',
      }],
    })
    expect(events).toHaveLength(2)
    const [start, result] = events as any[]
    expect(start.type).toBe('tool_start')
    expect(start.toolName).toBe('WriteFile')
    expect(start.input).toEqual({ path: '/src/app.ts', diff: '@@ -1 +1 @@\n-old\n+new' })
    expect(result.type).toBe('tool_result')
    expect(result.toolUseId).toBe(start.toolUseId) // same ID
    expect(result.result).toBe('Diff for /src/app.ts')
    expect(result.isError).toBe(false)
  })
})

// ============================================================
// Rule 7: unknown content.type → info with placeholder text
// ============================================================

describe('AcpEventAdapter — unknown type', () => {
  it("unknown content type → info '[ACP unknown event: <type>]'", () => {
    const events = adapt({
      status: 'running',
      content: [{ type: 'future_type', data: {} }],
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('info')
    expect((events[0] as any).message).toBe('[ACP unknown event: future_type]')
  })
})

// ============================================================
// Rule 8: status === 'completed' → complete
// ============================================================

describe('AcpEventAdapter — completed status', () => {
  it("status='completed' → complete event", () => {
    const events = adapt({ status: 'completed' })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('complete')
  })

  it("status='completed' with usage → complete event with usage", () => {
    const events = adapt({
      status: 'completed',
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    const e = events[0] as any
    expect(e.type).toBe('complete')
    expect(e.usage).toBeDefined()
  })
})

// ============================================================
// Rule 9: status === 'error' → typed_error
// ============================================================

describe('AcpEventAdapter — error status', () => {
  it("status='error' → typed_error with TypedError containing the message", () => {
    const events = adapt({
      status: 'error',
      error: { message: 'something went wrong' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('typed_error')
    // TypedError shape: { code, title, message, originalError, ... }
    // parseError may rephrase .message; the raw ACP error is in .originalError
    const e = events[0] as any
    expect(e.error).toBeDefined()
    const original: string = e.error.originalError ?? e.error.message ?? ''
    expect(original).toContain('something went wrong')
  })

  it("status='error' without error object → typed_error", () => {
    const events = adapt({ status: 'error' })
    expect(events[0]!.type).toBe('typed_error')
    expect((events[0] as any).error).toBeDefined()
  })
})

// ============================================================
// Rule 10: status === 'cancelled' → complete (no error)
// ============================================================

describe('AcpEventAdapter — cancelled status', () => {
  it("status='cancelled' → complete event (no error field)", () => {
    const events = adapt({ status: 'cancelled' })
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('complete')
    expect((events[0] as any).error).toBeUndefined()
  })
})

// ============================================================
// Multiple content items in one update
// ============================================================

describe('AcpEventAdapter — multiple content items', () => {
  it('adapts multiple content items to multiple events', () => {
    const events = adapt({
      status: 'running',
      content: [
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B', is_final: true },
      ],
    })
    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('text_delta')
    expect(events[1]!.type).toBe('text_complete')
  })
})
