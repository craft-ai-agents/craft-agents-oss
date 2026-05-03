/**
 * Sources Atom
 *
 * Simple atom for storing workspace sources.
 * Used by NavigationContext for auto-selection when navigating to sources view.
 */

import { atom } from 'jotai'
import type { LoadedSource } from '../../shared/types'

/**
 * Atom to store the current workspace's sources.
 * AppShell populates this when sources are loaded.
 * NavigationContext reads from it for auto-selection.
 */
export const sourcesAtom = atom<LoadedSource[]>([])

export const globalSourcesAtom = atom<LoadedSource[]>([])

export const effectiveSourcesAtom = atom((get) => {
  const workspaceSources = get(sourcesAtom)
  const workspaceSlugs = new Set(workspaceSources.map((source) => source.config.slug))
  const dormantGlobals = get(globalSourcesAtom)
    .filter((source) => !workspaceSlugs.has(source.config.slug))
    .map((source) => ({ ...source, tier: 'global-dormant' as const }))

  return [...workspaceSources, ...dormantGlobals]
})
