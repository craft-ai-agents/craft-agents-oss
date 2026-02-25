/**
 * PanelSlot
 *
 * Renders a single content panel within the PanelStackContainer.
 * Uses position: sticky for the Matuschak-style pinning behavior.
 *
 * When a panel is the only one (isOnly), it behaves like the original MainContentPanel:
 * flex-grows to fill available space, no sticky positioning.
 *
 * When multiple panels exist, each gets:
 * - position: sticky with left: leftOffset (computed by PanelStackContainer)
 * - Fixed width of panelWidth
 *
 * Each PanelSlot overrides AppShellContext to inject a per-panel close button
 * into PanelHeader's rightSidebarButton slot:
 * - Primary panel: close = navigate to parent route (clears selection in navigator)
 * - Secondary panels: close = remove panel from stack
 */

import { useCallback, useMemo } from 'react'
import { useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { routes } from '../../../shared/routes'
import {
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
} from '../../../shared/types'
import type { NavigationState } from '../../../shared/types'
import { closePanelAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { useNavigation } from '@/contexts/NavigationContext'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { PEEK_WIDTH, type PanelScrollState } from '@/hooks/usePanelScrollStates'
import { ObscuredLabel } from './ObscuredLabel'
import { MainContentPanel } from './MainContentPanel'

interface PanelSlotProps {
  entry: PanelStackEntry
  state: PanelScrollState
  isPrimary: boolean
  isOnly: boolean
  isLast: boolean
  isFocusedMode: boolean
  isRightSidebarVisible?: boolean
  /** Sticky left offset (computed by PanelStackContainer based on all panels) */
  leftOffset: number
  /** Panel width in pixels */
  panelWidth: number
  /** Z-index for stacking order (ascending: sidebar < navigator < content) */
  zIndex?: number
}

/**
 * Derive a human-readable title from a NavigationState for the obscured label.
 */
function getPanelTitle(navState: NavigationState | null): string {
  if (!navState) return 'Panel'

  if (isSettingsNavigation(navState)) {
    return `Settings`
  }

  if (isSourcesNavigation(navState)) {
    if (navState.details) return navState.details.sourceSlug
    return 'Sources'
  }

  if (isSkillsNavigation(navState)) {
    if (navState.details?.type === 'skill') return navState.details.skillSlug
    return 'Skills'
  }

  if (isSessionsNavigation(navState)) {
    if (navState.details) return 'Session'
    switch (navState.filter.kind) {
      case 'allSessions': return 'All Sessions'
      case 'flagged': return 'Flagged'
      case 'archived': return 'Archived'
      case 'state': return 'State'
      case 'label': return 'Label'
      case 'view': return 'View'
    }
  }

  return 'Panel'
}

/**
 * Get the list route (without details) for the primary panel close action.
 */
function getParentRoute(navState: NavigationState | null): string | null {
  if (!navState) return null

  if (isSessionsNavigation(navState) && navState.details) {
    switch (navState.filter.kind) {
      case 'allSessions': return routes.view.allSessions()
      case 'flagged': return routes.view.flagged()
      case 'archived': return routes.view.archived()
      case 'state': return routes.view.state(navState.filter.stateId)
      case 'label': return routes.view.label(navState.filter.labelId)
      case 'view': return routes.view.view(navState.filter.viewId)
    }
  }

  if (isSourcesNavigation(navState) && navState.details) {
    return routes.view.sources(navState.filter ? { type: navState.filter.sourceType } : undefined)
  }

  if (isSkillsNavigation(navState) && navState.details) {
    return routes.view.skills()
  }

  return null
}

export function PanelSlot({
  entry,
  state,
  isPrimary,
  isOnly,
  isLast,
  isFocusedMode,
  isRightSidebarVisible,
  leftOffset,
  panelWidth,
  zIndex,
}: PanelSlotProps) {
  const closePanel = useSetAtom(closePanelAtom)
  const { navigate } = useNavigation()
  const parentContext = useAppShellContext()
  const navState = parseRouteToNavigationState(entry.route)
  const title = getPanelTitle(navState)
  const parentRoute = isPrimary ? getParentRoute(navState) : null

  const handleClose = useCallback(() => {
    if (isPrimary && parentRoute) {
      navigate(parentRoute as any)
    } else {
      closePanel(entry.id)
    }
  }, [isPrimary, parentRoute, navigate, closePanel, entry.id])

  // Build close button for PanelHeader (via context override)
  // Primary: shown when there's a selection to clear
  // Secondary: always shown
  const showCloseButton = isPrimary ? !!parentRoute : true
  const closeButton = useMemo(() => {
    if (!showCloseButton) return null
    return (
      <HeaderIconButton
        icon={<X className="h-4 w-4" />}
        onClick={handleClose}
        tooltip="Close"
        className="text-foreground"
      />
    )
  }, [showCloseButton, handleClose])

  // Override AppShellContext so ChatPage/PanelHeader gets our per-panel close button
  const contextOverride = useMemo(() => ({
    ...parentContext,
    rightSidebarButton: closeButton,
  }), [parentContext, closeButton])

  return (
    <motion.div
      layout={false}
      initial={isPrimary ? false : { opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15, ease: [0.19, 1, 0.22, 1] }}
      className={cn(
        'h-full overflow-hidden relative',
        !isOnly && 'shrink-0',
        'bg-foreground-2',
        state === 'overlay' ? 'shadow-strong' : 'shadow-middle',
        !isOnly && !isPrimary && 'border-l border-foreground/5',
      )}
      style={{
        // Single panel: fill all available space (identical to previous layout)
        ...(isOnly
          ? {
              flexGrow: 1,
              minWidth: 0,
              borderTopLeftRadius: isFocusedMode ? 14 : 10,
              borderBottomLeftRadius: isFocusedMode ? 14 : 10,
              borderTopRightRadius: isRightSidebarVisible ? 10 : 14,
              borderBottomRightRadius: isRightSidebarVisible ? 10 : 14,
            }
          : {
              // Multi-panel: sticky positioning with computed offsets
              position: 'sticky',
              top: 0,
              left: leftOffset,
              right: -(panelWidth - PEEK_WIDTH),
              width: panelWidth,
              maxWidth: panelWidth,
              zIndex,
              // Border radius: first panel gets larger left radius, last gets larger right
              borderTopLeftRadius: isPrimary ? (isFocusedMode ? 14 : 10) : 10,
              borderBottomLeftRadius: isPrimary ? (isFocusedMode ? 14 : 10) : 10,
              borderTopRightRadius: isLast ? 14 : 10,
              borderBottomRightRadius: isLast ? 14 : 10,
            }
        ),
      }}
    >
      {/* Obscured label — vertical title shown when panel is pinned */}
      {!isOnly && (
        <ObscuredLabel title={title} visible={state === 'obscured'} />
      )}

      {/* Main content — fades when obscured */}
      <div
        className={cn(
          'h-full flex flex-col',
          'transition-opacity duration-150',
        )}
        style={{ opacity: state === 'obscured' ? 0 : 1 }}
      >
        {/* Override context so each panel gets its own close button in PanelHeader */}
        <AppShellProvider value={contextOverride}>
          <MainContentPanel
            navStateOverride={navState}
            isFocusedMode={isFocusedMode}
          />
        </AppShellProvider>
      </div>
    </motion.div>
  )
}
