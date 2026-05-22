import { describe, expect, test } from 'bun:test'
import type { OutputManifestDTO } from '@/hooks/useOutputs'
import { isLocalWebPreviewUrl, resolveWebPreviewTarget } from '../web-preview'

function manifest(url: string, mode: 'external-link' | 'web' = 'external-link'): OutputManifestDTO {
  return {
    id: 'output-1',
    workspaceId: 'workspace-1',
    title: 'Preview output',
    kind: 'external-action',
    status: 'published',
    summary: 'Preview',
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    origin: { source: 'session', sessionId: 'session-1' },
    assets: [],
    receipts: [],
    links: [{ id: 'link-1', label: 'Local preview', url, role: 'primary' }],
    preview: { mode },
  }
}

describe('web preview URL policy', () => {
  test('allows local HTTP(S) preview URLs', () => {
    expect(isLocalWebPreviewUrl('http://localhost:3000')).toBe(true)
    expect(isLocalWebPreviewUrl('http://127.0.0.1:5173/path?q=1#hash')).toBe(true)
    expect(isLocalWebPreviewUrl('http://[::1]:8080')).toBe(true)
    expect(isLocalWebPreviewUrl('https://localhost:3443')).toBe(true)
  })

  test('blocks remote and unsafe URLs', () => {
    expect(isLocalWebPreviewUrl('https://example.com')).toBe(false)
    expect(isLocalWebPreviewUrl('http://192.168.0.2:3000')).toBe(false)
    expect(isLocalWebPreviewUrl('file:///tmp/index.html')).toBe(false)
    expect(isLocalWebPreviewUrl('javascript:alert(1)')).toBe(false)
    expect(isLocalWebPreviewUrl('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isLocalWebPreviewUrl('blob:http://localhost:3000/id')).toBe(false)
    expect(isLocalWebPreviewUrl('http://user:pass@localhost:3000')).toBe(false)
    expect(isLocalWebPreviewUrl('not a url')).toBe(false)
  })
})

describe('web preview target resolution', () => {
  test('resolves local external-link outputs to embeddable web previews', () => {
    expect(resolveWebPreviewTarget(manifest('http://localhost:4187/report.html'))).toEqual({
      url: 'http://localhost:4187/report.html',
      label: 'Local preview',
      displayHost: 'localhost:4187',
    })
  })

  test('supports explicit web preview mode', () => {
    expect(resolveWebPreviewTarget(manifest('http://127.0.0.1:3000', 'web'))?.url).toBe('http://127.0.0.1:3000/')
  })

  test('normalizes IPv6 loopback to localhost for CSP-compatible framing', () => {
    expect(resolveWebPreviewTarget(manifest('http://[::1]:8080/page'))).toEqual({
      url: 'http://localhost:8080/page',
      label: 'Local preview',
      displayHost: 'localhost:8080',
    })
  })

  test('does not resolve remote links to iframe previews', () => {
    expect(resolveWebPreviewTarget(manifest('https://example.com'))).toBeNull()
  })

  test('does not override asset-backed outputs unless web mode is explicit', () => {
    expect(resolveWebPreviewTarget({
      ...manifest('http://localhost:4187/report.html'),
      preview: { mode: 'markdown', assetId: 'primary' },
      primary: {
        id: 'primary',
        label: 'Report',
        role: 'primary',
        path: 'content.md',
        mimeType: 'text/markdown',
      },
      assets: [{
        id: 'primary',
        label: 'Report',
        role: 'primary',
        path: 'content.md',
        mimeType: 'text/markdown',
      }],
    })).toBeNull()
  })
})
