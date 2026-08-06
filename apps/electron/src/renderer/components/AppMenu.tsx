import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { DesktopAppMenu } from './app-menu/DesktopAppMenu'
import { MobileAppMenu } from './app-menu/MobileAppMenu'
import type { AppMenuProps } from './app-menu/types'

export type { AppMenuProps }

/**
 * AppMenu — Craft logo trigger + dropdown/sheet for the top bar.
 *
 * Routes between the desktop dropdown and the mobile full-screen sheet based on
 * `AppShellContext.isCompactMode` (panel width < 768px). When the context is
 * unavailable (e.g. unit tests outside the shell), defaults to the desktop shape.
 *
 * Back/forward nav buttons live in `TopBar.tsx`, not here.
 */
export function AppMenu(props: AppMenuProps) {
  const ctx = useOptionalAppShellContext()
  const isCompact = !!ctx?.isCompactMode
  return isCompact ? <MobileAppMenu {...props} /> : <DesktopAppMenu {...props} />
}
