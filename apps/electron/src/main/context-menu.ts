import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/** The parts of Electron's `ContextMenuParams` the menu reads. */
export type ContextMenuInput = Pick<
  ContextMenuParams,
  'x' | 'y' | 'misspelledWord' | 'dictionarySuggestions' | 'linkURL' | 'isEditable' | 'editFlags'
>

export interface ContextMenuDeps {
  t: (key: string) => string
  replaceMisspelling: (suggestion: string) => void
  learnSpelling: (word: string) => void
  copyText: (text: string) => void
  /** Dev builds only. */
  inspectElement?: (x: number, y: number) => void
}

/** Links worth copying; app-internal URLs (file:, the dev server) are not. */
const COPYABLE_LINK = /^(https?|mailto):/i

/**
 * Right-click menu for app windows, in sections: spelling suggestions, Learn Spelling, Copy Link,
 * edit actions, and Inspect Element in dev builds. Returns [] when nothing applies, so the caller
 * shows no menu. Spelling rows appear only when the input's spell check (Settings → Input) flagged
 * the word. Edit actions are Electron roles, so they act on the focused field like the Edit menu.
 * Outside text fields only Copy appears, and only for a selection: Select All there would select
 * the whole app.
 */
export function buildContextMenuTemplate(
  params: ContextMenuInput,
  deps: ContextMenuDeps,
): MenuItemConstructorOptions[] {
  const sections: MenuItemConstructorOptions[][] = []

  const misspelled = params.misspelledWord.trim()
  if (misspelled) {
    if (params.dictionarySuggestions.length > 0) {
      sections.push(params.dictionarySuggestions.map(suggestion => ({
        label: suggestion,
        click: () => deps.replaceMisspelling(suggestion),
      })))
    }
    sections.push([{ label: deps.t('menu.learnSpelling'), click: () => deps.learnSpelling(misspelled) }])
  }

  if (COPYABLE_LINK.test(params.linkURL)) {
    sections.push([{ label: deps.t('menu.copyLink'), click: () => deps.copyText(params.linkURL) }])
  }

  const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags
  if (params.isEditable) {
    sections.push([
      { role: 'cut', label: deps.t('menu.cut'), enabled: canCut },
      { role: 'copy', label: deps.t('menu.copy'), enabled: canCopy },
      { role: 'paste', label: deps.t('menu.paste'), enabled: canPaste },
      { role: 'selectAll', label: deps.t('menu.selectAll'), enabled: canSelectAll },
    ])
  } else if (canCopy) {
    sections.push([{ role: 'copy', label: deps.t('menu.copy') }])
  }

  if (deps.inspectElement) {
    const inspect = deps.inspectElement
    sections.push([{ label: 'Inspect Element', click: () => inspect(params.x, params.y) }])
  }

  return sections.flatMap((section, i) =>
    i === 0 ? section : [{ type: 'separator' as const }, ...section])
}
