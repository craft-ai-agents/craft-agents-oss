import * as React from 'react'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import type { Message } from '@craft-agent/core/types'
import type { PermissionMode } from '../../../../shared/types'
import { MobileWebUIFrame, type MobileDevice } from './MobileWebUIFrame'
import { MobilePlaygroundProviders } from './MobilePlaygroundProviders'
import {
  MOCK_MESSAGES,
  MOCK_LABELS,
  MOCK_SESSION_STATUSES,
  MOCK_SOURCES,
  MOCK_SKILLS,
  MOBILE_WORKSPACE_ID,
  buildMockSession,
} from './mock-mobile-data'

const log = (label: string) => (...args: unknown[]) => {
  console.log(`[Mobile ChatDisplay] ${label}`, args)
}

type MessageCount = '1' | '5' | '20'

interface ChatDisplayMobilePreviewProps {
  device?: MobileDevice
  showBezel?: boolean
  /** Number of messages to show. '1' = single user msg, '5' = full thread, '20' = scroll test */
  messageCount?: MessageCount
  /** Show the last assistant turn as still streaming. */
  streaming?: boolean
  /** Initial permission mode for the inline badge. */
  permissionMode?: PermissionMode
}

const DEMO_SESSION_ID = 'mobile-chat-demo'

/**
 * Builds a message slice scaled by `messageCount` so the demo can exercise
 * single-message empty-feel, normal threads, and long scrollable threads.
 */
function buildMessages(count: MessageCount, streaming: boolean): Message[] {
  if (count === '1') {
    return [MOCK_MESSAGES[0]]
  }
  if (count === '5') {
    const base = MOCK_MESSAGES.slice(0, 4)
    if (!streaming) return base
    return [
      ...base.slice(0, -1),
      {
        ...base[base.length - 1],
        id: 'm-streaming',
        content: 'Trying to reproduce on iOS 17.4… ',
        isStreaming: true,
      },
    ]
  }
  // '20': cycle the base messages with new ids and timestamps
  const out: Message[] = []
  for (let i = 0; i < 20; i++) {
    const base = MOCK_MESSAGES[i % MOCK_MESSAGES.length]
    out.push({
      ...base,
      id: `${base.id}-loop-${i}`,
      timestamp: (base.timestamp ?? Date.now()) - (20 - i) * 60_000,
    })
  }
  if (streaming) {
    const last = out[out.length - 1]
    out[out.length - 1] = { ...last, isStreaming: true, content: last.content + ' …' }
  }
  return out
}

export function ChatDisplayMobilePreview({
  device = 'iphone-15',
  showBezel = true,
  messageCount = '5',
  streaming = false,
  permissionMode = 'ask',
}: ChatDisplayMobilePreviewProps) {
  const [model, setModel] = React.useState('haiku')
  const [mode, setMode] = React.useState<PermissionMode>(permissionMode)
  const [input, setInput] = React.useState('')

  React.useEffect(() => setMode(permissionMode), [permissionMode])

  const messages = React.useMemo(
    () => buildMessages(messageCount, streaming),
    [messageCount, streaming],
  )

  const session = React.useMemo(
    () =>
      buildMockSession(DEMO_SESSION_ID, {
        messages,
        isProcessing: streaming,
      }),
    [messages, streaming],
  )

  return (
    <MobilePlaygroundProviders session={session}>
      <MobileWebUIFrame device={device} showBezel={showBezel}>
        <div className="flex flex-col h-full bg-background">
          <ChatDisplay
            session={session}
            onSendMessage={log('onSendMessage')}
            onOpenFile={log('onOpenFile')}
            onOpenUrl={log('onOpenUrl')}
            currentModel={model}
            onModelChange={setModel}
            permissionMode={mode}
            onPermissionModeChange={setMode}
            inputValue={input}
            onInputChange={(v) => setInput(v)}
            sources={MOCK_SOURCES}
            onSourcesChange={log('onSourcesChange')}
            skills={MOCK_SKILLS}
            labels={MOCK_LABELS}
            onLabelsChange={log('onLabelsChange')}
            sessionStatuses={MOCK_SESSION_STATUSES}
            onSessionStatusChange={log('onSessionStatusChange')}
            workspaceId={MOBILE_WORKSPACE_ID}
          />
        </div>
      </MobileWebUIFrame>
    </MobilePlaygroundProviders>
  )
}
