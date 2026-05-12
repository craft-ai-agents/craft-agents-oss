import * as React from 'react'
import { SessionList, type ChatGroupingMode } from '@/components/app-shell/SessionList'
import { MobileWebUIFrame, type MobileDevice } from './MobileWebUIFrame'
import { MobilePlaygroundProviders } from './MobilePlaygroundProviders'
import {
  MOCK_SESSIONS,
  MOCK_LABELS,
  MOCK_SESSION_STATUSES,
  MOBILE_WORKSPACE_ID,
} from './mock-mobile-data'

const log = (label: string) => (...args: unknown[]) => {
  console.log(`[Mobile SessionList] ${label}`, args)
}

interface SessionListMobilePreviewProps {
  device?: MobileDevice
  showBezel?: boolean
  /** How sessions are grouped in the list. */
  groupingMode?: ChatGroupingMode
  /** Activate the search header. */
  searchActive?: boolean
  /** Initial search query for the header. */
  searchQuery?: string
  /** When true, render an empty session list (exercises the empty state). */
  empty?: boolean
}

/**
 * Renders the production SessionList in compact mode with a curated set of
 * mock sessions. Exercises the new `groupByUnread` path alongside the
 * existing 'date' / 'status' modes.
 */
export function SessionListMobilePreview({
  device = 'iphone-15',
  showBezel = true,
  groupingMode = 'date',
  searchActive = false,
  searchQuery = '',
  empty = false,
}: SessionListMobilePreviewProps) {
  const items = empty ? [] : MOCK_SESSIONS
  const [query, setQuery] = React.useState(searchQuery)

  React.useEffect(() => setQuery(searchQuery), [searchQuery])

  return (
    <MobilePlaygroundProviders sessions={items}>
      <MobileWebUIFrame device={device} showBezel={showBezel}>
        <div className="flex flex-col h-full bg-background">
          <SessionList
            items={items}
            onDelete={async (id) => {
              console.log('[Mobile SessionList] onDelete', id)
              return true
            }}
            onFlag={log('onFlag')}
            onUnflag={log('onUnflag')}
            onArchive={log('onArchive')}
            onUnarchive={log('onUnarchive')}
            onMarkUnread={log('onMarkUnread')}
            onSessionStatusChange={log('onSessionStatusChange')}
            onRename={log('onRename')}
            onFocusChatInput={log('onFocusChatInput')}
            onSessionSelect={log('onSessionSelect')}
            onOpenInNewWindow={log('onOpenInNewWindow')}
            onNavigateToView={log('onNavigateToView')}
            searchActive={searchActive}
            searchQuery={query}
            onSearchChange={setQuery}
            onSearchClose={() => setQuery('')}
            sessionStatuses={MOCK_SESSION_STATUSES}
            labels={MOCK_LABELS}
            onLabelsChange={log('onLabelsChange')}
            groupingMode={groupingMode}
            workspaceId={MOBILE_WORKSPACE_ID}
          />
        </div>
      </MobileWebUIFrame>
    </MobilePlaygroundProviders>
  )
}
