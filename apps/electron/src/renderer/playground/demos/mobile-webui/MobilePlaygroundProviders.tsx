import * as React from 'react'
import type { SessionMeta } from '@/atoms/sessions'
import type { LlmConnectionWithStatus } from '@config/llm-connections'
import type { Session } from '../../../../shared/types'
import { PlaygroundSessionProviders } from '../../PlaygroundSessionProviders'
import { MOBILE_WORKSPACE_ID, MOBILE_WORKSPACE_SLUG, buildMockSession } from './mock-mobile-data'

export interface MobilePlaygroundProvidersProps {
  /** Sessions to populate `sessionMetaMapAtom` with. */
  sessions?: SessionMeta[]
  /** Optional full session to hydrate into `sessionAtomFamily` for ChatDisplay. */
  session?: Session
  /** Mock LLM connections (overrides the empty default from PlaygroundAppShellProvider). */
  llmConnections?: LlmConnectionWithStatus[]
  children: React.ReactNode
}

const createStubSession = (id: string) => buildMockSession(id, { messages: [] })

/**
 * The playground session providers on the mobile workspace, with `isCompactMode: true` and,
 * optionally, mock `llmConnections` for demos that exercise the model picker.
 */
export function MobilePlaygroundProviders({ sessions, session, llmConnections, children }: MobilePlaygroundProvidersProps) {
  const appShell = React.useMemo(() => (llmConnections ? { llmConnections } : undefined), [llmConnections])
  return (
    <PlaygroundSessionProviders
      workspaceId={MOBILE_WORKSPACE_ID}
      workspaceSlug={MOBILE_WORKSPACE_SLUG}
      compact
      sessions={sessions}
      session={session}
      appShell={appShell}
      createStubSession={createStubSession}
    >
      {children}
    </PlaygroundSessionProviders>
  )
}
