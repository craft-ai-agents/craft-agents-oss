import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import {
  editorTabsAtom,
  activeTabIdAtom,
  hasOpenTabsAtom,
  closeTabAtom,
  openFileTabAtom,
  refreshAllTabsAtom,
  detectTurnEnd,
} from '@/atoms/editor-tabs'
import { sessionAtomFamily } from '@/atoms/sessions'
import type { SessionFile } from '../../../shared/types'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import {
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_SASH_FLEX_MARGIN,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_INNER,
} from '../app-shell/panel-constants'
import { getResizeGradientStyle } from '@/hooks/useResizeGradient'

const DEFAULT_WIDTH = 400
const MIN_WIDTH = 200
const MAX_WIDTH = 800
const SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function flattenFilePaths(files: SessionFile[]): string[] {
  const paths: string[] = []
  for (const file of files) {
    if (file.type === 'file') paths.push(file.path)
    if (file.children) paths.push(...flattenFilePaths(file.children))
  }
  return paths
}

export interface EditorDetailPanelProps {
  workspaceId?: string
  sessionId?: string
}

export function EditorDetailPanel({ workspaceId, sessionId }: EditorDetailPanelProps) {
  const tabs = useAtomValue(editorTabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const hasOpenTabs = useAtomValue(hasOpenTabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const openFileTab = useSetAtom(openFileTabAtom)
  const refreshAllTabs = useSetAtom(refreshAllTabsAtom)

  const session = useAtomValue(sessionAtomFamily(sessionId ?? ''))
  const isProcessing = session?.isProcessing ?? false
  const prevIsProcessingRef = useRef(false)
  const isProcessingRef = useRef(false)
  const knownFilePathsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    isProcessingRef.current = isProcessing
  }, [isProcessing])

  useEffect(() => {
    if (detectTurnEnd(prevIsProcessingRef.current, isProcessing)) {
      void refreshAllTabs()
    }
    prevIsProcessingRef.current = isProcessing
  }, [isProcessing, refreshAllTabs])

  useEffect(() => {
    if (!sessionId) return
    const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId) => {
      if (changedSessionId !== sessionId || !isProcessingRef.current) return
      void (async () => {
        const files = await window.electronAPI.getSessionFiles(sessionId)
        const paths = flattenFilePaths(files)
        for (const path of paths) {
          if (!knownFilePathsRef.current.has(path)) {
            void openFileTab(path)
          }
        }
        knownFilePathsRef.current = new Set(paths)
      })()
    })
    return () => unsubscribe()
  }, [sessionId, openFileTab])

  const [width, setWidth] = useState<number>(() =>
    storage.get(storage.KEYS.editorPanelWidth, DEFAULT_WIDTH, workspaceId)
  )
  const [sashHandleY, setSashHandleY] = useState<number | null>(null)

  const workspaceIdRef = useRef(workspaceId)

  useEffect(() => {
    workspaceIdRef.current = workspaceId
    setWidth(storage.get(storage.KEYS.editorPanelWidth, DEFAULT_WIDTH, workspaceId))
  }, [workspaceId])

  useEffect(() => {
    storage.set(storage.KEYS.editorPanelWidth, width, workspaceIdRef.current)
  }, [width])

  const sashRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleSashMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      dragStartXRef.current = e.clientX
      dragStartWidthRef.current = width

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        // Sash is on the LEFT edge: dragging left (negative delta) increases width
        const delta = dragStartXRef.current - ev.clientX
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidthRef.current + delta))
        setWidth(next)
      }

      const handleMouseUp = () => {
        isDraggingRef.current = false
        setSashHandleY(null)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [width]
  )

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <AnimatePresence>
      {hasOpenTabs && (
        <motion.div
          key="editor-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={SPRING}
          className="shrink-0 h-full flex"
          style={{
            paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
            marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
            marginBottom: -6,
            paddingBottom: 6,
          }}
        >
          <div
            className="flex h-full w-full overflow-hidden bg-background"
            style={{
              borderRadius: RADIUS_INNER,
            }}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="shrink-0 relative cursor-col-resize z-10 flex justify-center"
              style={{
                width: PANEL_SASH_HIT_WIDTH,
                marginLeft: PANEL_SASH_FLEX_MARGIN,
                marginRight: PANEL_SASH_FLEX_MARGIN,
                top: PANEL_STACK_VERTICAL_OVERFLOW,
                bottom: PANEL_STACK_VERTICAL_OVERFLOW,
              }}
              ref={sashRef}
              onMouseDown={handleSashMouseDown}
              onMouseMove={(e) => {
                if (sashRef.current) {
                  const rect = sashRef.current.getBoundingClientRect()
                  setSashHandleY(e.clientY - rect.top)
                }
              }}
              onMouseLeave={() => {
                if (!isDraggingRef.current) setSashHandleY(null)
              }}
            >
              <div
                className="h-full"
                style={{
                  width: PANEL_SASH_LINE_WIDTH,
                  ...getResizeGradientStyle(
                    sashHandleY,
                    sashRef.current?.clientHeight ?? null
                  ),
                }}
              />
            </motion.div>

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <div className="flex items-center border-b border-border/50 shrink-0 overflow-x-auto scrollbar-none">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={cn(
                      'group flex items-center gap-1.5 px-3 py-1.5 border-r border-border/30 shrink-0',
                      'cursor-pointer select-none text-xs transition-colors',
                      tab.id === activeTabId
                        ? 'bg-background text-foreground'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span className="max-w-[140px] truncate" title={tab.filePath}>
                      {getFileName(tab.filePath)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
                      className={cn(
                        'flex items-center justify-center rounded-sm',
                        'h-3.5 w-3.5 opacity-0 group-hover:opacity-100',
                        'hover:bg-foreground/15 transition-opacity',
                        'focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring outline-none'
                      )}
                      title={`Close ${getFileName(tab.filePath)}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex-1 overflow-auto min-h-0">
                {activeTab && (
                  <ShikiCodeViewer
                    code={activeTab.content}
                    filePath={activeTab.filePath}
                    className="h-full text-xs"
                  />
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
