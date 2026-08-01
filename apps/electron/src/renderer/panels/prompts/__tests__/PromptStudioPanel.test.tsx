/**
 * Smoke test for PromptStudioPanel.
 *
 * Validates render → layer toggle → IPC compile call → non-empty result
 * in a headless browser environment with mocked electronAPI.
 *
 * NOTE: bun's `mock.module` is NOT hoisted like Jest's `jest.mock`, so the
 * panel must be imported via `await import(...)` AFTER the mock is
 * registered. Static imports earlier in the file are fine.
 */

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Window } from 'happy-dom'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Provider, createStore } from 'jotai'

// -------------------------------------------------------------------------
// 1. DOM setup — happy-dom provides browser globals on a single Window.
// -------------------------------------------------------------------------
const win = new Window({ url: 'http://localhost:5173', height: 900, width: 1400 })
const doc = win.document

const gs: any = globalThis
gs.window = win
gs.document = doc
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.getComputedStyle = win.getComputedStyle.bind(win)
gs.navigator = win.navigator
gs.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0)
gs.cancelAnimationFrame = (id: number) => clearTimeout(id)

// ResizeObserver stub
gs.ResizeObserver = class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe(target: Element) {
    this.cb(
      [{ contentRect: { width: 1400, height: 900 }, target } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

// Clipboard API stub (used by handleCopy) — navigator.clipboard is readonly
// in happy-dom, so we use defineProperty.
Object.defineProperty(gs.navigator, 'clipboard', {
  value: { writeText: async () => {} },
  writable: false,
  configurable: true,
})

// -------------------------------------------------------------------------
// 2. ElectronAPI mock — wire the IPC methods the panel calls.
// -------------------------------------------------------------------------

// Track compile call arguments for assertions
const compileCalls: unknown[] = []

function makeSnapshot(layerOrder: string[]) {
  return {
    id: 'prompt:' + Date.now() + ':test-hash',
    compilerVersion: 1,
    layerOrder,
    prompt: '## Execution Policy\n\n- Default mode: owner-auto\n\n**Owner Auto mode:** Execute automatically.\n\n**Ask only when:**\n- filesystem-write\n- config-write\n- memory-write\n\n## Owner Profile\n\n- Name: Owner\n- Timezone: UTC\n\n## Communication Style\n\nDirect and technical.\n\nNo relevant memories found.\n\n## Session State\n\n- Session ID: test-session\n- Permission mode: owner-auto\n- Plans folder: /tmp/test/plans\n- Data folder: /tmp/test/data',
    estimatedTokens: 68,
    layers: [
      { id: 'execution-policy', name: 'Execution Policy', version: 1, stability: 'stable', content: '## Execution Policy\n\n- Default mode: owner-auto\n\n**Owner Auto mode:** Execute automatically.' },
      { id: 'owner-identity', name: 'Owner Identity & Personality', version: 1, stability: 'stable', content: '## Owner Profile\n\n- Name: Owner' },
    ],
    compiledAt: new Date().toISOString(),
  }
}

const searchMemories = mock(async () => {
  return [
    { title: 'Project Structure', content: 'Uses Bun monorepo with workspaces.', score: 0.95, memoryId: 'm1', memoryClass: 'fact', updatedAt: Date.now() },
    { title: 'Coding Convention', content: 'TypeScript strict mode throughout.', score: 0.82, memoryId: 'm2', memoryClass: 'fact', updatedAt: Date.now() },
  ]
})

const compilePrompt = mock(async (options: unknown) => {
  compileCalls.push(options)
  const o = options as any
  const lo = o?.layerOrder ?? ['runtime-contract', 'owner-identity', 'execution-policy', 'project-context', 'skills', 'memory', 'session-state', 'capabilities']
  return { snapshot: makeSnapshot(lo), cacheInvalidated: true }
})

const getWindowMode = mock(async () => 'owner-auto')
const getHomeDir = mock(async () => '/tmp/test')
const onSessionEvent = mock((_cb: unknown) => {
  return () => {}
})

;(win as any).electronAPI = {
  searchMemories,
  compilePrompt,
  getWindowMode,
  getHomeDir,
  onSessionEvent,
}

// -------------------------------------------------------------------------
// 3. Import panel (AFTER the mock is registered).
// -------------------------------------------------------------------------
const { PromptStudioPanel } = await import('../PromptStudioPanel')
const { activeSessionIdAtom, sessionMetaMapAtom } = await import('../../../atoms/sessions')

// -------------------------------------------------------------------------
// 4. Helpers.
// -------------------------------------------------------------------------
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function renderPanel() {
  const container = doc.createElement('div') as any
  doc.body.appendChild(container)
  const root = createRoot(container)
  const store = createStore()

  // Set up initial Jotai store state — provide a session so the panel shows
  // the Live badge and session state layer gets populated.
  store.set(activeSessionIdAtom, 'test-session')

  function Wrapper() {
    return React.createElement(
      Provider,
      { store },
      React.createElement(PromptStudioPanel),
    )
  }

  await act(async () => {
    root.render(React.createElement(Wrapper))
  })

  return { container, root, store }
}

// -------------------------------------------------------------------------
// 5. Tests.
// -------------------------------------------------------------------------
describe('PromptStudioPanel smoke test', () => {
  let lastContainer: HTMLElement | null = null
  let lastRoot: Root | null = null

  beforeEach(() => {
    compileCalls.length = 0
    searchMemories.mockClear()
    compilePrompt.mockClear()
    getWindowMode.mockClear()
    getHomeDir.mockClear()
  })

  afterEach(() => {
    if (lastRoot) {
      lastRoot.unmount()
      lastRoot = null
    }
    if (lastContainer && lastContainer.parentNode) {
      lastContainer.parentNode.removeChild(lastContainer)
      lastContainer = null
    }
  })

  it('renders all 8 layer cards in the sidebar', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // The panel renders layer cards inside .ps-layer-list
    const layerCards = container.querySelectorAll('.ps-layer-card')
    expect(layerCards.length).toBe(8)
  })

  it('shows the Prompt Studio title and layer count badge', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    const titleEl = container.querySelector('.ps-sidebar__title')
    expect(titleEl).toBeTruthy()
    expect(titleEl?.textContent).toContain('Prompt Studio')
    expect(titleEl?.textContent).toContain('8')
  })

  it('uses sibling controls instead of nested buttons', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    expect(container.querySelector('button button')).toBeNull()
    const contextToggle = container.querySelector('.ps-context-pane__toggle') as HTMLButtonElement | null
    const contextReload = container.querySelector('.ps-context-pane__reload') as HTMLButtonElement | null
    expect(contextToggle?.getAttribute('aria-expanded')).toBe('false')
    expect(contextReload?.getAttribute('aria-label')).toBe('Re-scan project context files')

    await act(async () => {
      contextToggle?.click()
      await flush()
    })
    expect(contextToggle?.getAttribute('aria-expanded')).toBe('true')
  })

  it('shows owner profile pane with default values', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    const profilePane = container.querySelector('.ps-profile-pane__fields')
    expect(profilePane).toBeTruthy()

    const inputs = profilePane!.querySelectorAll('input')
    expect(inputs.length).toBeGreaterThanOrEqual(3)

    // Default name
    const nameInput = inputs[0] as unknown as HTMLInputElement
    expect(nameInput?.value).toBe('Owner')
  })

  it('toggles a layer on click — reduces active count', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // All 8 layers are enabled by default
    const toggleButtons = container.querySelectorAll('.ps-layer-card__toggle')
    expect(toggleButtons.length).toBe(8)

    // Click the first layer's toggle button to disable it
    await act(async () => {
      ;(toggleButtons[0] as unknown as HTMLButtonElement).click()
      await flush()
    })

    // The disabled class should appear on the first card
    const cards = container.querySelectorAll('.ps-layer-card')
    expect(cards[0]!.className).toContain('ps-layer-card--disabled')
    expect(cards[1]!.className).not.toContain('ps-layer-card--disabled')
  })

  it('clicking Compile calls compilePrompt IPC and shows compiled prompt', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // Wait for initial memories fetch + debounced auto-compile to settle
    await act(async () => {
      await flush()
      await flush()
      await flush()
    })

    // Find the Compile button (Zap icon in sidebar actions)
    const compileBtn = container.querySelector('.ps-sidebar__actions .ps-btn--icon')
    expect(compileBtn).toBeTruthy()

    // Click Compile
    await act(async () => {
      ;(compileBtn as unknown as HTMLButtonElement).click()
      await new Promise(r => setTimeout(r, 150))
      await flush()
    })

    // compilePrompt should have been called — mount debounce (1) + manual click (1)
    expect(compileCalls.length).toBeGreaterThanOrEqual(2)

    // The compiled prompt should now be visible in the main panel
    const promptRaw = container.querySelector('.ps-prompt__raw')
    expect(promptRaw).toBeTruthy()
    expect(promptRaw!.textContent).toBeTruthy()
    expect(promptRaw!.textContent!.length).toBeGreaterThan(50)
  })

  it('displays token count and layer count after compiling', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // Wait for mount effects
    await act(async () => {
      await flush()
      await flush()
    })

    // Click Compile
    const compileBtn = container.querySelector('.ps-sidebar__actions .ps-btn--icon')
    await act(async () => {
      ;(compileBtn as unknown as HTMLButtonElement).click()
      await new Promise(r => setTimeout(r, 150))
      await flush()
    })

    // Token count badge
    // `container` is `any` (happy-dom element), so the query result needs an
    // explicit element type before `.textContent` is reachable.
    const statBadges = Array.from(container.querySelectorAll('.ps-stat-badge')) as HTMLElement[]
    const tokenBadge = statBadges.find(b => b.textContent?.includes('tokens'))
    expect(tokenBadge).toBeTruthy()
    expect(tokenBadge!.textContent).toMatch(/[1-9]/)

    // Layer count badge
    const layerBadge = statBadges.find(b => b.textContent?.includes('layers'))
    expect(layerBadge).toBeTruthy()
  })

  it('shows Live badge when activeSessionId is set', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    const liveBadge = container.querySelector('.ps-stat-badge--live')
    expect(liveBadge).toBeTruthy()
    expect(liveBadge!.textContent).toContain('Live')
  })

  it('Disable All / Enable All buttons toggle all layers', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // Find Disable All and Enable All buttons in sidebar footer
    const footerBtns = container.querySelectorAll('.ps-sidebar__footer .ps-btn--ghost')
    expect(footerBtns.length).toBe(2)

    // Click Disable All
    await act(async () => {
      ;(footerBtns[1] as unknown as HTMLButtonElement).click()
      await flush()
    })

    // All cards should be disabled
    const cards = Array.from(container.querySelectorAll('.ps-layer-card')) as HTMLElement[]
    for (const card of cards) {
      expect(card.className).toContain('ps-layer-card--disabled')
    }

    // Click Enable All
    await act(async () => {
      ;(footerBtns[0] as unknown as HTMLButtonElement).click()
      await flush()
    })

    // All cards should be enabled again
    for (const card of cards) {
      expect(card.className).not.toContain('ps-layer-card--disabled')
    }
  })

  it('compilePrompt receives layerOrder matching enabled layers', async () => {
    const { container, root } = await renderPanel()
    lastContainer = container
    lastRoot = root

    // Wait for mount + debounced compile (150ms) to settle so its results
    // don't race with our manual compile call below.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
      await flush()
      await flush()
    })

    // Disable the first layer (runtime-contract)
    const toggleButtons = container.querySelectorAll('.ps-layer-card__toggle')
    await act(async () => {
      ;(toggleButtons[0] as unknown as HTMLButtonElement).click()
      await flush()
    })

    // Wait for debounced compile from toggle (150ms) to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
      await flush()
      await flush()
    })

    // Now click Compile — this is the third call (mount debounce + toggle debounce + manual)
    const compileBtn = container.querySelector('.ps-sidebar__actions .ps-btn--icon')
    await act(async () => {
      ;(compileBtn as unknown as HTMLButtonElement).click()
      await new Promise(r => setTimeout(r, 150))
      await flush()
    })

    // The last compile call should have a layerOrder that excludes 'runtime-contract'
    const lastCall = compileCalls[compileCalls.length - 1] as any
    expect(lastCall?.layerOrder).toBeDefined()
    // runtime-contract was disabled, so it should not be in the layerOrder
    expect(lastCall?.layerOrder).not.toContain('runtime-contract')
    // All other 7 layers should be present
    expect(lastCall?.layerOrder.length).toBe(7)
  })
})
