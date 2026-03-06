import { Button } from '@/components/ui/button'
import type { TransportConnectionState } from '../../../shared/types'

export function shouldShowTransportConnectionBanner(state: TransportConnectionState | null): boolean {
  if (!state) return false
  if (state.mode !== 'remote') return false
  return state.status !== 'connected' && state.status !== 'idle'
}

export interface TransportBannerCopy {
  title: string
  description: string
  showRetry: boolean
  tone: 'warning' | 'error' | 'info'
}

export function getTransportBannerCopy(state: TransportConnectionState): TransportBannerCopy {
  switch (state.status) {
    case 'connecting':
      return {
        title: 'Connecting to remote server',
        description: `Connecting to ${state.url}...`,
        showRetry: false,
        tone: 'info',
      }

    case 'reconnecting': {
      const retry = state.nextRetryInMs != null ? `retry in ${state.nextRetryInMs}ms` : 'retrying'
      return {
        title: 'Reconnecting to remote server',
        description: `${getFailureReason(state)} (${retry}, attempt ${state.attempt})`,
        showRetry: true,
        tone: 'warning',
      }
    }

    case 'failed':
      return {
        title: 'Cannot connect to remote server',
        description: getFailureReason(state),
        showRetry: true,
        tone: 'error',
      }

    case 'disconnected':
      return {
        title: 'Connection to remote server lost',
        description: getFailureReason(state),
        showRetry: true,
        tone: 'warning',
      }

    default:
      return {
        title: 'Remote server connection status',
        description: getFailureReason(state),
        showRetry: true,
        tone: 'info',
      }
  }
}

function getFailureReason(state: TransportConnectionState): string {
  const err = state.lastError
  if (err) {
    if (err.kind === 'auth') return 'Authentication failed. Verify CRAFT_SERVER_TOKEN.'
    if (err.kind === 'protocol') return 'Protocol mismatch between client and server versions.'
    if (err.kind === 'timeout') return 'Connection timed out. Server may be unreachable.'
    if (err.kind === 'network') return 'Network connection failed. Check host, port, and firewall.'
    return err.message
  }

  if (state.lastClose?.code != null) {
    const reason = state.lastClose.reason ? ` (${state.lastClose.reason})` : ''
    return `WebSocket closed with code ${state.lastClose.code}${reason}.`
  }

  return 'Waiting for remote server connection.'
}

export function TransportConnectionBanner({
  state,
  onRetry,
}: {
  state: TransportConnectionState
  onRetry: () => void
}) {
  const copy = getTransportBannerCopy(state)

  const toneClasses = copy.tone === 'error'
    ? 'border-destructive/30 bg-destructive/10 text-destructive'
    : copy.tone === 'warning'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

  return (
    <div className={`shrink-0 border-b px-4 py-2 ${toneClasses}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{copy.title}</p>
          <p className="text-xs opacity-90 truncate">{copy.description}</p>
        </div>
        {copy.showRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0 h-7">
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
