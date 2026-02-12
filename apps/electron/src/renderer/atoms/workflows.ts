/**
 * Workflows Atom
 *
 * Simple atom for storing workspace workflows.
 * Used by NavigationContext for auto-selection when navigating to workflows view.
 */

import { atom } from 'jotai'
import type { LoadedWorkflow } from '../../shared/types'

/**
 * Atom to store the current workspace's workflows.
 * AppShell populates this when workflows are loaded.
 * NavigationContext reads from it for auto-selection.
 */
export const workflowsAtom = atom<LoadedWorkflow[]>([])
