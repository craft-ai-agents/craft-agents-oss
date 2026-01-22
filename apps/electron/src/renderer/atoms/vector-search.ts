/**
 * Vector Search Atoms
 *
 * Simple atoms for storing vector search state.
 * Uses QMD CLI for semantic search across markdown documents.
 */

import { atom } from 'jotai'
import type { VectorSearchResult } from '../../shared/types'

/**
 * Search mode types supported by QMD
 */
export type SearchMode = 'keyword' | 'semantic' | 'hybrid'

/**
 * Collection info from QMD
 */
export interface CollectionInfo {
  name: string
  url: string
  pattern: string
  files: number
  updated: string
  rootPath?: string  // Absolute root path for resolving relative file paths
}

/**
 * Search state for the vector search feature
 */
export interface SearchState {
  query: string
  mode: SearchMode
  results: VectorSearchResult[]
  error: string | null
  isSearching: boolean
}

/**
 * Main search state atom
 */
export const searchStateAtom = atom<SearchState>({
  query: '',
  mode: 'hybrid',
  results: [],
  error: null,
  isSearching: false
})

/**
 * Collections list atom (info about registered QMD collections)
 */
export const collectionsAtom = atom<CollectionInfo[]>([])

/**
 * Add collection modal state atom
 */
export const addCollectionModalAtom = atom<boolean>(false)

/**
 * Operation types for collection management
 */
export type CollectionOperationType = 'add' | 'remove' | 'reindex'

/**
 * Collection operation state
 */
export interface CollectionOperation {
  type: CollectionOperationType
  status: 'in_progress' | 'success' | 'error'
  step?: string
  error?: string
  collectionName?: string
}

/**
 * Collection operation atom (tracks current operation in progress)
 */
export const collectionOperationAtom = atom<CollectionOperation | null>(null)
