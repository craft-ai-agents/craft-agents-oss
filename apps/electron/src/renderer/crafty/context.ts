/**
 * The header's one line about the capture: what goes along with the first question, and from
 * which app. The window title, page address and selected text are one click away (the details).
 */

import type { CraftyProvenance, CraftySelectionResult } from '../../shared/crafty'

export interface ContextSummary {
  label: string
  /** There's more to show than the label says: the text, the window or the page address. */
  expandable: boolean
}

/** The app's name once provenance arrives; until then the name selection-hook reported. */
export function sourceAppName(selection: CraftySelectionResult | null, provenance: CraftyProvenance | null): string | null {
  return provenance?.appName || selection?.selection?.programName || null
}

export function contextSummary(selection: CraftySelectionResult, provenance: CraftyProvenance | null): ContextSummary {
  const app = sourceAppName(selection, provenance)
  const captured = selection.selection
  if (captured) {
    const length = captured.text.length
    const count = `${length.toLocaleString('en-US')} ${length === 1 ? 'character' : 'characters'}`
    return { label: app ? `${count} from ${app}` : `${count} selected`, expandable: true }
  }
  if (selection.error) return { label: 'Couldn\'t read the selection', expandable: true }
  // The window title and page address still go along, so they stay one click away
  return { label: app ? `Nothing selected in ${app}` : 'Nothing selected', expandable: !!(provenance?.windowTitle || provenance?.url) }
}
