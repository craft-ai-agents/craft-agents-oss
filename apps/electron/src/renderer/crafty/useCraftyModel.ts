import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSessionConnectionUnavailable, type LlmConnectionWithStatus } from '@config/llm-connections'
import { DEFAULT_THINKING_LEVEL, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import * as storage from '@/lib/local-storage'
import type { ComposerModelMenuProps } from '@/components/app-shell/input/ComposerModelMenu'
import { useModelPickerState } from '@/components/app-shell/input/useModelPickerState'
import { useModelVisionToggle } from '@/components/app-shell/input/useModelVisionToggle'
import type { CraftyCreateSessionResult, CraftySessionModel } from '../../shared/crafty'
import { resolveCraftyModel, sessionOptionsFor, usableChoice, type CraftyDefaults } from './model-choice'

const NO_CONNECTIONS: LlmConnectionWithStatus[] = []

export type CraftyModelMenuProps = Omit<ComposerModelMenuProps, 'open' | 'onOpenChange' | 'modal'>

/**
 * The panel's model menu, as in any session: before the first question it decides what the
 * session is created with; after, it changes the session (its connection is fixed by then).
 * The last pick is remembered on this device. Rules: `model-choice.ts`.
 */
export function useCraftyModel({ workspaceId, invocationId, session, rememberPicks, onSessionChange }: {
  workspaceId: string | null
  /** Re-read on every invocation: sign-ins and Settings change while the window stays warm. */
  invocationId: string | null
  /** The session the menu changes: the one the panel created, or an existing target. */
  session: CraftyCreateSessionResult | null
  /** False for an existing target: a change there is that session's, not the next new session's. */
  rememberPicks: boolean
  onSessionChange: (change: CraftySessionModel) => void
}): {
  /** Null until the connections have loaded. */
  menu: CraftyModelMenuProps | null
  /** `createSession`'s options for the first question. */
  sessionOptions: () => CraftySessionModel
} {
  const [connections, setConnections] = useState<LlmConnectionWithStatus[] | null>(null)
  const [defaults, setDefaults] = useState<CraftyDefaults>({ thinkingLevel: DEFAULT_THINKING_LEVEL })
  const [choice, setChoice] = useState<CraftySessionModel>(() => storage.get(storage.KEYS.craftyModelChoice, {}))

  const refresh = useCallback(async () => {
    try {
      const [list, settings, appThinking] = await Promise.all([
        window.electronAPI.listLlmConnectionsWithStatus(),
        workspaceId ? window.electronAPI.getWorkspaceSettings(workspaceId) : Promise.resolve(null),
        window.electronAPI.getDefaultThinkingLevel().catch(() => DEFAULT_THINKING_LEVEL),
      ])
      setConnections(list)
      setDefaults({
        connection: settings?.defaultLlmConnection,
        model: settings?.model,
        thinkingLevel: settings?.thinkingLevel ?? appThinking,
      })
    } catch (error) {
      console.warn('[crafty] could not load the connections', error)
    }
  }, [workspaceId])

  useEffect(() => { void refresh() }, [refresh, invocationId])
  useEffect(() => window.electronAPI.onLlmConnectionsChanged(() => void refresh()), [refresh])

  const llmConnections = connections ?? NO_CONNECTIONS
  const usable = useMemo(() => usableChoice(choice, llmConnections), [choice, llmConnections])
  const resolved = useMemo(
    () => resolveCraftyModel({ connections: llmConnections, defaults, choice: usable, session }),
    [defaults, llmConnections, session, usable],
  )
  const connectionUnavailable = !!session && isSessionConnectionUnavailable(session.llmConnection, llmConnections)

  const picker = useModelPickerState({
    llmConnections,
    workspaceDefaultConnection: defaults.connection,
    currentConnection: resolved.connection,
    currentModel: resolved.model,
    isEmptySession: !session,
    connectionUnavailable,
  })
  const onToggleVision = useModelVisionToggle({ llmConnections, refresh })

  const remember = useCallback((next: CraftySessionModel) => {
    if (!rememberPicks) return
    setChoice(next)
    storage.set(storage.KEYS.craftyModelChoice, next)
  }, [rememberPicks])

  const onModelChange = useCallback((model: string, connection?: string) => {
    const llmConnection = connection ?? picker.effectiveConnection
    remember({ ...usable, llmConnection, model })
    if (!session) return
    void window.electronAPI.setSessionModel(session.sessionId, session.workspaceId, model, llmConnection)
    onSessionChange({ llmConnection, model })
  }, [onSessionChange, picker.effectiveConnection, remember, session, usable])

  const onThinkingLevelChange = useCallback((level: ThinkingLevel) => {
    remember({ ...usable, thinkingLevel: level })
    if (!session) return
    void window.electronAPI.sessionCommand(session.sessionId, { type: 'setThinkingLevel', level })
    onSessionChange({ thinkingLevel: level })
  }, [onSessionChange, remember, session, usable])

  // Before the connections load, nothing was validated: the defaults apply, and the menu shows
  // what the session really got once it exists
  const sessionOptions = useCallback(
    () => (connections ? sessionOptionsFor(usable, resolved) : {}),
    [connections, resolved, usable],
  )

  const menu: CraftyModelMenuProps | null = connections && connections.length > 0
    ? {
        ...picker,
        llmConnections,
        connectionUnavailable,
        currentModel: resolved.model,
        isEmptySession: !session,
        onModelChange,
        onToggleVision,
        thinkingLevel: resolved.thinkingLevel,
        onThinkingLevelChange,
      }
    : null

  return { menu, sessionOptions }
}
