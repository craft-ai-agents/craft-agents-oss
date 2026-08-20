import { describe, it, expect } from 'bun:test'
import {
  buildSiyuanSurfaceUrl,
  buildSiyuanDurableKey,
  isSiyuanCompatRef,
  needsSiyuanDockOpen,
  DEFAULT_BASE_URL,
  SIYUAN_FULL_SURFACE_ID,
  SIYUAN_OPEN_DOCK_SCRIPT,
} from '../siyuan-url'

describe('buildSiyuanSurfaceUrl', () => {
  it('appends the desktop web build path to the base URL', () => {
    expect(buildSiyuanSurfaceUrl('http://localhost:6806')).toBe(
      'http://localhost:6806/stage/build/desktop/',
    )
  })

  it('strips trailing slashes from the base URL to avoid a double slash', () => {
    expect(buildSiyuanSurfaceUrl('http://localhost:6806/')).toBe(
      'http://localhost:6806/stage/build/desktop/',
    )
    expect(buildSiyuanSurfaceUrl('http://localhost:6806///')).toBe(
      'http://localhost:6806/stage/build/desktop/',
    )
  })

  it('supports remote base URLs', () => {
    expect(buildSiyuanSurfaceUrl('https://notes.example.com')).toBe(
      'https://notes.example.com/stage/build/desktop/',
    )
  })

  it('appends ?id= for document refs', () => {
    const withDoc = buildSiyuanSurfaceUrl('http://localhost:6806', {
      kind: 'document',
      id: '20240101-abcdef',
    })
    expect(withDoc).toBe('http://localhost:6806/stage/build/desktop/?id=20240101-abcdef')
  })

  it('appends ?id= for block refs', () => {
    const withBlock = buildSiyuanSurfaceUrl('http://localhost:6806', {
      kind: 'block',
      id: '20240101-block',
    })
    expect(withBlock).toBe('http://localhost:6806/stage/build/desktop/?id=20240101-block')
  })

  it('does not append id for notebook/compat refs', () => {
    const compat = buildSiyuanSurfaceUrl('http://localhost:6806', {
      kind: 'notebook',
      id: SIYUAN_FULL_SURFACE_ID,
    })
    expect(compat).toBe('http://localhost:6806/stage/build/desktop/')
  })

  it('graph mode includes craftSurface=graph', () => {
    const url = buildSiyuanSurfaceUrl(
      'http://localhost:6806',
      { kind: 'document', id: 'doc-1' },
      { mode: 'graph' },
    )
    expect(url).toContain('craftSurface=graph')
    expect(url).toContain('id=doc-1')
  })

  it('global-graph mode includes craftSurface=global-graph without requiring id', () => {
    const url = buildSiyuanSurfaceUrl('http://localhost:6806', undefined, {
      mode: 'global-graph',
    })
    expect(url).toBe('http://localhost:6806/stage/build/desktop/?craftSurface=global-graph')
  })

  it('outline and backlinks modes set craftSurface marker', () => {
    expect(
      buildSiyuanSurfaceUrl('http://localhost:6806', { kind: 'document', id: 'd' }, { mode: 'outline' }),
    ).toContain('craftSurface=outline')
    expect(
      buildSiyuanSurfaceUrl('http://localhost:6806', { kind: 'document', id: 'd' }, { mode: 'backlinks' }),
    ).toContain('craftSurface=backlinks')
  })

  it('flashcard and plugins modes set craftSurface marker', () => {
    expect(
      buildSiyuanSurfaceUrl('http://localhost:6806', { kind: 'document', id: 'd' }, { mode: 'flashcard' }),
    ).toContain('craftSurface=flashcard')
    expect(
      buildSiyuanSurfaceUrl('http://localhost:6806', undefined, { mode: 'plugins' }),
    ).toBe('http://localhost:6806/stage/build/desktop/?craftSurface=plugins')
  })

  it('editor mode omits craftSurface', () => {
    const url = buildSiyuanSurfaceUrl(
      'http://localhost:6806',
      { kind: 'document', id: 'd' },
      { mode: 'editor' },
    )
    expect(url).not.toContain('craftSurface')
    expect(url).toContain('id=d')
  })
})

