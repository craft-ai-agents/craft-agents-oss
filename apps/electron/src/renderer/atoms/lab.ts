/**
 * Lab Atoms
 *
 * Jotai state management for Lab projects and personas.
 * Follows the same patterns as sessions.ts and sources.ts.
 */

import { atom } from 'jotai'
import type { LabProject, LabPersona, LabPipeline, PipelineStatus } from '@craft-agent/shared/lab/types'

/**
 * All projects in the workspace (lightweight list)
 */
export const labProjectsAtom = atom<LabProject[]>([])

/**
 * All personas in the workspace
 */
export const labPersonasAtom = atom<LabPersona[]>([])

/**
 * Pipelines for the currently selected project
 */
export const labPipelinesAtom = atom<LabPipeline[]>([])

/**
 * Currently selected project ID
 */
export const labActiveProjectIdAtom = atom<string | null>(null)

/**
 * Active pipeline status per project (for sidebar indicators).
 * Maps projectId → PipelineStatus for any project with a running pipeline.
 */
export const labActivePipelineStatusAtom = atom<Record<string, PipelineStatus>>({})
