import { describe, expect, it, mock } from 'bun:test'
import type { MenuItemConstructorOptions } from 'electron'
import { buildContextMenuTemplate, type ContextMenuInput } from '../context-menu'

const editFlags = {
  canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false,
  canDelete: false, canSelectAll: false, canEditRichly: false,
}

function params(overrides: Partial<ContextMenuInput> = {}): ContextMenuInput {
  return {
    x: 12, y: 24, misspelledWord: '', dictionarySuggestions: [], linkURL: '', isEditable: false,
    ...overrides,
    editFlags: { ...editFlags, ...overrides.editFlags },
  }
}

function deps() {
  return {
    t: (key: string) => key,
    replaceMisspelling: mock((_suggestion: string) => {}),
    learnSpelling: mock((_word: string) => {}),
    copyText: mock((_text: string) => {}),
  }
}

/** Rows as `label` / `role` / `---`, so a test reads like the menu. */
function rows(template: MenuItemConstructorOptions[]): string[] {
  return template.map(item => item.type === 'separator' ? '---' : item.role ?? item.label ?? '?')
}

function click(template: MenuItemConstructorOptions[], label: string): void {
  const item = template.find(row => row.label === label)
  if (!item?.click) throw new Error(`no clickable row ${label}`)
  ;(item.click as () => void)()
}

describe('buildContextMenuTemplate', () => {
  it('offers suggestions, Learn Spelling and the edit actions for a misspelled word', () => {
    const d = deps()
    const template = buildContextMenuTemplate(params({
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'tech'],
      isEditable: true,
      editFlags: { ...editFlags, canCut: true, canCopy: true, canSelectAll: true },
    }), d)

    expect(rows(template)).toEqual(['the', 'tech', '---', 'menu.learnSpelling', '---', 'cut', 'copy', 'paste', 'selectAll'])
    expect(template.find(row => row.role === 'paste')?.enabled).toBe(false)

    click(template, 'the')
    expect(d.replaceMisspelling).toHaveBeenCalledWith('the')
    click(template, 'menu.learnSpelling')
    expect(d.learnSpelling).toHaveBeenCalledWith('teh')
  })

  it('keeps Learn Spelling when the dictionary has no suggestion', () => {
    const template = buildContextMenuTemplate(params({ misspelledWord: 'zxqv', isEditable: true }), deps())

    expect(rows(template)).toEqual(['menu.learnSpelling', '---', 'cut', 'copy', 'paste', 'selectAll'])
  })

  it('outside text fields offers only Copy, and only for a selection', () => {
    expect(buildContextMenuTemplate(params({ editFlags: { ...editFlags, canSelectAll: true } }), deps())).toEqual([])
    expect(rows(buildContextMenuTemplate(params({ editFlags: { ...editFlags, canCopy: true } }), deps()))).toEqual(['copy'])
  })

  it('copies web and mail links, not app-internal ones', () => {
    const d = deps()
    const template = buildContextMenuTemplate(params({ linkURL: 'https://example.com/a' }), d)
    expect(rows(template)).toEqual(['menu.copyLink'])
    click(template, 'menu.copyLink')
    expect(d.copyText).toHaveBeenCalledWith('https://example.com/a')

    expect(rows(buildContextMenuTemplate(params({ linkURL: 'mailto:a@b.c' }), deps()))).toEqual(['menu.copyLink'])
    expect(buildContextMenuTemplate(params({ linkURL: 'file:///etc/hosts' }), deps())).toEqual([])
  })

  it('adds Inspect Element only when the dev hook is passed', () => {
    const inspectElement = mock((_x: number, _y: number) => {})
    const template = buildContextMenuTemplate(
      params({ editFlags: { ...editFlags, canCopy: true } }),
      { ...deps(), inspectElement },
    )

    expect(rows(template)).toEqual(['copy', '---', 'Inspect Element'])
    click(template, 'Inspect Element')
    expect(inspectElement).toHaveBeenCalledWith(12, 24)
  })
})
