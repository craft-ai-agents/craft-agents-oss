/**
 * Projects Atoms
 *
 * Jotai atoms for project state management.
 * - projectsAtom: list of all project summaries in the workspace
 * - activeProjectSlugAtom: currently selected project slug
 */

import { atom } from 'jotai'
import type { ProjectSummary } from '../../shared/types'

/**
 * Atom storing all project summaries for the current workspace.
 * Populated by AppShell when projects are loaded.
 */
export const projectsAtom = atom<ProjectSummary[]>([])

/**
 * Atom storing the currently active project slug.
 * Used to track which project the user is viewing.
 */
export const activeProjectSlugAtom = atom<string | null>(null)
