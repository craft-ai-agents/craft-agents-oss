import * as React from 'react'
import { AppMenu } from '@/components/AppMenu'
import { MobileWebUIFrame, type MobileDevice } from './MobileWebUIFrame'
import { MobilePlaygroundProviders } from './MobilePlaygroundProviders'

const log = (label: string) => () => console.log(`[Mobile AppMenu] ${label}`)

interface AppMenuMobilePreviewProps {
  /** Device frame size. */
  device?: MobileDevice
  /** Show the iPhone-style bezel + status-bar strip. */
  showBezel?: boolean
}

/**
 * Renders the production AppMenu inside a phone-shaped frame. The Craft logo
 * acts as the dropdown/sheet trigger — same component TopBar uses, with
 * compact-mode behavior enabled via the AppShell context override.
 */
export function AppMenuMobilePreview({
  device = 'iphone-15',
  showBezel = true,
}: AppMenuMobilePreviewProps) {
  return (
    <MobilePlaygroundProviders>
      <MobileWebUIFrame device={device} showBezel={showBezel}>
        <div className="flex flex-col h-full">
          {/* Faux TopBar so the Craft logo trigger sits in a recognisable strip */}
          <div className="h-11 shrink-0 px-2 flex items-center border-b border-border bg-background">
            <AppMenu
              onNewChat={log('onNewChat')}
              onNewWindow={log('onNewWindow')}
              onOpenSettings={log('onOpenSettings')}
              onOpenSettingsSubpage={(id) => console.log('[Mobile AppMenu] onOpenSettingsSubpage', id)}
              onOpenKeyboardShortcuts={log('onOpenKeyboardShortcuts')}
              onOpenStoredUserPreferences={log('onOpenStoredUserPreferences')}
              onToggleSidebar={log('onToggleSidebar')}
              onToggleFocusMode={log('onToggleFocusMode')}
            />
          </div>
          <div className="flex-1 flex items-start justify-center pt-12">
            <p className="text-xs text-muted-foreground/70 px-6 text-center">
              Tap the Craft logo (top-left) to open the menu.<br />
              Settings &amp; Help open as full-screen sub-pages in compact mode.
            </p>
          </div>
        </div>
      </MobileWebUIFrame>
    </MobilePlaygroundProviders>
  )
}
