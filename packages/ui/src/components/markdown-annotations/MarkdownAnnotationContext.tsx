/**
 * MarkdownAnnotationContext — State for markdown text annotations.
 *
 * Stores annotations (citation + comment), the pending selection waiting for a
 * comment, editing state, hover state, and helpers to copy / format output.
 * When a planId is provided, annotations are persisted in a module-scoped store
 * so they survive component unmounts (e.g. session switches). Cleared on app restart.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getStoredAnnotations, setStoredAnnotations } from './annotationStore'

export interface SerializedRange {
  startContainerPath: string
  startOffset: number
  endContainerPath: string
  endOffset: number
}

export interface Annotation {
  id: string
  citation: string
  comment: string
  rangeInfo: SerializedRange
}

export interface PendingSelection {
  rect: DOMRect
  citation: string
  range: Range
}

export interface EditingAnnotation {
  id: string
  rect: DOMRect
}

export interface MarkdownAnnotationContextValue {
  annotations: Annotation[]
  pendingSelection: PendingSelection | null
  editingAnnotation: EditingAnnotation | null
  hoveredAnnotationId: string | null
  addAnnotation: (comment: string) => void
  updateAnnotation: (id: string, comment: string) => void
  removeAnnotation: (id: string) => void
  clearAll: () => void
  setPendingSelection: (sel: PendingSelection | null) => void
  setEditingAnnotation: (editing: EditingAnnotation | null) => void
  setHoveredAnnotationId: (id: string | null) => void
  getCommentsText: () => string
  copyComments: () => Promise<void>
  contentRef: React.RefObject<HTMLDivElement | null>
}

const MarkdownAnnotationCtx = createContext<MarkdownAnnotationContextValue | null>(null)

let nextId = 0
function uid() {
  return `ann-${++nextId}-${Date.now().toString(36)}`
}

function nodeToPath(node: Node, root: Node): string {
  const parts: string[] = []
  let cur: Node | null = node
  while (cur && cur !== root) {
    const parent: ParentNode | null = cur.parentNode
    if (!parent) break
    let idx = 0
    for (let i = 0; i < parent.childNodes.length; i++) {
      if (parent.childNodes[i] === cur) { idx = i; break }
    }
    parts.unshift(String(idx))
    cur = parent
  }
  return parts.join('/')
}

export function pathToNode(path: string, root: Node): Node | null {
  if (!path) return root
  const parts = path.split('/')
  let cur: Node | null = root
  for (const p of parts) {
    if (!cur) return null
    cur = cur.childNodes[Number(p)] ?? null
  }
  return cur
}

/** Returns null if nodes are gone (e.g. DOM changed between serialize and restore). */
export function restoreRange(info: SerializedRange, root: Node): Range | null {
  try {
    const startNode = pathToNode(info.startContainerPath, root)
    const endNode = pathToNode(info.endContainerPath, root)
    if (!startNode || !endNode) return null
    const r = document.createRange()
    r.setStart(startNode, info.startOffset)
    r.setEnd(endNode, info.endOffset)
    return r
  } catch {
    return null
  }
}

function serializeRange(range: Range, root: Node): SerializedRange {
  return {
    startContainerPath: nodeToPath(range.startContainer, root),
    startOffset: range.startOffset,
    endContainerPath: nodeToPath(range.endContainer, root),
    endOffset: range.endOffset,
  }
}

function trimCitation(text: string, max = 120): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max) + '…'
}

/** Default comment formatter — used when no custom formatter is provided. */
function defaultFormatComments(annotations: Annotation[]): string {
  if (annotations.length === 0) return ''
  const lines = annotations.map(a => `- "${a.citation}" — ${a.comment}`)
  return `I have comments on the plan. Please revise it accordingly:\n\n${lines.join('\n')}\n\nPresent the updated plan.`
}

interface MarkdownAnnotationProviderProps {
  children: ReactNode
  /** Stable identifier for this plan — used to persist annotations across unmounts. */
  planId?: string
  /** Custom formatter for comments text. Receives annotations, returns string. */
  formatComments?: (annotations: Annotation[]) => string
}

export function MarkdownAnnotationProvider({ children, planId, formatComments }: MarkdownAnnotationProviderProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>(
    () => planId ? getStoredAnnotations(planId) : []
  )
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null)
  const [editingAnnotation, setEditingAnnotation] = useState<EditingAnnotation | null>(null)
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (planId) {
      setStoredAnnotations(planId, annotations)
    }
  }, [planId, annotations])

  const addAnnotation = useCallback((comment: string) => {
    setPendingSelection(prev => {
      if (!prev || !contentRef.current) return null

      const rangeInfo = serializeRange(prev.range, contentRef.current)
      const annotation: Annotation = {
        id: uid(),
        citation: trimCitation(prev.citation),
        comment,
        rangeInfo,
      }
      setAnnotations(a => [...a, annotation])
      return null
    })
  }, [])

  const updateAnnotation = useCallback((id: string, comment: string) => {
    setAnnotations(a => a.map(ann =>
      ann.id === id ? { ...ann, comment } : ann
    ))
    setEditingAnnotation(null)
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(a => a.filter(ann => ann.id !== id))
    setEditingAnnotation(null)
  }, [])

  const clearAll = useCallback(() => {
    setAnnotations([])
    setEditingAnnotation(null)
    setHoveredAnnotationId(null)
  }, [])

  const formatter = formatComments ?? defaultFormatComments

  const getCommentsText = useCallback(() => {
    return formatter(annotations)
  }, [annotations, formatter])

  const copyComments = useCallback(async () => {
    const text = getCommentsText()
    if (text) {
      await navigator.clipboard.writeText(text)
    }
  }, [getCommentsText])

  const value = useMemo<MarkdownAnnotationContextValue>(() => ({
    annotations,
    pendingSelection,
    editingAnnotation,
    hoveredAnnotationId,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    clearAll,
    setPendingSelection,
    setEditingAnnotation,
    setHoveredAnnotationId,
    getCommentsText,
    copyComments,
    contentRef,
  }), [annotations, pendingSelection, editingAnnotation, hoveredAnnotationId, addAnnotation, updateAnnotation, removeAnnotation, clearAll, getCommentsText, copyComments])

  return (
    <MarkdownAnnotationCtx.Provider value={value}>
      {children}
    </MarkdownAnnotationCtx.Provider>
  )
}

export function useMarkdownAnnotations() {
  const ctx = useContext(MarkdownAnnotationCtx)
  if (!ctx) throw new Error('useMarkdownAnnotations must be used within MarkdownAnnotationProvider')
  return ctx
}
