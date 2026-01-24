/**
 * useFileChangeReview - Hook for managing file change review state
 *
 * Manages accept/reject state for file changes and provides
 * actions to accept/reject individual or all changes.
 */

import { useState, useMemo, useCallback } from 'react'
import type { FileChange } from '../components/overlay/MultiDiffPreviewOverlay'

export type ChangeStatus = 'pending' | 'accepted' | 'rejected'

export interface UseFileChangeReviewReturn {
  /** Map of change ID to status */
  statuses: Map<string, ChangeStatus>
  /** Accept a specific change */
  acceptChange: (changeId: string) => void
  /** Reject a specific change */
  rejectChange: (changeId: string) => void
  /** Accept all changes */
  acceptAll: () => void
  /** Reject all changes */
  rejectAll: () => void
  /** Reset all changes to pending */
  resetAll: () => void
  /** Count of changes by status */
  counts: {
    pending: number
    accepted: number
    rejected: number
  }
}

/**
 * Hook for managing file change review state
 */
export function useFileChangeReview(changes: FileChange[]): UseFileChangeReviewReturn {
  // Initialize all changes as pending
  const [statuses, setStatuses] = useState<Map<string, ChangeStatus>>(() => {
    return new Map(changes.map(c => [c.id, 'pending']))
  })

  // Update statuses when changes array changes
  // Add new changes as pending, keep existing statuses
  useState(() => {
    setStatuses(prev => {
      const updated = new Map(prev)
      for (const change of changes) {
        if (!updated.has(change.id)) {
          updated.set(change.id, 'pending')
        }
      }
      // Remove statuses for changes that no longer exist
      for (const [id] of updated) {
        if (!changes.find(c => c.id === id)) {
          updated.delete(id)
        }
      }
      return updated
    })
  })

  // Accept a specific change
  const acceptChange = useCallback((changeId: string) => {
    setStatuses(prev => {
      const updated = new Map(prev)
      updated.set(changeId, 'accepted')
      return updated
    })
  }, [])

  // Reject a specific change
  const rejectChange = useCallback((changeId: string) => {
    setStatuses(prev => {
      const updated = new Map(prev)
      updated.set(changeId, 'rejected')
      return updated
    })
  }, [])

  // Accept all changes
  const acceptAll = useCallback(() => {
    setStatuses(prev => {
      const updated = new Map(prev)
      for (const change of changes) {
        updated.set(change.id, 'accepted')
      }
      return updated
    })
  }, [changes])

  // Reject all changes
  const rejectAll = useCallback(() => {
    setStatuses(prev => {
      const updated = new Map(prev)
      for (const change of changes) {
        updated.set(change.id, 'rejected')
      }
      return updated
    })
  }, [changes])

  // Reset all to pending
  const resetAll = useCallback(() => {
    setStatuses(prev => {
      const updated = new Map(prev)
      for (const change of changes) {
        updated.set(change.id, 'pending')
      }
      return updated
    })
  }, [changes])

  // Calculate counts
  const counts = useMemo(() => {
    const result = {
      pending: 0,
      accepted: 0,
      rejected: 0,
    }

    for (const status of statuses.values()) {
      result[status]++
    }

    return result
  }, [statuses])

  return {
    statuses,
    acceptChange,
    rejectChange,
    acceptAll,
    rejectAll,
    resetAll,
    counts,
  }
}