describe('DEFAULT_BASE_URL', () => {
  it('resolves to the local SiYuan kernel desktop surface through the URL builder', () => {
    expect(buildSiyuanSurfaceUrl(DEFAULT_BASE_URL)).toBe(
      'http://localhost:6806/stage/build/desktop/',
    )
  })
})

describe('buildSiyuanDurableKey', () => {
  it('formats siyuan:{kind}:{id}:{mode} with editor default', () => {
    expect(buildSiyuanDurableKey({ kind: 'document', id: 'abc' })).toBe(
      'siyuan:document:abc:editor',
    )
  })

  it('includes mode so graph and editor do not collide', () => {
    const ref = { kind: 'document' as const, id: 'abc' }
    expect(buildSiyuanDurableKey(ref, 'editor')).toBe('siyuan:document:abc:editor')
    expect(buildSiyuanDurableKey(ref, 'graph')).toBe('siyuan:document:abc:graph')
    expect(buildSiyuanDurableKey(ref, 'global-graph')).toBe(
      'siyuan:document:abc:global-graph',
    )
  })

  it('produces distinct keys for global-graph vs document-graph modes', () => {
    const ref = { kind: 'notebook' as const, id: SIYUAN_FULL_SURFACE_ID }
    expect(buildSiyuanDurableKey(ref, 'global-graph')).toBe(
      'siyuan:notebook:__full__:global-graph',
    )
    expect(buildSiyuanDurableKey(ref, 'graph')).toBe('siyuan:notebook:__full__:graph')
  })
})

describe('isSiyuanCompatRef', () => {
  it('is true only for the notebook/__full__ sentinel', () => {
    expect(isSiyuanCompatRef({ kind: 'notebook', id: SIYUAN_FULL_SURFACE_ID })).toBe(true)
  })

  it('is false for real documents', () => {
    expect(isSiyuanCompatRef({ kind: 'document', id: 'abc' })).toBe(false)
    expect(isSiyuanCompatRef({ kind: 'document', id: SIYUAN_FULL_SURFACE_ID })).toBe(false)
    expect(isSiyuanCompatRef({ kind: 'notebook', id: '20240101-abcdef' })).toBe(false)
  })
})

describe('needsSiyuanDockOpen', () => {
  it('is false for editor and true for dock modes', () => {
    expect(needsSiyuanDockOpen('editor')).toBe(false)
    expect(needsSiyuanDockOpen('graph')).toBe(true)
    expect(needsSiyuanDockOpen('global-graph')).toBe(true)
    expect(needsSiyuanDockOpen('outline')).toBe(true)
    expect(needsSiyuanDockOpen('backlinks')).toBe(true)
    expect(needsSiyuanDockOpen('flashcard')).toBe(true)
    expect(needsSiyuanDockOpen('plugins')).toBe(true)
  })
})

describe('SIYUAN_OPEN_DOCK_SCRIPT', () => {
  it('targets graph, flashcard/riff, and plugin dock selectors', () => {
    expect(SIYUAN_OPEN_DOCK_SCRIPT).toContain("params.get('craftSurface')")
    expect(SIYUAN_OPEN_DOCK_SCRIPT).toContain('[data-type="graph"]')
    expect(SIYUAN_OPEN_DOCK_SCRIPT).toContain('[data-type="riff"]')
    expect(SIYUAN_OPEN_DOCK_SCRIPT).toContain('[data-type="flashcard"]')
    expect(SIYUAN_OPEN_DOCK_SCRIPT).toContain('[data-type="plugin"]')
    expect(SIYUAN_OPEN_DOCK_SCRIPT).toContain('altKey:true')
  })
})
