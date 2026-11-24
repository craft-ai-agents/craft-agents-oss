/**
 * The context stack the production session surfaces (ChatDisplay, ChatHeader, SessionList) need to
 * render in the playground against deterministic state:
 * - a fresh Jotai store per demo (no atom bleed across demos), hydrated with the given sessions
 * - NavigationProvider (no-op routes), Focus / Modal / DismissibleLayer / EscapeInterrupt / ActionRegistry
 * - the AppShell context inherited from PlaygroundAppShellProvider, with the demo's overrides
 *
 * Desktop demos pass `compact={false}`; the mobile WebUI demos wrap this as MobilePlaygroundProviders.
 */

import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { useOptionalAppShellContext, AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { FocusProvider } from '@/context/FocusContext'
import { ModalProvider } from '@/context/ModalContext'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { ActionRegistryProvider } from '@/actions/registry'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { sessionMetaMapAtom, sessionAtomFamily, type SessionMeta } from '@/atoms/sessions'
import type { Session } from '../../shared/types'

interface HydrateProps {
  sessions?: SessionMeta[]
  session?: Session
}

/** Writes the mock sessions into the isolated store so atom-driven components render them. */
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

/** The inherited playground AppShell value with `isCompactMode`, the workspace and the demo's overrides. */
function AppShellOverride({
  compact,
  workspaceId,
  workspaceSlug,
  overrides,
  children,
}: {
  compact: boolean
  workspaceId: string
  workspaceSlug: string
  overrides?: Partial<AppShellContextType>
  children: React.ReactNode
}) {
  const parent = useOptionalAppShellContext()
  if (!parent) {
    throw new Error('PlaygroundSessionProviders must be rendered inside PlaygroundAppShellProvider')
  }
  const value = React.useMemo(
    () => ({
      ...parent,
      isCompactMode: compact,
      activeWorkspaceId: workspaceId,
      activeWorkspaceSlug: workspaceSlug,
      ...overrides,
    }),
    [parent, compact, workspaceId, workspaceSlug, overrides],
  )
  return <AppShellProvider value={value}>{children}</AppShellProvider>
}

export interface PlaygroundSessionProvidersProps {
  workspaceId: string
  workspaceSlug: string
  /** Sets `isCompactMode` on the AppShell context */
  compact: boolean
  /** Sessions to populate `sessionMetaMapAtom` with */
  sessions?: SessionMeta[]
  /** A full session to hydrate into `sessionAtomFamily` (for ChatDisplay) */
  session?: Session
  /** Extra AppShell context fields (labels, statuses, handlers, llmConnections, …). Keep it memoized. */
  appShell?: Partial<AppShellContextType>
  /** Builds the session `onCreateSession` resolves to */
  createStubSession: (id: string) => Session
  children: React.ReactNode
}

export function PlaygroundSessionProviders({
  workspaceId,
  workspaceSlug,
  compact,
  sessions,
  session,
  appShell,
  createStubSession,
  children,
}: PlaygroundSessionProvidersProps) {
  // Fresh store per mount: isolates demo state from the playground root.
  const store = React.useMemo(() => createStore(), [])

  const onCreateSession = React.useCallback(
    async (): Promise<Session> => createStubSession('playground-stub-' + Date.now()),
    [createStubSession],
  )

  return (
    <JotaiProvider store={store}>
      <HydrateAtoms sessions={sessions} session={session}>
        <ActionRegistryProvider>
          <DismissibleLayerProvider>
            <ModalProvider>
              <EscapeInterruptProvider>
                <FocusProvider>
                  <NavigationProvider
                    workspaceId={workspaceId}
                    workspaceSlug={workspaceSlug}
                    onCreateSession={onCreateSession}
                    isReady
                    isSessionsReady
                  >
                    <AppShellOverride compact={compact} workspaceId={workspaceId} workspaceSlug={workspaceSlug} overrides={appShell}>
                      {children}
                    </AppShellOverride>
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
