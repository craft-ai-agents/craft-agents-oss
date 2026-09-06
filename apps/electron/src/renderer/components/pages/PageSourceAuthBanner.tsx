import * as React from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@craft-agent/ui'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { LoadedPage } from '@craft-agent/shared/pages/types'
import type { LoadedSource } from '../../../shared/types'

/**
 * Trusted-chrome reconnect banner: when a source this page holds grants on
 * needs authentication, offer the fix right here instead of a dead button.
 *
 * Strictly state-driven — rows derive from the workspace's source configs
 * (`deriveConnectionStatus`), never from anything the sandboxed page says,
 * so a page cannot trigger, spoof, or spam an auth prompt. Rows clear
 * automatically when reauthentication lands (`sources:changed` → props).
 */

interface PageSourceAuthBannerProps {
  workspaceId: string
  page: LoadedPage
  /** Live workspace sources (AppShellContext.enabledSources — actually ALL sources) */
  sources: LoadedSource[]
  className?: string
}

type ReconnectFlavor = 'oauth' | 'secret' | 'agent'

/**
 * How this source gets reconnected from here:
 * - oauth  → browser flow via performOAuth, inline
 * - secret → one credential value, saved inline (bearer / single header / query)
 * - agent  → multi-field auth (basic, multi-header) — hand off to a chat,
 *            where the full credential form already exists
 */
function reconnectFlavor(config: LoadedSource['config']): ReconnectFlavor {
  if (config.mcp?.authType === 'oauth' || config.api?.authType === 'oauth') return 'oauth'
  const api = config.api
  if (api?.authType === 'basic') return 'agent'
  if (api?.authType === 'header' && (api.headerNames?.length ?? 0) > 1) return 'agent'
  return 'secret'
}

/** Sources this page's grants depend on (stale grants included — the page will re-request them). */
function grantedSourceSlugs(page: LoadedPage): Set<string> {
  const slugs = new Set<string>()
  for (const grant of page.config.grants ?? []) {
    if (grant.action.kind === 'api' || grant.action.kind === 'mcp') {
      slugs.add(grant.action.sourceSlug)
    }
  }
  return slugs
}

export function PageSourceAuthBanner({ workspaceId, page, sources, className }: PageSourceAuthBannerProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [busySlug, setBusySlug] = React.useState<string | null>(null)
  const [credentialTarget, setCredentialTarget] = React.useState<LoadedSource | null>(null)

  const needing = React.useMemo(() => {
    const granted = grantedSourceSlugs(page)
    if (granted.size === 0) return []
    return sources.filter(
      source =>
        granted.has(source.config.slug) &&
        source.config.enabled !== false &&
        deriveConnectionStatus(source) === 'needs_auth',
    )
  }, [page, sources])

  const handleOAuth = React.useCallback(async (source: LoadedSource) => {
    const slug = source.config.slug
    setBusySlug(slug)
    try {
      const result = await window.electronAPI.performOAuth({ sourceSlug: slug })
      if (!result.success) {
        toast.error(t('toast.pageSourceReconnectFailed', { name: source.config.name }), {
          description: result.error,
        })
      }
    } catch (err) {
      toast.error(t('toast.pageSourceReconnectFailed', { name: source.config.name }), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusySlug(null)
    }
  }, [t])

  const handleReconnect = React.useCallback((source: LoadedSource) => {
    const flavor = reconnectFlavor(source.config)
    if (flavor === 'oauth') {
      void handleOAuth(source)
    } else if (flavor === 'secret') {
      setCredentialTarget(source)
    } else {
      navigate(routes.action.newSession({
        input: t('pages.auth.fixWithAgentPrompt', { name: source.config.name }),
      }))
    }
  }, [handleOAuth, navigate, t])

  if (needing.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3', className)}>
      {needing.map(source => {
        const flavor = reconnectFlavor(source.config)
        return (
          <div key={source.config.slug} className="flex items-center gap-2.5">
            <SourceAvatar source={source} size="sm" />
            <span className="min-w-0 flex-1 text-xs text-foreground/70">
              {t('pages.auth.sourceNeedsReconnect', { name: source.config.name })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={busySlug !== null}
              onClick={() => handleReconnect(source)}
            >
              {busySlug === source.config.slug && <Spinner className="text-xs" />}
              {busySlug === source.config.slug
                ? t('pages.auth.reconnecting')
                : flavor === 'agent'
                  ? t('pages.auth.fixWithAgent')
                  : t('pages.auth.reconnect')}
            </Button>
          </div>
        )
      })}

      <ReconnectCredentialDialog
        workspaceId={workspaceId}
        source={credentialTarget}
        onClose={() => setCredentialTarget(null)}
      />
    </div>
  )
}

/**
 * Single-value credential entry (API key / bearer token / header value).
 * Saving goes through sources:saveCredentials, which stores the credential
 * encrypted and clears the source's needs_auth state.
 */
function ReconnectCredentialDialog({
  workspaceId,
  source,
  onClose,
}: {
  workspaceId: string
  source: LoadedSource | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Reset the field whenever a new source becomes the target.
  React.useEffect(() => {
    setValue('')
    setSaving(false)
  }, [source?.config.slug])

  const handleSave = React.useCallback(async () => {
    if (!source || value.trim().length === 0) return
    setSaving(true)
    try {
      await window.electronAPI.saveSourceCredentials(workspaceId, source.config.slug, value.trim())
      onClose()
    } catch (err) {
      toast.error(t('toast.pageSourceReconnectFailed', { name: source.config.name }), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }, [source, value, workspaceId, onClose, t])

  const headerName = source?.config.api?.authType === 'header' ? source.config.api.headerName : undefined

  return (
    <Dialog open={source !== null} onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            {t('pages.auth.credentialTitle', { name: source?.config.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('pages.auth.credentialDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm">
            {t('pages.auth.credentialLabel')}
            {headerName && <span className="ml-1 text-foreground/50">({headerName})</span>}
          </span>
          <Input
            type="password"
            autoComplete="off"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSave() }}
            disabled={saving}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={saving || value.trim().length === 0} onClick={() => void handleSave()}>
            {saving && <Spinner className="text-xs" />}
            {t('pages.auth.credentialSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
