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
  getNewSessionFilePaths,
  type EditorTab,
} from '@/atoms/editor-tabs'
import { sessionAtomFamily } from '@/atoms/sessions'
import { addLineCommentAtom, type LineComment } from '@/atoms/line-comments'
import type { SessionFile } from '../../../shared/types'
import { UnifiedDiffViewer } from '@/components/shiki/UnifiedDiffViewer'
import { LineAnnotatableViewer } from '@/components/editor/LineAnnotatableViewer'
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

function getTabTitle(tab: EditorTab): string {
  if (tab.type === 'git-commit') return tab.commit.shortHash
  return getFileName(tab.filePath)
}

function getTabTooltip(tab: EditorTab): string {
  if (tab.type === 'git-commit') return `${tab.commit.shortHash} ${tab.commit.message}`
  return tab.filePath
}

function WorkingTreeDiffContent({ tab }: { tab: Extract<EditorTab, { type: 'git-diff' }> }) {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <UnifiedDiffViewer
        unifiedDiff={tab.patch}
        filePath={tab.filePath}
        className="min-h-full text-sm"
      />
    </div>
  )
}

function CommitDetailContent({ tab }: { tab: Extract<EditorTab, { type: 'git-commit' }> }) {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono">{tab.commit.shortHash}</span>
          <span>{tab.commit.author}</span>
        </div>
        <div className="mt-1 text-sm font-medium text-foreground">{tab.commit.message}</div>
      </div>
      <div className="divide-y divide-border/50">
        {tab.commit.filesChanged.map((file) => (
          <details key={`${tab.commit.hash}:${file.path}`} open className="group">
            <summary className="sticky top-0 z-10 flex cursor-pointer select-none items-center gap-2 bg-background px-4 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>
              <span className="font-mono text-emerald-500">+{file.additions}</span>
              <span className="font-mono text-rose-500">-{file.deletions}</span>
            </summary>
            {file.diff ? (
              <UnifiedDiffViewer
                unifiedDiff={file.diff}
                filePath={file.path}
                className="text-sm"
              />
            ) : (
              <div className="px-4 py-3 text-sm text-muted-foreground">No diff available</div>
            )}
          </details>
        ))}
      </div>
    </div>
  )
}

function renderTabContent(tab: EditorTab, onLineComment: (comment: LineComment) => void) {
  switch (tab.type) {
    case 'file':
      return (
        <LineAnnotatableViewer
          code={tab.content}
          filePath={tab.filePath}
          className="h-full text-sm"
          onComment={onLineComment}
        />
      )
    case 'git-diff':
      return <WorkingTreeDiffContent tab={tab} />
    case 'git-commit':
      return <CommitDetailContent tab={tab} />
  }
}

export interface EditorDetailPanelProps {
  workspaceId?: string
  sessionId?: string
  isOpen?: boolean
}

export function EditorDetailPanel({ workspaceId, sessionId, isOpen = true }: EditorDetailPanelProps) {
  const tabs = useAtomValue(editorTabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const hasOpenTabs = useAtomValue(hasOpenTabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const closeTab = useSetAtom(closeTabAtom)
  const openFileTab = useSetAtom(openFileTabAtom)
  const refreshAllTabs = useSetAtom(refreshAllTabsAtom)
  const addLineComment = useSetAtom(addLineCommentAtom)

  const session = useAtomValue(sessionAtomFamily(sessionId ?? ''))
  const isProcessing = session?.isProcessing ?? false
  const prevIsProcessingRef = useRef(false)
  const isProcessingRef = useRef(false)
  const knownFilePathsRef = useRef<Set<string> | null>(null)

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
    knownFilePathsRef.current = null
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId) => {
      if (changedSessionId !== sessionId || !isProcessingRef.current) return
      void (async () => {
        const files = await window.electronAPI.getSessionFiles(sessionId)
        const paths = flattenFilePaths(files)
        for (const path of getNewSessionFilePaths(knownFilePathsRef.current, paths)) {
          void openFileTab(path)
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

  if (!isOpen) return null

  return (
    <AnimatePresence>
      {hasOpenTabs && (
        <motion.div
          key="editor-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={SPRING}
          className="shrink-0 flex"
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
                      'cursor-pointer select-none text-sm transition-colors',
                      tab.id === activeTabId
                        ? 'bg-background text-foreground'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span className="max-w-[140px] truncate" title={getTabTooltip(tab)}>
                      {getTabTitle(tab)}
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
                      title={`Close ${getTabTitle(tab)}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex-1 overflow-auto min-h-0">
                {activeTab && renderTabContent(activeTab, addLineComment)}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
