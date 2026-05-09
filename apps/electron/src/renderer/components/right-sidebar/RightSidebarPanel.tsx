import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Files, GitBranch, FolderTree, type LucideIcon } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { sessionAtomFamily } from '@/atoms/sessions'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { SessionFilesSection } from './SessionFilesSection'
import { GitPanel } from './GitPanel'
import { WorkspaceFilesSection, resolveCwdRoot } from './WorkspaceFilesSection'
import {
  PANEL_EDGE_INSET,
  PANEL_SASH_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_SASH_FLEX_MARGIN,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from '../app-shell/panel-constants'
import { getResizeGradientStyle } from '@/hooks/useResizeGradient'

const TAB_STRIP_WIDTH = 36
const DEFAULT_WIDTH = 260
const MIN_WIDTH = 180
const MAX_WIDTH = 520
const SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }

type Tab = 'files' | 'git' | 'workspace'

const RIGHT_SIDEBAR_TABS: readonly {
  id: Tab
  title: string
  Icon: LucideIcon
}[] = [
  { id: 'files', title: 'Files', Icon: Files },
  { id: 'git', title: 'Git', Icon: GitBranch },
  { id: 'workspace', title: 'Workspace', Icon: FolderTree },
]

export interface RightSidebarPanelProps {
  /** Active workspace ID — scopes localStorage persistence */
  workspaceId?: string
  /** Focused session ID — passed to SessionFilesSection */
  sessionId?: string
  /** Controlled open state owned by AppShell */
  isOpen: boolean
}

export function RightSidebarPanel({
  workspaceId,
  sessionId,
  isOpen,
}: RightSidebarPanelProps) {
  const focusedSession = useAtomValue(sessionAtomFamily(sessionId ?? ''))
  const activeWorkspace = useActiveWorkspace()
  const sessionFolderPath = focusedSession?.sessionFolderPath
  const workspacePath = activeWorkspace?.rootPath
  const cwdRoot = resolveCwdRoot(focusedSession?.workingDirectory, workspacePath)
  const [width, setWidth] = useState<number>(() =>
    storage.get(storage.KEYS.rightSidebarWidth, DEFAULT_WIDTH, workspaceId)
  )
  const [activeTab, setActiveTab] = useState<Tab>('files')
  const [sashHandleY, setSashHandleY] = useState<number | null>(null)

  // Tracks current workspaceId so persist effects can write to the correct key.
  const workspaceIdRef = useRef(workspaceId)

  // Re-read from storage when workspaceId changes (workspace switch)
  useEffect(() => {
    workspaceIdRef.current = workspaceId
    setWidth(storage.get(storage.KEYS.rightSidebarWidth, DEFAULT_WIDTH, workspaceId))
  }, [workspaceId])

  useEffect(() => {
    storage.set(storage.KEYS.rightSidebarWidth, width, workspaceIdRef.current)
  }, [width])

  const sashRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleSashMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = width

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return
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
  }, [width])

  const totalWidth = isOpen ? width + TAB_STRIP_WIDTH : 0

  return (
    <motion.div
      initial={false}
      animate={{ width: totalWidth }}
      transition={SPRING}
      className="shrink-0 h-full flex"
      style={{
        // Mirror the vertical overflow trick used in PanelStackContainer
        paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
        marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
        marginBottom: -6,
        paddingBottom: 6,
      }}
    >
      <div
        className="flex h-full w-full overflow-hidden"
        style={{
          borderTopLeftRadius: RADIUS_INNER,
          borderBottomLeftRadius: RADIUS_INNER,
          borderTopRightRadius: RADIUS_EDGE,
          borderBottomRightRadius: RADIUS_EDGE,
        }}
      >
        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="sash"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
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
                  ...getResizeGradientStyle(sashHandleY, sashRef.current?.clientHeight ?? null),
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="content"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width }}
              exit={{ opacity: 0, width: 0 }}
              transition={SPRING}
              className="h-full shrink-0 bg-background overflow-hidden flex flex-col"
            >
              {activeTab === 'files' && (
                <SessionFilesSection
                  sessionId={sessionId}
                  sessionFolderPath={sessionFolderPath}
                  className="h-full"
                />
              )}
              {activeTab === 'git' && (
                <GitPanel workspacePath={cwdRoot} className="h-full" />
              )}
              {activeTab === 'workspace' && (
                <WorkspaceFilesSection
                  workspaceId={workspaceId}
                  workspacePath={workspacePath}
                  cwdPath={cwdRoot}
                  className="h-full"
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="tab-strip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="shrink-0 flex flex-col items-center bg-background border-l border-border/50"
              style={{
                width: TAB_STRIP_WIDTH,
                paddingTop: PANEL_EDGE_INSET,
                paddingBottom: PANEL_EDGE_INSET,
              }}
            >
              {RIGHT_SIDEBAR_TABS.map(({ id, title, Icon }) => {
                const isActive = activeTab === id

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      'flex items-center justify-center rounded-[6px]',
                      'h-7 w-7 transition-colors',
                      'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring outline-none',
                      isActive
                        ? 'text-foreground bg-sidebar-hover'
                        : 'text-foreground/50 hover:text-foreground hover:bg-sidebar-hover',
                    )}
                    title={title}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
