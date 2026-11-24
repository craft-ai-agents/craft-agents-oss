/**
 * Pure parts of the file-link menu (`FileLinkActionMenu`): its state, the "open outside the app"
 * action it offers for a file, and the file name + folder its header shows.
 */

import type { FileLinkClick } from '@craft-agent/ui'

/** The open file-link menu: the file it offers choices for, and the link box it opens next to. */
export interface FileLinkMenuState {
  path: string
  anchor: FileLinkClick['anchor']
}

export type FileOpenRoute =
  | { kind: 'menu'; anchor: FileLinkClick['anchor'] }
  | { kind: 'external' }
  | { kind: 'direct' }

/**
 * How a file open is handled: the menu for a file-link click, the default app (`external`) for a
 * ⌥-click, and `direct` (preview, else default app) for every other caller and when the menu is off.
 */
export function routeFileOpen(click: FileLinkClick | undefined, menuEnabled: boolean): FileOpenRoute {
  if (!click || !menuEnabled) return { kind: 'direct' }
  return click.altKey ? { kind: 'external' } : { kind: 'menu', anchor: click.anchor }
}

/**
 * HTML pages are offered as "Open in browser", other files as "Open in default app". Both open the
 * file with its default handler (`shell.openPath`), which for .html/.htm is the browser.
 */
export function opensInBrowser(path: string): boolean {
  return /\.html?$/i.test(path)
}

/** Parent folders the header spells out; the ones above them collapse into "…". */
const SHOWN_PARENT_FOLDERS = 3

/** The header's file name, and its folder with only the nearest parents spelled out. */
export function fileLinkMenuHeader(path: string): { name: string; folder: string } {
  const trimmed = path.replace(/[\\/]+$/, '') || path
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut < 0) return { name: trimmed, folder: '' }

  const name = trimmed.slice(cut + 1)
  const folder = trimmed.slice(0, cut) || trimmed[0] // "/a.html" lives in "/"
  const separator = trimmed[cut]
  const parts = folder.split(/[\\/]/)
  if (parts.length <= SHOWN_PARENT_FOLDERS + 1) return { name, folder }
  return { name, folder: `…${separator}${parts.slice(-SHOWN_PARENT_FOLDERS).join(separator)}` }
}
