import { describe, it, expect } from 'bun:test'
import {
  WORKING_DIR_FILTER_THRESHOLD,
  deriveSelectionFlags,
  deriveSortedRecent,
} from '../use-working-directory-state'

describe('deriveSortedRecent', () => {
  it('returns [] when recents is empty', () => {
    expect(deriveSortedRecent([], undefined)).toEqual([])
    expect(deriveSortedRecent([], '/Users/alice/code')).toEqual([])
  })

  it('filters out the current working directory', () => {
    const result = deriveSortedRecent(
      ['/Users/alice/code', '/Users/alice/docs', '/Users/alice/photos'],
      '/Users/alice/docs',
    )
    expect(result).toEqual(['/Users/alice/code', '/Users/alice/photos'])
  })

  it('keeps everything when workingDirectory is undefined', () => {
    const result = deriveSortedRecent(
      ['/Users/alice/code', '/Users/alice/docs'],
      undefined,
    )
    expect(result).toEqual(['/Users/alice/code', '/Users/alice/docs'])
  })

  it('sorts alphabetically by basename, case-insensitive', () => {
    const result = deriveSortedRecent(
      [
        '/Users/alice/Zebra',
        '/Users/alice/apple',
        '/Users/alice/Banana',
        '/Users/alice/cherry',
      ],
      undefined,
    )
    expect(result).toEqual([
      '/Users/alice/apple',
      '/Users/alice/Banana',
      '/Users/alice/cherry',
      '/Users/alice/Zebra',
    ])
  })

  it('does not mutate the input array', () => {
    const input = ['/Users/alice/Zebra', '/Users/alice/apple']
    const snapshot = [...input]
    deriveSortedRecent(input, undefined)
    expect(input).toEqual(snapshot)
  })

  it('sorts by basename even when paths share a basename in different parents', () => {
    const result = deriveSortedRecent(
      ['/a/foo', '/b/bar', '/c/foo'],
      undefined,
    )
    // Stable enough: bar < foo < foo. Both foos remain together; order
    // between them is locale-driven but they must come after bar.
    expect(result[0]).toBe('/b/bar')
    expect(result.slice(1).sort()).toEqual(['/a/foo', '/c/foo'])
  })
})

describe('deriveSelectionFlags', () => {
  it('returns "no folder" when workingDirectory is undefined', () => {
    const flags = deriveSelectionFlags(undefined, undefined)
    expect(flags.hasFolder).toBe(false)
    expect(flags.folderName).toBeUndefined()
    expect(flags.showReset).toBe(false)
  })

  it('returns "no folder" when workingDirectory equals sessionFolderPath', () => {
    const flags = deriveSelectionFlags('/Users/alice/session', '/Users/alice/session')
    expect(flags.hasFolder).toBe(false)
    expect(flags.folderName).toBeUndefined()
    expect(flags.showReset).toBe(false)
  })

  it('returns "no folder" when workingDirectory is undefined but session path is set', () => {
    const flags = deriveSelectionFlags(undefined, '/Users/alice/session')
    expect(flags.hasFolder).toBe(false)
    expect(flags.folderName).toBeUndefined()
    expect(flags.showReset).toBe(false)
  })

  it('returns hasFolder + folderName when a custom folder is selected', () => {
    const flags = deriveSelectionFlags('/Users/alice/code/project', undefined)
    expect(flags.hasFolder).toBe(true)
    expect(flags.folderName).toBe('project')
  })

  it('showReset is true when a custom folder differs from session root', () => {
    const flags = deriveSelectionFlags(
      '/Users/alice/code/project',
      '/Users/alice/session',
    )
    expect(flags.hasFolder).toBe(true)
    expect(flags.folderName).toBe('project')
    expect(flags.showReset).toBe(true)
  })

  it('showReset is false when session root is unset (no path to reset to)', () => {
    const flags = deriveSelectionFlags('/Users/alice/code/project', undefined)
    expect(flags.hasFolder).toBe(true)
    expect(flags.showReset).toBe(false)
  })

  it('folderName falls back to undefined when basename resolves to empty', () => {
    // Path of just '/' — basename is '' — should normalise to undefined,
    // not be passed through as an empty string.
    const flags = deriveSelectionFlags('/', undefined)
    expect(flags.hasFolder).toBe(true)
    expect(flags.folderName).toBeUndefined()
  })
})

describe('WORKING_DIR_FILTER_THRESHOLD', () => {
  it('is 5 — the boundary above which the filter input appears', () => {
    // Pinned as a regression guard: the surfaces share this constant so
    // changing it here must be intentional and applied to both.
    expect(WORKING_DIR_FILTER_THRESHOLD).toBe(5)
  })
})
