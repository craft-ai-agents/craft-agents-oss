import { describe, expect, it } from 'bun:test'
import type { FileLinkClick } from '@craft-agent/ui'
import { fileLinkMenuHeader, opensInBrowser, routeFileOpen } from '../file-link-menu'

const anchor = { x: 40, y: 300, width: 220, height: 18 }
const click = (altKey = false): FileLinkClick => ({ anchor, altKey })

describe('routeFileOpen', () => {
  it('opens the menu next to a clicked file link', () => {
    expect(routeFileOpen(click(), true)).toEqual({ kind: 'menu', anchor })
  })

  it('opens the file in its default app on ⌥-click', () => {
    expect(routeFileOpen(click(true), true)).toEqual({ kind: 'external' })
  })

  it('keeps the direct open for callers that are not a link click', () => {
    expect(routeFileOpen(undefined, true)).toEqual({ kind: 'direct' })
  })

  it('keeps the direct open everywhere while the menu is off (Web UI), ⌥ included', () => {
    expect(routeFileOpen(click(), false)).toEqual({ kind: 'direct' })
    expect(routeFileOpen(click(true), false)).toEqual({ kind: 'direct' })
  })
})

describe('opensInBrowser', () => {
  it('offers the browser for HTML pages only', () => {
    expect(opensInBrowser('/tmp/proto/index.html')).toBe(true)
    expect(opensInBrowser('/tmp/proto/LEGACY.HTM')).toBe(true)
    expect(opensInBrowser('/tmp/proto/App.tsx')).toBe(false)
    expect(opensInBrowser('/tmp/proto/page.xhtml')).toBe(false)
    expect(opensInBrowser('/tmp/proto/index.html.md')).toBe(false)
  })
})

describe('fileLinkMenuHeader', () => {
  it('collapses the folders above the three nearest parents', () => {
    expect(fileLinkMenuHeader('/Users/alex/projects/weather-dashboard/sessions/260101-quiet-river/data/forecast-grid.html')).toEqual({
      name: 'forecast-grid.html',
      folder: '…/sessions/260101-quiet-river/data',
    })
  })

  it('spells out a short folder', () => {
    expect(fileLinkMenuHeader('/Users/alex/notes.md')).toEqual({ name: 'notes.md', folder: '/Users/alex' })
    expect(fileLinkMenuHeader('/Users/alex/src/notes.md')).toEqual({ name: 'notes.md', folder: '/Users/alex/src' })
  })

  it('names the root folder of a file at the root', () => {
    expect(fileLinkMenuHeader('/notes.md')).toEqual({ name: 'notes.md', folder: '/' })
  })

  it('names a linked folder by its last segment', () => {
    expect(fileLinkMenuHeader('/Users/alex/src/weather-dashboard/')).toEqual({ name: 'weather-dashboard', folder: '/Users/alex/src' })
  })

  it('keeps Windows separators', () => {
    expect(fileLinkMenuHeader('C:\\Users\\alex\\src\\weather-dashboard\\index.html')).toEqual({
      name: 'index.html',
      folder: '…\\alex\\src\\weather-dashboard',
    })
  })

  it('has no folder line for a bare file name', () => {
    expect(fileLinkMenuHeader('index.html')).toEqual({ name: 'index.html', folder: '' })
  })
})
