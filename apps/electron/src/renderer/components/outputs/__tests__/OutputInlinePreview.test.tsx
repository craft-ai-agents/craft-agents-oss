import { describe, expect, test } from 'bun:test'
import type { OutputManifestDTO } from '@/hooks/useOutputs'
import { resolvePresentationPreviewAsset } from '../presentation-preview'

type Asset = OutputManifestDTO['assets'][number]

function inferPreviewMode(asset?: Asset) {
  const mime = asset?.mimeType ?? ''
  const path = asset?.path.toLowerCase() ?? ''
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image'
  if (mime === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  return 'text'
}

function presentationManifest(assets: OutputManifestDTO['assets']): OutputManifestDTO {
  return {
    id: 'output-deck',
    workspaceId: 'workspace-1',
    title: 'Deck',
    kind: 'document',
    status: 'published',
    summary: 'Deck output',
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    origin: { source: 'session', sessionId: 'session-1' },
    primary: assets[0],
    assets,
    receipts: [],
    links: [],
    preview: { mode: 'presentation', assetId: assets[0]?.id },
  }
}

describe('presentation preview asset selection', () => {
  test('prefers a PDF deck export over unrelated images', () => {
    const primary = {
      id: 'deck',
      label: 'deck.pptx',
      role: 'primary' as const,
      path: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    const logo = {
      id: 'logo',
      label: 'logo.png',
      role: 'supporting' as const,
      path: 'assets/logo.png',
      mimeType: 'image/png',
    }
    const pdf = {
      id: 'deck-pdf',
      label: 'deck.pdf',
      role: 'supporting' as const,
      path: 'deck.pdf',
      mimeType: 'application/pdf',
    }

    expect(resolvePresentationPreviewAsset(presentationManifest([primary, logo, pdf]), primary, inferPreviewMode)?.id).toBe('deck-pdf')
  })

  test('uses a named image preview before generic supporting images', () => {
    const primary = {
      id: 'deck',
      label: 'deck.pptx',
      role: 'primary' as const,
      path: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    const logo = {
      id: 'logo',
      label: 'logo.png',
      role: 'supporting' as const,
      path: 'assets/logo.png',
      mimeType: 'image/png',
    }
    const preview = {
      id: 'slide-preview',
      label: 'slides-preview.png',
      role: 'supporting' as const,
      path: 'exports/slides-preview.png',
      mimeType: 'image/png',
    }

    expect(resolvePresentationPreviewAsset(presentationManifest([primary, logo, preview]), primary, inferPreviewMode)?.id).toBe('slide-preview')
  })
})
