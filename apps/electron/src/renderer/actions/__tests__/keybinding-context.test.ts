import { afterEach, describe, expect, it } from 'bun:test'
import { setDismissibleLayerBridge } from '../../lib/dismissible-layer-bridge'
import { getKeybindingContext, snapshotKeybindingContext, setCurrentZone } from '../keybinding-context'

const originalDocument = globalThis.document

afterEach(() => {
  setDismissibleLayerBridge(null)
  ;(globalThis as unknown as { document: Document | undefined }).document = originalDocument
})

describe('getKeybindingContext', () => {
  it('sets menuOpen=true when dismissible stack has open layers', () => {
    setDismissibleLayerBridge({
      registerLayer: () => () => {},
      hasOpenLayers: () => true,
      getTopLayer: () => ({ id: 'island-1', type: 'island', priority: 200 }),
      closeTop: () => true,
      handleEscape: () => true,
    })

    ;(globalThis as unknown as { document: { querySelector: (_selector: string) => null } }).document = {
      querySelector: () => null,
    }

    const event = {
      target: { tagName: 'DIV', isContentEditable: false },
    } as unknown as KeyboardEvent

    const context = getKeybindingContext(event)
    expect(context.menuOpen).toBe(true)
  })

  it('sets menuOpen=true when island dialog overlay is open', () => {
    ;(globalThis as unknown as { document: { querySelector: (selector: string) => object | null } }).document = {
      querySelector: (selector: string) => {
        if (selector.includes('[data-ca-island-dialog="true"][data-state="open"]')) {
          return {}
        }

        return null
      },
    }

    const event = {
      target: { tagName: 'DIV', isContentEditable: false },
    } as unknown as KeyboardEvent

    const context = getKeybindingContext(event)
    expect(context.menuOpen).toBe(true)
  })

  it('sets menuOpen=false when no overlay is open', () => {
    ;(globalThis as unknown as { document: { querySelector: (_selector: string) => null } }).document = {
      querySelector: () => null,
    }

    const event = {
      target: { tagName: 'DIV', isContentEditable: false },
    } as unknown as KeyboardEvent

    const context = getKeybindingContext(event)
    expect(context.menuOpen).toBe(false)
  })
})

describe('snapshotKeybindingContext', () => {
  afterEach(() => {
    setCurrentZone('chat')
  })

  it('reads zone flags from setCurrentZone without a KeyboardEvent', () => {
    ;(globalThis as unknown as { document: { activeElement: null; querySelector: () => null } }).document = {
      activeElement: null,
      querySelector: () => null,
    }
    setCurrentZone('navigator')
    const ctx = snapshotKeybindingContext()
    expect(ctx.navigatorFocus).toBe(true)
    expect(ctx.chatFocus).toBe(false)
    expect(ctx.sidebarFocus).toBe(false)
    expect(ctx.inputFocus).toBe(false)
    expect(ctx.menuOpen).toBe(false)
  })

  it('detects inputFocus from document.activeElement', () => {
    ;(globalThis as unknown as {
      document: { activeElement: { tagName: string; isContentEditable: boolean }; querySelector: () => null }
    }).document = {
      activeElement: { tagName: 'INPUT', isContentEditable: false },
      querySelector: () => null,
    }
    const ctx = snapshotKeybindingContext()
    expect(ctx.inputFocus).toBe(true)
  })

  it('sets menuOpen from overlay detection', () => {
    setDismissibleLayerBridge({
      registerLayer: () => () => {},
      hasOpenLayers: () => true,
      getTopLayer: () => ({ id: 'island-1', type: 'island', priority: 200 }),
      closeTop: () => true,
      handleEscape: () => true,
    })
    ;(globalThis as unknown as { document: { activeElement: null; querySelector: () => null } }).document = {
      activeElement: null,
      querySelector: () => null,
    }
    expect(snapshotKeybindingContext().menuOpen).toBe(true)
  })
})
