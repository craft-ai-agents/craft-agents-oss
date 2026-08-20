/**
 * Shared sessions collection filters (B6) — one live chip set for list/board/table.
 */

import { atom } from 'jotai'
import { DEFAULT_COLLECTION_FILTERS, type CollectionFilters } from '@craft-agent/shared/sessions/collection'

export const collectionFiltersAtom = atom<CollectionFilters>({ ...DEFAULT_COLLECTION_FILTERS })
