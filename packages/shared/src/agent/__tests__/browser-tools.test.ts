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
    screenshot: async () => ({ png: Buffer.from('fake-png-data') }),
    screenshotRegion: async () => ({ png: Buffer.from('fake-png-data') }),
    getConsoleLogs: async () => ([
      { timestamp: Date.now(), level: 'warn', message: 'Test warning' },
    ]),
    windowResize: async (args) => ({ width: args.width, height: args.height }),
    getNetworkLogs: async () => ([
      { timestamp: Date.now(), method: 'GET', url: 'https://example.com/api', status: 500, resourceType: 'xhr', ok: false },
    ]),
    waitFor: async (args) => ({ ok: true as const, kind: args.kind, elapsedMs: 123, detail: 'condition met' }),
    sendKey: async (_args) => {},
    getDownloads: async () => ([
      { id: 'dl-1', timestamp: Date.now(), url: 'https://example.com/file.pdf', filename: 'file.pdf', state: 'completed', bytesReceived: 100, totalBytes: 100, mimeType: 'application/pdf' },
    ]),
    scroll: async (_dir: 'up' | 'down' | 'left' | 'right', _amount?: number) => {},
    goBack: async () => {},
    goForward: async () => {},
    evaluate: async (expr: string) => eval(expr),
    focusWindow: async (instanceId?: string) => ({ instanceId: instanceId ?? 'browser-1', title: 'Example Domain', url: 'https://example.com' }),
    releaseControl: async () => {},
    closeWindow: async () => {},
    hideWindow: async () => {},
    listWindows: async () => ([
      {
        id: 'browser-1',
        title: 'Example Domain',
        url: 'https://example.com',
        isVisible: true,
        ownerType: 'session',
        ownerSessionId: 'test-session',
        boundSessionId: 'test-session',
        agentControlActive: true,
      },
    ]),
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

  it('returns exactly 19 tools', () => {
    expect(tools.length).toBe(19)
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
    expect(names).toContain('browser_screenshot_region')
    expect(names).toContain('browser_console')
    expect(names).toContain('browser_window_resize')
    expect(names).toContain('browser_network')
    expect(names).toContain('browser_wait')
    expect(names).toContain('browser_key')
    expect(names).toContain('browser_downloads')
    expect(names).toContain('browser_scroll')
    expect(names).toContain('browser_back')
    expect(names).toContain('browser_forward')
    expect(names).toContain('browser_evaluate')
    expect(names).toContain('browser_tool')
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

    it('returns text-only error when screenshot PNG is empty', async () => {
      mockFns.screenshot = async () => ({ png: Buffer.alloc(0) })
      const result = await executeTool(tools, 'browser_screenshot')
      expect(result.isError).toBe(true)
      expect(result.content.length).toBe(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('empty image data')
    })
  })

  describe('browser_screenshot_region', () => {
    it('returns image content block with base64 for region captures', async () => {
      const result = await executeTool(tools, 'browser_screenshot_region', { x: 10, y: 20, width: 120, height: 80 })
      expect(result.content.length).toBe(2)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Region screenshot captured')
      const imageBlock = result.content[1] as any
      expect(imageBlock.type).toBe('image')
      expect(imageBlock.mimeType).toBe('image/png')
    })

    it('returns text-only error when region screenshot PNG is empty', async () => {
      mockFns.screenshotRegion = async () => ({ png: Buffer.alloc(0) })
      const result = await executeTool(tools, 'browser_screenshot_region', { x: 10, y: 20, width: 120, height: 80 })
      expect(result.isError).toBe(true)
      expect(result.content.length).toBe(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('empty image data')
    })

    it('fails fast when target mode is ambiguous', async () => {
      const result = await executeTool(tools, 'browser_screenshot_region', { ref: '@e1', selector: 'div.card' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Target mode is ambiguous')
    })

    it('fails fast when coordinate mode is incomplete', async () => {
      const result = await executeTool(tools, 'browser_screenshot_region', { x: 10, y: 20, width: 100 })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Coordinate mode requires x, y, width, and height together')
    })
  })

  describe('browser_console', () => {
    it('returns formatted console log lines', async () => {
      const result = await executeTool(tools, 'browser_console', { level: 'warn', limit: 10 })
      expect(result.content[0].text).toContain('Console entries')
      expect(result.content[0].text).toContain('[warn]')
    })
  })

  describe('browser_window_resize', () => {
    it('returns resized dimensions', async () => {
      const result = await executeTool(tools, 'browser_window_resize', { width: 1280, height: 720 })
      expect(result.content[0].text).toContain('Window resized to 1280x720')
    })
  })

  describe('browser_network', () => {
    it('returns formatted network entries', async () => {
      const result = await executeTool(tools, 'browser_network', { limit: 10, status: 'failed' })
      expect(result.content[0].text).toContain('Network entries')
      expect(result.content[0].text).toContain('https://example.com/api')
    })
  })

  describe('browser_wait', () => {
    it('returns successful wait response', async () => {
      const result = await executeTool(tools, 'browser_wait', { kind: 'network-idle', timeoutMs: 2000 })
      expect(result.content[0].text).toContain('Wait succeeded')
    })
  })

  describe('browser_key', () => {
    it('sends key input', async () => {
      const result = await executeTool(tools, 'browser_key', { key: 'Enter' })
      expect(result.content[0].text).toContain('Key sent: Enter')
    })
  })

  describe('browser_downloads', () => {
    it('returns formatted download entries', async () => {
      const result = await executeTool(tools, 'browser_downloads', { action: 'list', limit: 10 })
      expect(result.content[0].text).toContain('Downloads (')
      expect(result.content[0].text).toContain('file.pdf')
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

    it('forwards optional wait settings', async () => {
      let captured: any = null
      mockFns.click = async (ref, options) => { captured = { ref, options } }
      const result = await executeTool(tools, 'browser_click', { ref: '@e1', waitFor: 'network-idle', timeoutMs: 3000 })
      expect(captured).toEqual({ ref: '@e1', options: { waitFor: 'network-idle', timeoutMs: 3000 } })
      expect(result.content[0].text).toContain('waitFor=network-idle')
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
      expect(result.content[0].text).toContain('hello world')
    })
  })

  describe('browser_tool', () => {
    it('returns help text for --help without release hint', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: '--help' })
      expect(result.content[0].text).toContain('browser_tool command help')
      expect(result.content[0].text).toContain('navigate <url>')
      expect(result.content[0].text).toContain('focus [windowId]')
      expect(result.content[0].text).toContain('windows')
      expect(result.content[0].text).not.toContain('When you are done using the browser')
    })

    it('lists browser windows via windows command without release hint', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'windows' })
      expect(result.content[0].text).toContain('Browser windows (1):')
      expect(result.content[0].text).toContain('browser-1')
      expect(result.content[0].text).toContain('ownerType: session')
      expect(result.content[0].text).toContain('lockState: locked-session(test-session)')
      expect(result.content[0].text).toContain('availableToSession: true')
      expect(result.content[0].text).toContain('agentControlActive: true')
      expect(result.content[0].text).not.toContain('When you are done using the browser')
    })

    it('routes navigate command and appends release hint', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'navigate example.com' })
      expect(result.content[0].text).toContain('Navigated to')
      expect(result.content[0].text).toContain('When you are done using the browser')
    })

    it('routes focus command and calls focusWindow', async () => {
      let focusedId: string | undefined
      mockFns.focusWindow = async (instanceId?: string) => {
        focusedId = instanceId
        return { instanceId: instanceId ?? 'browser-1', title: 'Focused Tab', url: 'https://focused.example' }
      }

      const result = await executeTool(tools, 'browser_tool', { command: 'focus browser-1' })

      expect(focusedId).toBe('browser-1')
      expect(result.content[0].text).toContain('Focused browser window browser-1')
      expect(result.content[0].text).toContain('When you are done using the browser')
    })

    it('routes release command and calls releaseControl without hint', async () => {
      let released = false
      mockFns.releaseControl = async () => { released = true }

      const result = await executeTool(tools, 'browser_tool', { command: 'release' })

      expect(released).toBe(true)
      expect(result.content[0].text).toContain('Browser control released')
      expect(result.content[0].text).not.toContain('When you are done using the browser')
    })

    it('supports screenshot-region command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'screenshot-region 10 20 100 80' })
      expect(result.content[0].text).toContain('Region screenshot captured')
    })

    it('returns parse error for screenshot-region missing padding value', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'screenshot-region --ref @e12 --padding' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Missing value for --padding')
    })

    it('returns parse error for screenshot-region non-numeric coords', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'screenshot-region 10 nope 100 80' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('coordinates must be numbers')
    })

    it('supports console command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'console 10 warn' })
      expect(result.content[0].text).toContain('Console entries')
      expect(result.content[0].text).toContain('When you are done using the browser')
    })

    it('supports window-resize command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'window-resize 1024 768' })
      expect(result.content[0].text).toContain('Window resized to 1024x768')
    })

    it('supports network command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'network 10 failed' })
      expect(result.content[0].text).toContain('Network entries')
    })

    it('supports wait command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'wait network-idle 5000' })
      expect(result.content[0].text).toContain('Wait succeeded')
    })

    it('supports key command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'key Enter' })
      expect(result.content[0].text).toContain('Key sent: Enter')
    })

    it('supports downloads command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'downloads list 10' })
      expect(result.content[0].text).toContain('Downloads (')
    })

    it('supports click wait arguments', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'click @e1 network-idle 5000' })
      expect(result.content[0].text).toContain('waitFor=network-idle')
    })

    it('returns validation feedback for invalid command', async () => {
      const result = await executeTool(tools, 'browser_tool', { command: 'scroll diagonal' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('scroll requires direction')
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
