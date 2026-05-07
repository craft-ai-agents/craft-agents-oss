import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Files, GitBranch, ChevronRight, FolderTree } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { sessionAtomFamily } from '@/atoms/sessions'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { SessionFilesSection } from './SessionFilesSection'
import { GitPanel } from './GitPanel'
import { WorkspaceFilesSection } from './WorkspaceFilesSection'
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

export interface RightSidebarPanelProps {
  /** Active workspace ID — scopes localStorage persistence */
  workspaceId?: string
  /** Focused session ID — passed to SessionFilesSection */
  sessionId?: string
}

export function RightSidebarPanel({
  workspaceId,
  sessionId,
}: RightSidebarPanelProps) {
  const focusedSession = useAtomValue(sessionAtomFamily(sessionId ?? ''))
  const activeWorkspace = useActiveWorkspace()
  const sessionFolderPath = focusedSession?.sessionFolderPath
  const workspacePath = activeWorkspace?.rootPath
  const [isOpen, setIsOpen] = useState<boolean>(() =>
    storage.get(storage.KEYS.rightSidebarVisible, true, workspaceId)
  )
  const [width, setWidth] = useState<number>(() =>
    storage.get(storage.KEYS.rightSidebarWidth, DEFAULT_WIDTH, workspaceId)
  )
  const [activeTab, setActiveTab] = useState<Tab>('files')
  const [sashHandleY, setSashHandleY] = useState<number | null>(null)

  // Tracks current workspaceId so persist effects can write to the correct key
  // without needing workspaceId in their deps (which would cause them to fire on
  // workspace switch before the load effect restores the new workspace's values).
  const workspaceIdRef = useRef(workspaceId)

  // Re-read from storage when workspaceId changes (workspace switch)
  useEffect(() => {
    workspaceIdRef.current = workspaceId
    setIsOpen(storage.get(storage.KEYS.rightSidebarVisible, true, workspaceId))
    setWidth(storage.get(storage.KEYS.rightSidebarWidth, DEFAULT_WIDTH, workspaceId))
  }, [workspaceId])

  useEffect(() => {
    storage.set(storage.KEYS.rightSidebarVisible, isOpen, workspaceIdRef.current)
  }, [isOpen])

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

  const totalWidth = isOpen ? width + TAB_STRIP_WIDTH : TAB_STRIP_WIDTH

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
                <GitPanel workspacePath={workspacePath} className="h-full" />
              )}
              {activeTab === 'workspace' && (
                <WorkspaceFilesSection
                  workspaceId={workspaceId}
                  workspacePath={workspacePath}
                  className="h-full"
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={cn(
            'shrink-0 flex flex-col items-center bg-background',
            isOpen ? 'border-l border-border/50' : '',
          )}
          style={{
            width: TAB_STRIP_WIDTH,
            paddingTop: PANEL_EDGE_INSET,
            paddingBottom: PANEL_EDGE_INSET,
          }}
        >
          <button
            type="button"
            onClick={() => setIsOpen(v => !v)}
            className={cn(
              'mb-2 flex items-center justify-center rounded-[6px]',
              'h-7 w-7 text-foreground/50 hover:text-foreground hover:bg-sidebar-hover',
              'transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring outline-none',
            )}
            title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <motion.div
              initial={false}
              animate={{ rotate: isOpen ? 0 : 180 }}
              transition={SPRING}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </motion.div>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('files'); if (!isOpen) setIsOpen(true) }}
            className={cn(
              'flex items-center justify-center rounded-[6px]',
              'h-7 w-7 transition-colors',
              'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring outline-none',
              activeTab === 'files' && isOpen
                ? 'text-foreground bg-sidebar-hover'
                : 'text-foreground/50 hover:text-foreground hover:bg-sidebar-hover',
            )}
            title="Files"
          >
            <Files className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('git'); if (!isOpen) setIsOpen(true) }}
            className={cn(
              'flex items-center justify-center rounded-[6px]',
              'h-7 w-7 transition-colors',
              'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring outline-none',
              activeTab === 'git' && isOpen
                ? 'text-foreground bg-sidebar-hover'
                : 'text-foreground/50 hover:text-foreground hover:bg-sidebar-hover',
            )}
            title="Git"
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('workspace'); if (!isOpen) setIsOpen(true) }}
            className={cn(
              'flex items-center justify-center rounded-[6px]',
              'h-7 w-7 transition-colors',
              'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring outline-none',
              activeTab === 'workspace' && isOpen
                ? 'text-foreground bg-sidebar-hover'
                : 'text-foreground/50 hover:text-foreground hover:bg-sidebar-hover',
            )}
            title="Workspace"
          >
            <FolderTree className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
