import { describe, expect, test } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute, isCompoundRoute } from '../route-parser'
import { routes } from '../routes'

describe('owner-agent navigators (Task 1.3)', () => {
  test('runs / memory / media-lab are recognised as compound routes', () => {
    expect(isCompoundRoute('runs')).toBe(true)
    expect(isCompoundRoute('memory')).toBe(true)
    expect(isCompoundRoute('media-lab')).toBe(true)
  })

  test('parses bare navigator routes', () => {
    expect(parseCompoundRoute('runs')).toEqual({ navigator: 'runs', details: null })
    expect(parseCompoundRoute('memory')).toEqual({ navigator: 'memory', details: null })
    expect(parseCompoundRoute('media-lab')).toEqual({ navigator: 'media-lab', details: null })
  })

  test('parses detail selection', () => {
    expect(parseCompoundRoute('runs/run/run-42')).toEqual({
      navigator: 'runs',
      details: { type: 'run', id: 'run-42' },
    })
    expect(parseCompoundRoute('memory/entry/mem-7')).toEqual({
      navigator: 'memory',
      details: { type: 'memory', id: 'mem-7' },
    })
    expect(parseCompoundRoute('media-lab/artifact/img-9')).toEqual({
      navigator: 'media-lab',
      details: { type: 'artifact', id: 'img-9' },
    })
  })
})

describe('round-trip and builders', () => {
  test('parse -> build is lossless', () => {
    const cases = [
      'runs',
      'runs/run/run-42',
      'memory',
      'memory/entry/mem-7',
      'media-lab',
      'media-lab/artifact/img-9',
    ]
    for (const route of cases) {
      const parsed = parseCompoundRoute(route)
      expect(parsed).not.toBeNull()
      expect(buildCompoundRoute(parsed!)).toBe(route)
    }
  })

  test('route builders emit parseable routes', () => {
    expect(routes.view.runs()).toBe('runs')
    expect(routes.view.runs('run-42')).toBe('runs/run/run-42')
    expect(routes.view.memory()).toBe('memory')
    expect(routes.view.mediaLab()).toBe('media-lab')

    for (const route of [routes.view.runs('r1'), routes.view.memory('m1'), routes.view.mediaLab('a1')]) {
      expect(parseCompoundRoute(route)).not.toBeNull()
    }
  })

  test('malformed detail routes are rejected rather than silently coerced', () => {
    expect(parseCompoundRoute('runs/bogus')).toBeNull()
    expect(parseCompoundRoute('memory/entry')).toBeNull()
    expect(parseCompoundRoute('media-lab/artifact')).toBeNull()
  })

  test('existing navigators still parse (no regression)', () => {
    expect(parseCompoundRoute('projects')).toEqual({ navigator: 'projects', details: null })
    expect(parseCompoundRoute('sources')?.navigator).toBe('sources')
    expect(parseCompoundRoute('allSessions')?.navigator).toBe('sessions')
  })
})
