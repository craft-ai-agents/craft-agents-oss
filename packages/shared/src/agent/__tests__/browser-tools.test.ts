/**
 * Tests for the browser tools factory.
 *
 * Verifies that createBrowserTools produces the expected set of tools
 * and that each tool delegates correctly to BrowserPaneFns callbacks.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { createBrowserTools, type BrowserPaneFns } from '../browser-tools'

// ============================================================================
// Mock BrowserPaneFns
// ============================================================================

function createMockFns(): BrowserPaneFns {
  return {
    openPanel: async () => ({ instanceId: 'browser-test-1' }),
    navigate: async (url: string) => ({ url: `https://${url}`, title: 'Test Page' }),
    snapshot: async () => ({
      url: 'https://example.com',
      title: 'Example',
      nodes: [
        { ref: '@e1', role: 'button', name: 'Click me' },
        { ref: '@e2', role: 'textbox', name: 'Search', value: '', focused: true },
      ],
    }),
    click: async (_ref: string) => {},
    fill: async (_ref: string, _value: string) => {},
    select: async (_ref: string, _value: string) => {},
    screenshot: async () => Buffer.from('fake-png-data'),
    scroll: async (_dir: 'up' | 'down' | 'left' | 'right', _amount?: number) => {},
    goBack: async () => {},
    goForward: async () => {},
    evaluate: async (expr: string) => eval(expr),
  }
}

// ============================================================================
// Helper: execute a tool by name
// ============================================================================

function findTool(tools: ReturnType<typeof createBrowserTools>, name: string) {
  // SDK tool objects have a .name property
  return tools.find((t: any) => t.name === name)
}

async function executeTool(tools: ReturnType<typeof createBrowserTools>, name: string, args: Record<string, unknown> = {}) {
  const t = findTool(tools, name) as any
  if (!t) throw new Error(`Tool "${name}" not found`)
  // SDK tools have an execute/handler function — use the handler directly
  return t.handler(args)
}

// ============================================================================
// Tests
// ============================================================================

describe('createBrowserTools', () => {
  let mockFns: BrowserPaneFns
  let tools: ReturnType<typeof createBrowserTools>

  beforeEach(() => {
    mockFns = createMockFns()
    tools = createBrowserTools({
      sessionId: 'test-session',
      getBrowserPaneFns: () => mockFns,
    })
  })

  it('returns exactly 11 tools', () => {
    expect(tools.length).toBe(11)
  })

  it('includes all expected tool names', () => {
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('browser_open')
    expect(names).toContain('browser_navigate')
    expect(names).toContain('browser_snapshot')
    expect(names).toContain('browser_click')
    expect(names).toContain('browser_fill')
    expect(names).toContain('browser_select')
    expect(names).toContain('browser_screenshot')
    expect(names).toContain('browser_scroll')
    expect(names).toContain('browser_back')
    expect(names).toContain('browser_forward')
    expect(names).toContain('browser_evaluate')
  })

  describe('browser_open', () => {
    it('calls fns.openPanel and returns success', async () => {
      const result = await executeTool(tools, 'browser_open')
      expect(result.content[0].text).toContain('Opened in-app browser window')
      expect(result.content[0].text).toContain('browser-test-1')
      expect(result.isError).toBeUndefined()
    })
  })

  describe('browser_navigate', () => {
    it('calls fns.navigate and returns success', async () => {
      const result = await executeTool(tools, 'browser_navigate', { url: 'example.com' })
      expect(result.content[0].text).toContain('Navigated to')
      expect(result.isError).toBeUndefined()
    })
  })

  describe('browser_snapshot', () => {
    it('formats nodes with ref/role/name', async () => {
      const result = await executeTool(tools, 'browser_snapshot')
      const text = result.content[0].text
      expect(text).toContain('@e1')
      expect(text).toContain('[button]')
      expect(text).toContain('"Click me"')
      expect(text).toContain('(focused)')
    })

    it('handles empty nodes array', async () => {
      mockFns.snapshot = async () => ({ url: 'about:blank', title: '', nodes: [] })
      const result = await executeTool(tools, 'browser_snapshot')
      expect(result.content[0].text).toContain('Elements (0)')
    })
  })

  describe('browser_screenshot', () => {
    it('returns image content block with base64', async () => {
      const result = await executeTool(tools, 'browser_screenshot')
      expect(result.content.length).toBe(2)
      // First block is text description
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Screenshot captured')
      // Second block is the image
      const imageBlock = result.content[1] as any
      expect(imageBlock.type).toBe('image')
      expect(imageBlock.mimeType).toBe('image/png')
      expect(typeof imageBlock.data).toBe('string')
    })
  })

  describe('browser_click', () => {
    it('calls fns.click with ref', async () => {
      let clickedRef = ''
      mockFns.click = async (ref) => { clickedRef = ref }
      const result = await executeTool(tools, 'browser_click', { ref: '@e1' })
      expect(clickedRef).toBe('@e1')
      expect(result.content[0].text).toContain('Clicked element @e1')
    })
  })

  describe('browser_fill', () => {
    it('calls fns.fill with ref and value', async () => {
      let filledRef = ''
      let filledValue = ''
      mockFns.fill = async (ref, value) => { filledRef = ref; filledValue = value }
      const result = await executeTool(tools, 'browser_fill', { ref: '@e2', value: 'hello' })
      expect(filledRef).toBe('@e2')
      expect(filledValue).toBe('hello')
      expect(result.content[0].text).toContain('Filled element @e2')
    })
  })

  describe('browser_evaluate', () => {
    it('JSON.stringifies object results', async () => {
      mockFns.evaluate = async () => ({ key: 'value' })
      const result = await executeTool(tools, 'browser_evaluate', { expression: '1+1' })
      expect(result.content[0].text).toContain('"key"')
      expect(result.content[0].text).toContain('"value"')
    })

    it('passes string results through', async () => {
      mockFns.evaluate = async () => 'hello world'
      const result = await executeTool(tools, 'browser_evaluate', { expression: '"hello world"' })
      expect(result.content[0].text).toBe('hello world')
    })
  })

  describe('error handling', () => {
    it('returns isError when getBrowserPaneFns returns undefined', async () => {
      const errorTools = createBrowserTools({
        sessionId: 'test',
        getBrowserPaneFns: () => undefined,
      })
      const result = await executeTool(errorTools, 'browser_navigate', { url: 'test.com' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Error')
    })

    it('catches and wraps thrown errors', async () => {
      mockFns.navigate = async () => { throw new Error('Network error') }
      const result = await executeTool(tools, 'browser_navigate', { url: 'test.com' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Network error')
    })
  })
})
