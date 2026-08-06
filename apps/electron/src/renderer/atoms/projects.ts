/**
 * Jotai atom for the active workspace's projects (read once on workspace switch,
 * refreshed on `projects:changed` broadcast). Components that need projects in
 * isolation from AppShell read this atom.
 */

import { atom } from 'jotai'
import type { LoadedProject } from '@craft-agent/shared/projects/types'

export const projectsAtom = atom<LoadedProject[]>([])
