/**
 * PanelSlot
 *
 * Renders a single content panel within the PanelStackContainer.
 *
 * Each PanelSlot overrides AppShellContext to inject per-panel header state
 * such as the compact back button and focused-panel metadata.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ChevronLeft } from 'lucide-react'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../../../shared/route-parser'
import type { NavigationState } from '../../../shared/types'
import type { Route } from '../../../shared/routes'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { navigate } from '@/lib/navigate'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'
import { PANEL_MIN_WIDTH, RADIUS_EDGE, RADIUS_INNER } from './panel-constants'
import { createPanelSlotHeaderContext } from './panel-slot-header-context'

interface PanelSlotProps {
  entry: PanelStackEntry
  isOnly: boolean
  isFocusedPanel: boolean
  isSidebarAndNavigatorHidden: boolean
  /** Whether this panel's left corners touch the window edge (no sidebar/navigator before it) */
  isAtLeftEdge: boolean
  /** Whether this panel's right corners touch the window edge (no right sidebar after it) */
  isAtRightEdge: boolean
  /** Compact (mobile) mode — shows back button in panel header */
  isCompact?: boolean
}

function getNavigatorRoute(navState: NavigationState): ReturnType<typeof buildRouteFromNavigationState> {
  switch (navState.navigator) {
    case 'sessions':
    case 'sources':
    case 'local-skills':
    case 'automations':
    case 'archived':
      return buildRouteFromNavigationState({ ...navState, details: null } as NavigationState)
    case 'settings':
    case 'admin':
      return buildRouteFromNavigationState({ ...navState, subpage: null } as NavigationState)
    case 'skill-marketplace':
      return buildRouteFromNavigationState(navState)
  }
}

export function PanelSlot({
  entry,
  isOnly,
  isFocusedPanel,
  isSidebarAndNavigatorHidden,
  isAtLeftEdge,
  isAtRightEdge,
  isCompact,
}: PanelSlotProps) {
  const { t } = useTranslation()
  const parentContext = useAppShellContext()
  const navState = parseRouteToNavigationState(entry.route)

  const handleBack = useCallback(() => {
    if (!navState) return
    navigate(getNavigatorRoute(navState) as Route, { skipAutoSelect: true })
  }, [navState])

  // Build back button for compact mode — returns to the navigator list.
  const backButton = useMemo(() => {
    if (!isCompact) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={handleBack}
        tooltip={t("common.backToList")}
      />
    )
  }, [isCompact, handleBack, t])

  // Override AppShellContext so ChatPage/PanelHeader gets our per-panel back
  // button (compact mode) and isFocusedPanel for input field appearance.
  const contextOverride = useMemo(
    () => createPanelSlotHeaderContext(parentContext, {
      leadingAction: backButton,
      isFocusedPanel,
    }),
    [parentContext, backButton, isFocusedPanel],
  )

  return (
      <div
        data-panel-role="content"
        data-compact={isCompact || undefined}
        className={cn(
          'h-full overflow-hidden relative @container/panel',
          !isOnly && isFocusedPanel ? 'shadow-panel-focused z-[1]' : 'shadow-middle z-0',
          'bg-foreground-3',
        )}
        style={{
          // Kept for callers that deliberately render an unfocused panel slot.
          ...(!isFocusedPanel && !isOnly
            ? {
                '--background': 'var(--background-elevated)',
                '--shadow-minimal': 'var(--shadow-minimal-flat)',
                '--user-message-bubble': 'var(--user-message-bubble-dimmed)',
              } as React.CSSProperties
            : {}
          ),
          // Corner radii: edge corners (touching window boundary) vs interior corners.
          // Compact mode panels run flush to the viewport floor — no rounded bottom.
          borderTopLeftRadius: RADIUS_INNER,
          borderBottomLeftRadius: isCompact ? 0 : (isAtLeftEdge ? RADIUS_EDGE : RADIUS_INNER),
          borderTopRightRadius: RADIUS_INNER,
          borderBottomRightRadius: isCompact ? 0 : (isAtRightEdge ? RADIUS_EDGE : RADIUS_INNER),
          ...(isOnly
            ? { flexGrow: 1, minWidth: 0 }
            : { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: PANEL_MIN_WIDTH }
          ),
        }}
      >
        <div className="h-full flex flex-col">
          <AppShellProvider value={contextOverride}>
            <MainContentPanel
              navStateOverride={navState}
              isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
            />
          </AppShellProvider>
        </div>
      </div>
  )
}
