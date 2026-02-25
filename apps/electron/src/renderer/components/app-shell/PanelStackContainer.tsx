/**
 * PanelStackContainer
 *
 * Unified horizontal scroll container for ALL panels:
 * Sidebar → Navigator → Content Panel(s).
 *
 * When only one content panel exists and everything fits in the viewport,
 * it looks identical to the previous layout (no scrolling).
 * When content panels are pushed, the entire stack becomes scrollable
 * with position: sticky pinning (Matuschak-style).
 *
 * The right sidebar stays OUTSIDE this container.
 *
 * Layout:
 * - Outer div: overflow-x: auto (scroll parent for sticky panels)
 * - Inner div: display: flex, width = sum of all panel widths
 * - Each panel: position: sticky with staggered left offsets
 */

import { useRef, useEffect, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { motion, AnimatePresence } from 'motion/react'
import { cn } from '@/lib/utils'
import { panelStackAtom } from '@/atoms/panel-stack'
import { usePanelScrollStates, PANEL_WIDTH, PEEK_WIDTH, type PanelScrollState } from '@/hooks/usePanelScrollStates'
import { ObscuredLabel } from './ObscuredLabel'
import { PanelSlot } from './PanelSlot'

/** Spring transition matching AppShell's sidebar/navigator animation */
const PANEL_SPRING = { type: 'spring' as const, stiffness: 600, damping: 49 }

/** Gap between adjacent panels */
const PANEL_GAP = 6

interface PanelStackContainerProps {
  /** Sidebar content (rendered inside a sticky wrapper) */
  sidebarSlot: React.ReactNode
  /** Target sidebar width in pixels (0 when hidden or in focus mode) */
  sidebarWidth: number
  /** Title for the sidebar's obscured label */
  sidebarTitle?: string
  /** Navigator content (rendered inside a sticky wrapper) */
  navigatorSlot: React.ReactNode
  /** Target navigator width in pixels (0 when in focus mode) */
  navigatorWidth: number
  /** Title for the navigator's obscured label */
  navigatorTitle?: string
  /** Whether focused mode is active */
  isFocusedMode: boolean
  /** Whether the right sidebar is visible (affects last panel border radius) */
  isRightSidebarVisible?: boolean
  /** Whether a resize is in progress (disables spring animations) */
  isResizing?: boolean
}

export function PanelStackContainer({
  sidebarSlot,
  sidebarWidth,
  sidebarTitle = 'Sidebar',
  navigatorSlot,
  navigatorWidth,
  navigatorTitle = 'Navigator',
  isFocusedMode,
  isRightSidebarVisible,
  isResizing,
}: PanelStackContainerProps) {
  const panelStack = useAtomValue(panelStackAtom)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(panelStack.length)

  // Count visible structural panels
  const hasSidebar = sidebarWidth > 0
  const hasNavigator = navigatorWidth > 0
  const structuralCount = (hasSidebar ? 1 : 0) + (hasNavigator ? 1 : 0)
  const totalPanelCount = structuralCount + panelStack.length

  // Multi-panel = 2+ content panels (triggers sticky/scroll behavior)
  const isMultiPanel = panelStack.length > 1

  // Effective widths (0 when hidden, otherwise pass through unchanged)
  const effectiveSidebarWidth = hasSidebar ? sidebarWidth : 0
  const effectiveNavigatorWidth = hasNavigator ? navigatorWidth : 0

  // Build panel widths array for scroll state computation
  const panelWidths = useMemo(() => {
    const widths: number[] = []
    if (hasSidebar) widths.push(effectiveSidebarWidth)
    if (hasNavigator) widths.push(effectiveNavigatorWidth)
    for (let i = 0; i < panelStack.length; i++) {
      widths.push(PANEL_WIDTH)
    }
    return widths
  }, [hasSidebar, hasNavigator, effectiveSidebarWidth, effectiveNavigatorWidth, panelStack.length])

  const panelStates = usePanelScrollStates(scrollRef, panelWidths)

  // Sticky left offsets for each panel
  const leftOffsets = useMemo(() => {
    return panelWidths.map((_, i) => i * PEEK_WIDTH)
  }, [panelWidths])

  // Total inner width (multi-panel mode)
  const totalWidth = panelWidths.reduce((sum, w) => sum + w, 0)

  // Auto-scroll to newly pushed content panel
  useEffect(() => {
    if (panelStack.length > prevCountRef.current && scrollRef.current) {
      const targetLeft =
        totalWidth - PANEL_WIDTH -
        (scrollRef.current.clientWidth - PANEL_WIDTH) / 2
      scrollRef.current.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      })
    }
    prevCountRef.current = panelStack.length
  }, [panelStack.length, totalWidth])

  // State indices — structural panels come first
  let stateIdx = 0
  const sidebarStateIdx = hasSidebar ? stateIdx++ : -1
  const navigatorStateIdx = hasNavigator ? stateIdx++ : -1
  const contentStartIdx = stateIdx

  const transition = isResizing ? { duration: 0 } : PANEL_SPRING

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 min-w-0 flex relative z-panel",
        isMultiPanel && "overflow-y-hidden",
      )}
      style={{
        overflowX: isMultiPanel ? 'auto' : undefined,
        // Padding gives room for box-shadows; negative margin collapses it back.
        // pointerEvents: none prevents the padding zone from blocking clicks above/below.
        paddingBlock: isMultiPanel ? 8 : undefined,
        marginBlock: isMultiPanel ? -8 : undefined,
      }}
    >
      {/* Inner flex container — explicit width forces horizontal overflow */}
      <div
        className="flex h-full"
        style={{
          gap: PANEL_GAP,
          ...(isMultiPanel
            ? {
                width: totalWidth,
                transition: isResizing ? undefined : 'width 100ms cubic-bezier(0.19, 1, 0.22, 1)',
              }
            : {
                flexGrow: 1,
                minWidth: 0,
              }
          ),
        }}
      >
        {/* === SIDEBAR SLOT === */}
        <motion.div
          initial={false}
          animate={{
            width: hasSidebar ? (isMultiPanel ? effectiveSidebarWidth : sidebarWidth) : 0,
            opacity: hasSidebar ? 1 : 0,
          }}
          transition={transition}
          className="h-full overflow-hidden relative shrink-0"
          style={{
            ...(isMultiPanel && hasSidebar
              ? {
                  position: 'sticky',
                  top: 0,
                  left: leftOffsets[sidebarStateIdx],
                  right: -(effectiveSidebarWidth - PEEK_WIDTH),
                  zIndex: sidebarStateIdx + 1,
                }
              : {}
            ),
          }}
        >
          {isMultiPanel && hasSidebar && (
            <ObscuredLabel
              title={sidebarTitle}
              visible={panelStates[sidebarStateIdx] === 'obscured'}
            />
          )}
          <div
            className={cn('h-full', isMultiPanel && 'transition-opacity duration-150')}
            style={{
              opacity: isMultiPanel && panelStates[sidebarStateIdx] === 'obscured' ? 0 : 1,
              width: sidebarWidth,
            }}
          >
            {sidebarSlot}
          </div>
        </motion.div>

        {/* === NAVIGATOR SLOT === */}
        <motion.div
          initial={false}
          animate={{
            width: hasNavigator ? (isMultiPanel ? effectiveNavigatorWidth : navigatorWidth) : 0,
            opacity: hasNavigator ? 1 : 0,
          }}
          transition={transition}
          className={cn(
            'h-full overflow-hidden relative shrink-0',
            'bg-background shadow-middle',
            isMultiPanel ? 'rounded-[10px]' : 'rounded-l-[14px] rounded-r-[10px]',
            isMultiPanel && panelStates[navigatorStateIdx] === 'overlay' && 'shadow-strong',
          )}
          style={{
            ...(isMultiPanel && hasNavigator
              ? {
                  position: 'sticky',
                  top: 0,
                  left: leftOffsets[navigatorStateIdx],
                  right: -(effectiveNavigatorWidth - PEEK_WIDTH),
                  zIndex: navigatorStateIdx + 1,
                }
              : {}
            ),
          }}
        >
          {isMultiPanel && hasNavigator && (
            <ObscuredLabel
              title={navigatorTitle}
              visible={panelStates[navigatorStateIdx] === 'obscured'}
            />
          )}
          <div
            className={cn('h-full', isMultiPanel && 'transition-opacity duration-150')}
            style={{
              opacity: isMultiPanel && panelStates[navigatorStateIdx] === 'obscured' ? 0 : 1,
              width: navigatorWidth,
            }}
          >
            {navigatorSlot}
          </div>
        </motion.div>

        {/* === CONTENT PANELS === */}
        <AnimatePresence mode="popLayout">
          {panelStack.map((entry, index) => {
            const globalIdx = contentStartIdx + index
            return (
              <PanelSlot
                key={entry.id}
                entry={entry}
                state={panelStates[globalIdx] ?? 'resting'}
                isPrimary={index === 0}
                isOnly={panelStack.length === 1 && !isMultiPanel}
                isLast={index === panelStack.length - 1}
                isFocusedMode={isFocusedMode}
                isRightSidebarVisible={isRightSidebarVisible}
                leftOffset={leftOffsets[globalIdx] ?? (globalIdx * PEEK_WIDTH)}
                panelWidth={PANEL_WIDTH}
                zIndex={globalIdx + 1}
              />
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
