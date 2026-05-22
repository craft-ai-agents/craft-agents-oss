import { describe, expect, it } from 'bun:test'
import type { VisualSurface } from '@craft-agent/shared/visual-surfaces'
import type { OutputManifestDTO } from '@/hooks/useOutputs'
import { selectVisualSurfaceAdapter, type VisualSurfaceAdapterContext } from '../VisualSurfaceAdapterRegistry'

function surface(kind: VisualSurface['kind']): VisualSurface {
  return {
    id: `surface-${kind}`,
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    kind,
    title: kind,
    status: 'active',
    source: 'demo',
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  }
}

function manifest(kind: OutputManifestDTO['kind'], tags?: string[]): OutputManifestDTO {
  return {
    id: `output-${kind}`,
    title: `Output ${kind}`,
    kind,
    status: 'published',
    summary: '',
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    origin: { source: 'session', sessionId: 'session-1' },
    assets: [],
    receipts: [],
    links: [],
    tags,
  }
}

function context(overrides: Partial<VisualSurfaceAdapterContext> = {}): VisualSurfaceAdapterContext {
  return {
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    surface: surface('canvas'),
    sessionOutputs: [],
    manifestError: null,
    onOpenOutput: () => {},
    ...overrides,
  }
}

describe('visual surface adapters', () => {
  it('resolves canvas surfaces to the board adapter', () => {
    const adapter = selectVisualSurfaceAdapter(context())
    expect(adapter.id).toBe('canvas-board')
    expect(adapter.capabilities.agentControllable).toBe(true)
  })

  it('resolves output-backed image and document surfaces to output preview', () => {
    expect(selectVisualSurfaceAdapter(context({
      surface: surface('image'),
      selectedOutputId: 'output-image',
      selectedManifest: manifest('image'),
    })).id).toBe('output-preview')

    expect(selectVisualSurfaceAdapter(context({
      surface: surface('document'),
      selectedOutputId: 'output-report',
      selectedManifest: manifest('report'),
    })).id).toBe('output-preview')
  })

  it('resolves future surface kinds to unsupported until adapters exist', () => {
    expect(selectVisualSurfaceAdapter(context({ surface: surface('browser') })).id).toBe('unsupported')
    expect(selectVisualSurfaceAdapter(context({ surface: surface('chart') })).id).toBe('unsupported')
    expect(selectVisualSurfaceAdapter(context({ surface: surface('workflow') })).id).toBe('unsupported')
  })

  it('keeps visual-board outputs on the canvas adapter', () => {
    const adapter = selectVisualSurfaceAdapter(context({
      selectedOutputId: 'visual-board',
      selectedManifest: manifest('other', ['visual-board']),
    }))

    expect(adapter.id).toBe('canvas-board')
  })

  it('returns to canvas when a visual-board output is selected from an output surface', () => {
    const adapter = selectVisualSurfaceAdapter(context({
      surface: {
        ...surface('output'),
        source: 'output',
        outputId: 'visual-board',
      },
      selectedOutputId: 'visual-board',
      selectedManifest: manifest('other', ['visual-board']),
    }))

    expect(adapter.id).toBe('canvas-board')
  })
})
