import { describe, it, expect, beforeEach } from 'bun:test'
import { createStore } from 'jotai'
import { omniboxOpenAtom } from '@/atoms/omnibox'
import { createCommandRegistry, type CommandContribution } from '@craft-agent/core/platform'
import { parsePrefix, scoreMatch } from '../omnibox-helpers'
import { actions } from '@/actions/definitions'

/**
 * Logic-level omnibox tests (no DOM):
 * - open/close atom
 * - command filtering mirrors Omnibox.tsx action section
 * - app.omnibox action is registered with mod+k
 */

/** Mirrors Omnibox.tsx keysForWhen: underlying surface, not palette input. */
function keysForPaletteQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputFocus: false,
    menuOpen: false,
    omniboxOpen: true,
    chatFocus: false,
    navigatorFocus: false,
    sidebarFocus: false,
    hasSelection: false,
    ...overrides,
  }
}

function filterCommands(
  registry: ReturnType<typeof createCommandRegistry>,
  input: string,
  keys: Record<string, unknown> = keysForPaletteQuery(),
): CommandContribution[] {
  const { prefix, query } = parsePrefix(input)
  if (prefix !== '' && prefix !== '>') return []
  const text = query
  const list = registry.query({ text: text.trim() || undefined }, keys)
  if (!text.trim()) return list
  return list
    .map((c) => ({
      c,
      s: Math.max(
        scoreMatch(c.title, text),
        scoreMatch(c.category, text),
        ...(c.keywords ?? []).map((k) => scoreMatch(k, text)),
      ),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)
}

describe('omniboxOpenAtom', () => {
  it('defaults to closed and toggles open/close', () => {
    const store = createStore()
    expect(store.get(omniboxOpenAtom)).toBe(false)
    store.set(omniboxOpenAtom, true)
    expect(store.get(omniboxOpenAtom)).toBe(true)
    store.set(omniboxOpenAtom, false)
    expect(store.get(omniboxOpenAtom)).toBe(false)
  })
})

describe('app.omnibox action definition', () => {
  it('is registered with mod+k and General category', () => {
    expect(actions['app.omnibox']).toBeDefined()
    expect(actions['app.omnibox'].defaultHotkey).toBe('mod+k')
    expect(actions['app.omnibox'].category).toBe('General')
    expect(actions['app.omnibox'].label).toBe('Command Palette')
  })

  it('does not collide with app.search hotkey', () => {
    expect(actions['app.search'].defaultHotkey).toBe('mod+f')
    expect(actions['app.search'].defaultHotkey).not.toBe(actions['app.omnibox'].defaultHotkey)
  })
})

describe('omnibox command filter logic', () => {
  let registry: ReturnType<typeof createCommandRegistry>

  beforeEach(() => {
    registry = createCommandRegistry()
    for (const def of Object.values(actions)) {
      const action = def as {
        id: string
        label: string
        category: string
        description?: string
        defaultHotkey: string | null
      }
      registry.register({
        id: action.id,
        title: action.label,
        category: action.category,
        source: 'craft',
        keywords: action.description ? [action.description] : undefined,
        defaultHotkey: action.defaultHotkey ?? undefined,
        execute: async () => {},
      })
    }
    registry.register({
      id: 'knowledge.openHome',
      title: 'Open Knowledge',
      category: 'Knowledge',
      source: 'craft',
      keywords: ['knowledge', 'siyuan'],
      execute: async () => {},
    })
    registry.register({
      id: 'knowledge.openCompat',
      title: 'Open SiYuan compatibility view',
      category: 'Knowledge',
      source: 'craft',
      keywords: ['knowledge', 'siyuan', 'compat'],
      execute: async () => {},
    })
    registry.register({
      id: 'siyuan.openCompat',
      title: 'Open SiYuan compatibility view',
      category: 'Knowledge',
      source: 'craft',
      keywords: ['siyuan', 'compat'],
      execute: async () => {},
    })
  })

  it('empty query returns craft actions including omnibox', () => {
    const hits = filterCommands(registry, '')
    expect(hits.some((c) => c.id === 'app.omnibox')).toBe(true)
    expect(hits.some((c) => c.id === 'app.newChat')).toBe(true)
  })

  it('typing filters craft actions by title', () => {
    const hits = filterCommands(registry, 'palette')
    expect(hits.some((c) => c.id === 'app.omnibox')).toBe(true)
    expect(hits.every((c) => /palette|command/i.test(c.title) || c.keywords?.some((k) => /palette|command/i.test(k)))).toBe(true)
  })

  it('> prefix shows only commands (same list path, no resources)', () => {
    const hits = filterCommands(registry, '>settings')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((c) => c.source === 'craft' || c.id.startsWith('knowledge.'))).toBe(true)
    expect(hits.some((c) => /settings/i.test(c.title))).toBe(true)
  })

  it('@ prefix suppresses action section', () => {
    expect(filterCommands(registry, '@memory')).toEqual([])
  })

  it('/ prefix suppresses action section', () => {
    expect(filterCommands(registry, '/skill')).toEqual([])
  })

  it('registers knowledge.openCompat and siyuan.openCompat alias', () => {
    expect(registry.get('knowledge.openCompat')?.title).toBe('Open SiYuan compatibility view')
    expect(registry.get('siyuan.openCompat')?.title).toBe('Open SiYuan compatibility view')
    expect(registry.get('knowledge.openCompat')?.source).toBe('craft')
    expect(registry.get('siyuan.openCompat')?.source).toBe('craft')
  })

  it('filters openCompat by compat query', () => {
    const hits = filterCommands(registry, 'compat')
    expect(hits.some((c) => c.id === 'knowledge.openCompat')).toBe(true)
    expect(hits.some((c) => c.id === 'siyuan.openCompat')).toBe(true)
  })
})

describe('omnibox when-clause keys (live surface context)', () => {
  it('shows navigator-scoped command when navigatorFocus is true', () => {
    const registry = createCommandRegistry()
    registry.register({
      id: 'nav.scoped',
      title: 'Navigator Only',
      category: 'Navigation',
      source: 'craft',
      when: 'navigatorFocus',
      execute: async () => {},
    })
    registry.register({
      id: 'always',
      title: 'Always',
      category: 'General',
      source: 'craft',
      execute: async () => {},
    })

    const hidden = filterCommands(registry, '', keysForPaletteQuery({ navigatorFocus: false }))
    expect(hidden.some((c) => c.id === 'nav.scoped')).toBe(false)
    expect(hidden.some((c) => c.id === 'always')).toBe(true)

    const shown = filterCommands(registry, '', keysForPaletteQuery({ navigatorFocus: true }))
    expect(shown.some((c) => c.id === 'nav.scoped')).toBe(true)
  })

  it('does not hide !inputFocus commands while palette input would be focused', () => {
    const registry = createCommandRegistry()
    registry.register({
      id: 'surface.cmd',
      title: 'Surface Command',
      category: 'General',
      source: 'craft',
      when: '!inputFocus',
      execute: async () => {},
    })

    // keysForPaletteQuery forces inputFocus:false even if real palette input has focus
    const hits = filterCommands(registry, '', keysForPaletteQuery({ inputFocus: false }))
    expect(hits.some((c) => c.id === 'surface.cmd')).toBe(true)

    // Contrast: if we incorrectly passed palette inputFocus=true, command would hide
    const wrong = registry.query({}, { inputFocus: true, omniboxOpen: true })
    expect(wrong.some((c) => c.id === 'surface.cmd')).toBe(false)
  })
})

describe('onOmniboxOpen host bridge contract', () => {
  it('opens omnibox atom when main IPC callback fires (mirrors OmniboxHost)', () => {
    const store = createStore()
    expect(store.get(omniboxOpenAtom)).toBe(false)

    // Mirrors OmniboxHost: onOmniboxOpen(() => setOpen(true))
    const openFromMain = () => {
      store.set(omniboxOpenAtom, true)
    }
    openFromMain()
    expect(store.get(omniboxOpenAtom)).toBe(true)
  })

  it('app.omnibox toggle still flips open state independently', () => {
    const store = createStore()
    // toggle path used by useAction('app.omnibox')
    const toggle = () => {
      store.set(omniboxOpenAtom, (v) => !v)
    }
    toggle()
    expect(store.get(omniboxOpenAtom)).toBe(true)
    toggle()
    expect(store.get(omniboxOpenAtom)).toBe(false)
  })
})
