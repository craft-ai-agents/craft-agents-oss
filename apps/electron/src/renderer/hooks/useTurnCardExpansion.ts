/**
 * Hook for persisting TurnCard expanded/collapsed state across session switches.
 *
 * Stores expansion state in a single localStorage key as a bounded LRU map
 * (max 100 sessions).
 *
 * Shape:
 * { [sessionId]: { turns: string[], collapsedTurns?: string[], groups: string[], collapsedGroups?: string[], lastAccessed: number } }
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import * as storage from '@/lib/local-storage'

const MAX_SESSIONS = 100

/** Entry for a single session's expansion state */
interface ExpansionEntry {
  turns: string[]
  collapsedTurns?: string[]
  groups: string[]
  collapsedGroups?: string[]
  lastAccessed: number
}

/** Full map stored in localStorage */
type ExpansionMap = Record<string, ExpansionEntry>

/**
 * Read the full expansion map from localStorage.
 * Returns empty object on parse failure.
 */
function readMap(): ExpansionMap {
  return storage.get<ExpansionMap>(storage.KEYS.turnCardExpansion, {})
}

/**
 * Write the expansion map to localStorage, pruning to MAX_SESSIONS
 * by dropping the oldest entries (lowest lastAccessed).
 */
function writeMap(map: ExpansionMap): void {
  const entries = Object.entries(map)
  if (entries.length > MAX_SESSIONS) {
    // Sort by lastAccessed ascending, keep only the most recent MAX_SESSIONS
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
    const pruned: ExpansionMap = {}
    const keep = entries.slice(entries.length - MAX_SESSIONS)
    for (const [key, value] of keep) {
      pruned[key] = value
    }
    storage.set(storage.KEYS.turnCardExpansion, pruned)
  } else {
    storage.set(storage.KEYS.turnCardExpansion, map)
  }
}

/**
 * Persist TurnCard expansion state for the given session.
 * Returns controlled state + callbacks to pass to TurnCard components.
 */
export function useTurnCardExpansion(sessionId: string | undefined, defaultExpanded = false) {
  // Initialize state from localStorage for this session
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => {
    if (!sessionId) return new Set()
    const map = readMap()
    const entry = map[sessionId]
    return entry ? new Set(entry.turns) : new Set()
  })

  const [collapsedTurns, setCollapsedTurns] = useState<Set<string>>(() => {
    if (!sessionId) return new Set()
    const map = readMap()
    const entry = map[sessionId]
    return entry?.collapsedTurns ? new Set(entry.collapsedTurns) : new Set()
  })

  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(() => {
    if (!sessionId) return new Set()
    const map = readMap()
    const entry = map[sessionId]
    return entry ? new Set(entry.groups) : new Set()
  })

  const [collapsedActivityGroups, setCollapsedActivityGroups] = useState<Set<string>>(() => {
    if (!sessionId) return new Set()
    const map = readMap()
    const entry = map[sessionId]
    return entry?.collapsedGroups ? new Set(entry.collapsedGroups) : new Set()
  })

  // Track sessionId so we can restore state on session switch
  const prevSessionIdRef = useRef(sessionId)

  // When sessionId changes, load the new session's expansion state
  useEffect(() => {
    if (prevSessionIdRef.current === sessionId) return

    // Load the new session's expansion state from localStorage
    if (sessionId) {
      const map = readMap()
      const entry = map[sessionId]
      setExpandedTurns(entry ? new Set(entry.turns) : new Set())
      setCollapsedTurns(entry?.collapsedTurns ? new Set(entry.collapsedTurns) : new Set())
      setExpandedActivityGroups(entry ? new Set(entry.groups) : new Set())
      setCollapsedActivityGroups(entry?.collapsedGroups ? new Set(entry.collapsedGroups) : new Set())
    } else {
      setExpandedTurns(new Set())
      setCollapsedTurns(new Set())
      setExpandedActivityGroups(new Set())
      setCollapsedActivityGroups(new Set())
    }

    prevSessionIdRef.current = sessionId
  }, [sessionId])

  // Persist to localStorage whenever expansion state changes.
  // Uses a ref to avoid stale closures and only writes when we have a valid session.
  const expandedTurnsRef = useRef(expandedTurns)
  const collapsedTurnsRef = useRef(collapsedTurns)
  const expandedGroupsRef = useRef(expandedActivityGroups)
  const collapsedGroupsRef = useRef(collapsedActivityGroups)
  expandedTurnsRef.current = expandedTurns
  collapsedTurnsRef.current = collapsedTurns
  expandedGroupsRef.current = expandedActivityGroups
  collapsedGroupsRef.current = collapsedActivityGroups

  useEffect(() => {
    if (!sessionId) return
    const map = readMap()
    const turns = [...expandedTurnsRef.current]
    const collapsedTurns = [...collapsedTurnsRef.current]
    const groups = [...expandedGroupsRef.current]
    const collapsedGroups = [...collapsedGroupsRef.current]

    // Only write an entry if there's something expanded/collapsed; remove entry if empty
    if (turns.length === 0 && collapsedTurns.length === 0 && groups.length === 0 && collapsedGroups.length === 0) {
      if (map[sessionId]) {
        delete map[sessionId]
        writeMap(map)
      }
      return
    }

    map[sessionId] = {
      turns,
      ...(collapsedTurns.length > 0 ? { collapsedTurns } : {}),
      groups,
      ...(collapsedGroups.length > 0 ? { collapsedGroups } : {}),
      lastAccessed: Date.now(),
    }
    writeMap(map)
  }, [sessionId, expandedTurns, collapsedTurns, expandedActivityGroups, collapsedActivityGroups])

  // Toggle a single turn's expansion state
  const toggleTurn = useCallback((turnId: string, expanded: boolean) => {
    if (defaultExpanded) {
      setCollapsedTurns(prev => {
        const next = new Set(prev)
        if (expanded) {
          next.delete(turnId)
        } else {
          next.add(turnId)
        }
        return next
      })
      return
    }

    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (expanded) {
        next.add(turnId)
      } else {
        next.delete(turnId)
      }
      return next
    })
  }, [defaultExpanded])

  const isTurnExpanded = useCallback((turnId: string) => {
    return defaultExpanded ? !collapsedTurns.has(turnId) : expandedTurns.has(turnId)
  }, [collapsedTurns, defaultExpanded, expandedTurns])

  return {
    expandedTurns,
    collapsedTurns,
    isTurnExpanded,
    toggleTurn,
    expandedActivityGroups,
    setExpandedActivityGroups,
    collapsedActivityGroups,
    setCollapsedActivityGroups,
  }
}
