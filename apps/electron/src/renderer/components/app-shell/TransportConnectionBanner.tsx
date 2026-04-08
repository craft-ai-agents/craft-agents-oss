import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import type { TransportConnectionState } from '../../../shared/types'

export function shouldShowTransportConnectionBanner(state: TransportConnectionState | null): boolean {
  if (!state || state.mode === 'local') return false
  return state.status !== 'connected' && state.status !== 'idle'
}

export interface TransportBannerCopy {
  title: string
  description: string
  showRetry: boolean
  tone: 'warning' | 'error' | 'info'
}

export function getTransportBannerCopy(state: TransportConnectionState, t: any): TransportBannerCopy {
  switch (state.status) {
    case 'connecting':
      return {
        title: t('common.connectingToRemoteServer', 'Connecting to remote server'),
        description: t('common.connectingToUrl', 'Connecting to {url}...', { url: state.url }),
        showRetry: false,
        tone: 'info',
      }

    case 'reconnecting': {
      const retry = state.nextRetryInMs != null 
        ? t('common.retryInMs', 'retry in {ms}ms', { ms: state.nextRetryInMs }) 
        : t('common.retrying', 'retrying')
      return {
        title: t('common.reconnectingToRemoteServer', 'Reconnecting to remote server'),
        description: `${getFailureReason(state, t)} (${retry}, ${t('common.attempt', 'attempt {number}', { number: state.attempt })})`,
        showRetry: true,
        tone: 'warning',
      }
    }

    case 'failed':
      return {
        title: t('common.cannotConnectToRemoteServer', 'Cannot connect to remote server'),
        description: getFailureReason(state, t),
        showRetry: true,
        tone: 'error',
      }

    case 'disconnected':
      return {
        title: t('common.connectionToRemoteServerLost', 'Connection to remote server lost'),
        description: getFailureReason(state, t),
        showRetry: true,
        tone: 'warning',
      }

    default:
      return {
        title: t('common.remoteServerConnectionStatus', 'Remote server connection status'),
        description: getFailureReason(state, t),
        showRetry: true,
        tone: 'info',
      }
  }
}

function getFailureReason(state: TransportConnectionState, t: any): string {
  const err = state.lastError
  if (err) {
    if (err.kind === 'auth') return t('common.authenticationFailed', 'Authentication failed. Verify CRAFT_SERVER_TOKEN.')
    if (err.kind === 'protocol') return t('common.protocolMismatch', 'Protocol mismatch between client and server versions.')
    if (err.kind === 'timeout') return t('common.connectionToUrlTimedOut', 'Connection to {url} timed out. Server may be unreachable.', { url: state.url })
    if (err.kind === 'network') return t('common.couldNotConnectToUrl', 'Could not connect to {url}. Is the remote server running?', { url: state.url })
    return err.message
  }

  if (state.lastClose?.code != null) {
    const reason = state.lastClose.reason ? ` (${state.lastClose.reason})` : ''
    return t('common.webSocketClosedWithCode', 'WebSocket closed with code {code}{reason}.', { code: state.lastClose.code, reason })
  }

  return t('common.waitingForRemoteServerConnection', 'Waiting for remote server connection.')
}

export function TransportConnectionBanner({
  state,
  onRetry,
}: {
  state: TransportConnectionState
  onRetry: () => void
}) {
  const { t } = useTranslations()
  const copy = getTransportBannerCopy(state, t)

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
            {t('common.retry', 'Retry')}
          </Button>
        )}
      </div>
    </div>
  )
}
