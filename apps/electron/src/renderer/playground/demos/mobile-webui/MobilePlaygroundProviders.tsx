import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { useOptionalAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { sessionMetaMapAtom, sessionAtomFamily, type SessionMeta } from '@/atoms/sessions'
import type { Session } from '../../../../shared/types'
import { MOBILE_WORKSPACE_ID, MOBILE_WORKSPACE_SLUG, buildMockSession } from './mock-mobile-data'

interface HydrateProps {
  sessions?: SessionMeta[]
  session?: Session
}

/**
 * Hydrates the isolated jotai store with mock data so atom-driven components
 * (SessionList, ChatDisplay) render against deterministic state.
 */
function HydrateAtoms({ sessions, session, children }: HydrateProps & { children: React.ReactNode }) {
  const setMetaMap = useSetAtom(sessionMetaMapAtom)
  const setSession = useSetAtom(session ? sessionAtomFamily(session.id) : sessionAtomFamily('__noop__'))

  React.useEffect(() => {
    if (sessions && sessions.length > 0) {
      const map = new Map<string, SessionMeta>()
      for (const meta of sessions) map.set(meta.id, meta)
      setMetaMap(map)
    }
  }, [sessions, setMetaMap])

  React.useEffect(() => {
    if (session) setSession(session)
  }, [session, setSession])

  return <>{children}</>
}

interface MobileAppShellOverrideProps {
  children: React.ReactNode
}

/**
 * Overrides `isCompactMode: true` on the existing AppShell context inherited
 * from PlaygroundAppShellProvider, without rebuilding the full mock value.
 */
function MobileAppShellOverride({ children }: MobileAppShellOverrideProps) {
  const parent = useOptionalAppShellContext()
  if (!parent) {
    throw new Error('MobilePlaygroundProviders must be rendered inside PlaygroundAppShellProvider')
  }
  const value = React.useMemo(
    () => ({
      ...parent,
      isCompactMode: true,
      activeWorkspaceId: MOBILE_WORKSPACE_ID,
      activeWorkspaceSlug: MOBILE_WORKSPACE_SLUG,
    }),
    [parent],
  )
  return <AppShellProvider value={value}>{children}</AppShellProvider>
}

export interface MobilePlaygroundProvidersProps {
  /** Sessions to populate `sessionMetaMapAtom` with. */
  sessions?: SessionMeta[]
  /** Optional full session to hydrate into `sessionAtomFamily` for ChatDisplay. */
  session?: Session
  children: React.ReactNode
}

/**
 * Wraps a mobile-webui demo with the minimum context stack the embedded
 * production components need:
 * - Fresh per-demo Jotai store (no atom bleed across demos)
 * - NavigationProvider (no-op route handlers)
 * - Focus / Modal / DismissibleLayer / EscapeInterrupt / ActionRegistry
 * - AppShell override forcing `isCompactMode: true`
 */
export function MobilePlaygroundProviders({
  sessions,
  session,
  children,
}: MobilePlaygroundProvidersProps) {
  // Fresh store per render — isolates demo state from the playground root.
  const store = React.useMemo(() => createStore(), [])

  const onCreateSession = React.useCallback(async (): Promise<Session> => {
    const stub = buildMockSession('mobile-stub-' + Date.now(), { messages: [] })
    return stub
  }, [])

  return (
    <JotaiProvider store={store}>
      <HydrateAtoms sessions={sessions} session={session}>
        <ActionRegistryProvider>
          <DismissibleLayerProvider>
            <ModalProvider>
              <EscapeInterruptProvider>
                <FocusProvider>
                  <NavigationProvider
                    workspaceId={MOBILE_WORKSPACE_ID}
                    workspaceSlug={MOBILE_WORKSPACE_SLUG}
                    onCreateSession={onCreateSession}
                    isReady
                    isSessionsReady
                  >
                    <MobileAppShellOverride>{children}</MobileAppShellOverride>
                  </NavigationProvider>
                </FocusProvider>
              </EscapeInterruptProvider>
            </ModalProvider>
          </DismissibleLayerProvider>
        </ActionRegistryProvider>
      </HydrateAtoms>
    </JotaiProvider>
  )
}
