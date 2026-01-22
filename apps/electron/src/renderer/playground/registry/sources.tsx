/**
 * Playground registry for Source Gallery components.
 *
 * Components for the "App Store" style source discovery and installation.
 */

import type { ComponentEntry } from './types'
import { SourceGallery } from '@/components/sources/SourceGallery'
import { SourceGalleryCard } from '@/components/sources/SourceGalleryCard'
import { SourceDetailModal } from '@/components/sources/SourceDetailModal'
import { GALLERY_SOURCES } from '@/components/sources/gallery-data'

const noopHandler = () => console.log('[Playground] Action triggered')

// Sample source for single card demos
const sampleSource = GALLERY_SOURCES[0] // Linear

export const sourcesComponents: ComponentEntry[] = [
  {
    id: 'source-gallery',
    name: 'SourceGallery',
    category: 'Sources',
    description: 'Full source gallery with search, filters, and card grid',
    component: SourceGallery,
    layout: 'full',
    props: [
      {
        name: 'showFeaturedSection',
        description: 'Show featured sources section at top',
        control: { type: 'boolean' },
        defaultValue: true,
      },
    ],
    variants: [
      { name: 'Default', props: { showFeaturedSection: true } },
      { name: 'No Featured', props: { showFeaturedSection: false } },
      {
        name: 'With Installed',
        props: {
          showFeaturedSection: true,
          installedSlugs: ['linear', 'github', 'slack'],
        },
      },
    ],
    mockData: () => ({
      sources: GALLERY_SOURCES,
      onInstall: (source: unknown) => console.log('[Playground] Install:', source),
    }),
  },
  {
    id: 'source-gallery-card',
    name: 'SourceGalleryCard',
    category: 'Sources',
    description: 'Individual source card for gallery grid',
    component: SourceGalleryCard,
    props: [
      {
        name: 'isInstalled',
        description: 'Show as already installed',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Default', props: { source: sampleSource, isInstalled: false } },
      { name: 'Installed', props: { source: sampleSource, isInstalled: true } },
      {
        name: 'Featured',
        props: { source: GALLERY_SOURCES.find((s) => s.isFeatured) || sampleSource },
      },
      {
        name: 'New',
        props: { source: GALLERY_SOURCES.find((s) => s.isNew) || sampleSource },
      },
      {
        name: 'API Type',
        props: { source: GALLERY_SOURCES.find((s) => s.type === 'api') || sampleSource },
      },
      {
        name: 'Local Type',
        props: { source: GALLERY_SOURCES.find((s) => s.type === 'local') || sampleSource },
      },
    ],
    mockData: () => ({
      source: sampleSource,
      onClick: noopHandler,
      onInstall: noopHandler,
    }),
  },
  {
    id: 'source-detail-modal',
    name: 'SourceDetailModal',
    category: 'Sources',
    description: 'Full detail modal for source with install button',
    component: SourceDetailModal,
    props: [
      {
        name: 'isInstalled',
        description: 'Show as already installed',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'Default (Linear)',
        props: { source: sampleSource, isOpen: true, isInstalled: false },
      },
      {
        name: 'Already Installed',
        props: { source: sampleSource, isOpen: true, isInstalled: true },
      },
      {
        name: 'Featured Source',
        props: {
          source: GALLERY_SOURCES.find((s) => s.isFeatured),
          isOpen: true,
          isInstalled: false,
        },
      },
      {
        name: 'New Source',
        props: {
          source: GALLERY_SOURCES.find((s) => s.isNew),
          isOpen: true,
          isInstalled: false,
        },
      },
      {
        name: 'Local Type (Obsidian)',
        props: {
          source: GALLERY_SOURCES.find((s) => s.type === 'local'),
          isOpen: true,
          isInstalled: false,
        },
      },
    ],
    mockData: () => ({
      source: sampleSource,
      isOpen: true,
      onClose: noopHandler,
      onInstall: noopHandler,
    }),
  },
]
