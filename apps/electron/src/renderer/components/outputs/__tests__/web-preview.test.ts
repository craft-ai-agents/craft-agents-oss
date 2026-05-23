import { describe, expect, test } from 'bun:test'
import type { OutputManifestDTO } from '@/hooks/useOutputs'
import { isLocalWebPreviewUrl, resolveWebPreviewTarget } from '../web-preview'
import { buildRunnerOutputAssetUrl, parseRunnerOutputAssetUrl } from '@craft-agent/shared/outputs'

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

function htmlAssetManifest(overrides: Partial<OutputManifestDTO> = {}): OutputManifestDTO {
  return {
    id: 'output-html',
    workspaceId: 'workspace-1',
    title: 'Generated page',
    kind: 'code',
    status: 'published',
    summary: 'HTML preview',
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    origin: { source: 'session', sessionId: 'session-1' },
    primary: {
      id: 'index',
      label: 'index.html',
      role: 'primary',
      path: 'site/index.html',
      mimeType: 'text/html',
    },
    assets: [{
      id: 'index',
      label: 'index.html',
      role: 'primary',
      path: 'site/index.html',
      mimeType: 'text/html',
    }],
    receipts: [],
    links: [],
    preview: { mode: 'web', assetId: 'index' },
    ...overrides,
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

  test('blocks the current app origin when provided', () => {
    expect(isLocalWebPreviewUrl('http://localhost:5173/preview', {
      blockedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    })).toBe(false)
    expect(isLocalWebPreviewUrl('http://127.0.0.1:5173/preview', {
      blockedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    })).toBe(false)
    expect(isLocalWebPreviewUrl('http://localhost:4187/preview', {
      blockedOrigins: ['http://localhost:5173'],
    })).toBe(true)
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

  test('does not resolve the blocked app origin to an iframe target', () => {
    expect(resolveWebPreviewTarget(manifest('http://localhost:5173/'), {
      blockedOrigins: ['http://localhost:5173'],
    })).toBeNull()
  })

  test('resolves generated HTML assets to runner-output protocol previews', () => {
    expect(resolveWebPreviewTarget(htmlAssetManifest())).toEqual({
      url: 'runner-output://asset/workspace-1/output-html/site/index.html',
      label: 'index.html',
      displayHost: 'generated output',
    })
  })

  test('resolves generated HTML assets without explicit web preview mode', () => {
    expect(resolveWebPreviewTarget(htmlAssetManifest({
      preview: undefined,
    }))).toEqual({
      url: 'runner-output://asset/workspace-1/output-html/site/index.html',
      label: 'index.html',
      displayHost: 'generated output',
    })
  })

  test('does not override generated HTML assets with a non-web explicit preview mode', () => {
    expect(resolveWebPreviewTarget(htmlAssetManifest({
      preview: { mode: 'markdown', assetId: 'index' },
    }))).toBeNull()
  })

  test('blocks unsafe generated HTML asset paths', () => {
    expect(resolveWebPreviewTarget(htmlAssetManifest({
      primary: {
        id: 'index',
        label: 'index.html',
        role: 'primary',
        path: '../index.html',
        mimeType: 'text/html',
      },
      assets: [{
        id: 'index',
        label: 'index.html',
        role: 'primary',
        path: '../index.html',
        mimeType: 'text/html',
      }],
    }))).toBeNull()
  })
})

describe('runner-output URL helpers', () => {
  test('round trips safe output asset URLs', () => {
    const url = buildRunnerOutputAssetUrl('workspace 1', 'output-1', 'site/my page.html')
    expect(url).toBe('runner-output://asset/workspace%201/output-1/site/my%20page.html')
    expect(parseRunnerOutputAssetUrl(url)).toEqual({
      workspaceId: 'workspace 1',
      outputId: 'output-1',
      assetPath: 'site/my page.html',
    })
  })

  test('round trips absolute workspace output asset URLs for legacy session outputs', () => {
    const url = buildRunnerOutputAssetUrl('workspace-1', 'output-1', '/Users/michael/workspace/sessions/session-1/data/index.html')
    expect(url).toBe('runner-output://asset/workspace-1/output-1/%2FUsers%2Fmichael%2Fworkspace%2Fsessions%2Fsession-1%2Fdata%2Findex.html')
    expect(parseRunnerOutputAssetUrl(url)).toEqual({
      workspaceId: 'workspace-1',
      outputId: 'output-1',
      assetPath: '/Users/michael/workspace/sessions/session-1/data/index.html',
    })
  })

  test('rejects traversal output asset URLs', () => {
    expect(parseRunnerOutputAssetUrl('runner-output://asset/workspace-1/output-1/%2E%2E/secret.html')).toBeNull()
  })
})
