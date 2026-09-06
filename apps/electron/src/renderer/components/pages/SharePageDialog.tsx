import * as React from 'react'
import { AlertTriangle, Check, Copy, Globe2, Lock, ShieldAlert } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@craft-agent/ui'
import { Info_Alert } from '@/components/info'
import type { LoadedPage, PageActionGrant } from '@craft-agent/shared/pages/types'
import { isPageGrantUsable } from '@craft-agent/shared/pages/types'
import { describeGrantAction, useGrantRemoval } from './grant-visuals'

/**
 * Share dialog: publish / republish / password management / unpublish.
 *
 * Server-side gating is authoritative (the publish RPCs re-check the
 * CRAFT_FEATURE_PAGES_SHARING flag); `sharingEnabled` only controls what the
 * dialog offers. Unpublish is always offered for a published page so a
 * disabled flag can never strand a public copy (design §12).
 */

/**
 * Client-side mirror of the Worker's PASSWORD_MIN_LENGTH (workers/pages/
 * src/password.ts). UX only — the Worker re-validates on create/update and is
 * authoritative — but keep the two in sync so users get inline feedback rather
 * than a server error toast.
 */
const PAGE_PASSWORD_MIN_LENGTH = 8

/**
 * PageShareError carries its machine code as a "PAGE_X: " message prefix so
 * the code survives the RPC transport. Only the prose after the prefix is
 * meant for people — strip the code before showing the message in the UI.
 */
function displayShareError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^PAGE_[A-Z0-9_]+:\s*/, '')
}

// Module-level cache: the flag is server-evaluated and process-stable.
let capabilitiesPromise: Promise<{ sharingEnabled: boolean }> | null = null

export function usePageShareCapabilities(): { sharingEnabled: boolean; loaded: boolean } {
  const [state, setState] = React.useState<{ sharingEnabled: boolean; loaded: boolean }>({
    sharingEnabled: false,
    loaded: false,
  })
  React.useEffect(() => {
    let stale = false
    if (!capabilitiesPromise) {
      capabilitiesPromise = window.electronAPI.getPageShareCapabilities().catch(() => {
        capabilitiesPromise = null
        return { sharingEnabled: false }
      })
    }
    void capabilitiesPromise.then(caps => {
      if (!stale) setState({ sharingEnabled: caps.sharingEnabled, loaded: true })
    })
    return () => { stale = true }
  }, [])
  return state
}

interface SharePageDialogProps {
  workspaceId: string
  page: LoadedPage
  /** Whether a data snapshot exists on disk (enables the include-data option) */
  hasSnapshot: boolean
  sharingEnabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

type BusyAction = 'publish' | 'password' | 'unpublish' | null

export function SharePageDialog({
  workspaceId,
  page,
  hasSnapshot,
  sharingEnabled,
  open,
  onOpenChange,
}: SharePageDialogProps) {
  const { t } = useTranslation()
  const { config } = page
  const share = config.share
  const allGrants = config.grants ?? []
  // Script grants block publishing outright (server refuses even stale ones);
  // surfacing them with inline removal beats failing after the form is filled.
  const scriptGrants = allGrants.filter(g => g.action.kind === 'script')
  // The view-only ack covers a real behavior difference — action buttons work
  // locally but not on the public copy. Stale/expired grants don't work
  // locally either, so they don't require it (mirrors buildPageShareBundle).
  const hasUsableActionGrants = allGrants.some(
    g => g.action.kind !== 'script' && isPageGrantUsable(g, config.contentDigest, Date.now()),
  )
  const { busyGrantId, removeGrant } = useGrantRemoval(workspaceId, config.slug)

  const [busy, setBusy] = React.useState<BusyAction>(null)
  const [includeData, setIncludeData] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [ackViewOnly, setAckViewOnly] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [confirmingUnpublish, setConfirmingUnpublish] = React.useState(false)
  const [dataScan, setDataScan] = React.useState<{ snapshotBytes: number | null; secretCandidates: string[] } | null>(null)

  // A typed-but-too-short password blocks submit (mirrors the Worker floor);
  // an empty field is fine — publishing without a password is allowed.
  const passwordTooShort = password.length > 0 && password.length < PAGE_PASSWORD_MIN_LENGTH

  // Reset transient state whenever the dialog (re)opens or the target changes.
  React.useEffect(() => {
    if (!open) return
    setBusy(null)
    setIncludeData(share?.includesData ?? false)
    setPassword('')
    setAckViewOnly(false)
    setCopied(false)
    setConfirmingUnpublish(false)
    setDataScan(null)
  }, [open, config.slug, share?.includesData])

  // Best-effort secret heads-up when data would be published — warn, never block.
  React.useEffect(() => {
    if (!open || !includeData || dataScan !== null) return
    let cancelled = false
    window.electronAPI
      .getPageShareDataScan(workspaceId, config.slug)
      .then(scan => { if (!cancelled) setDataScan(scan) })
      .catch(() => { if (!cancelled) setDataScan({ snapshotBytes: null, secretCandidates: [] }) })
    return () => { cancelled = true }
  }, [open, includeData, dataScan, workspaceId, config.slug])

  const secretCandidates = includeData ? (dataScan?.secretCandidates ?? []) : []
  const secretKeysPreview =
    secretCandidates.slice(0, 3).join(', ') + (secretCandidates.length > 3 ? ` +${secretCandidates.length - 3}` : '')

  const runPublish = React.useCallback(async () => {
    setBusy('publish')
    try {
      await window.electronAPI.publishPage(workspaceId, config.slug, {
        includeData,
        // Password only applies at create time; changes go through setPagePublicationPassword.
        ...(share ? {} : password ? { password } : {}),
        ...(hasUsableActionGrants ? { viewOnlyAcknowledged: true } : {}),
      })
      toast.success(t('toast.pagePublished'))
      setPassword('')
    } catch (err) {
      toast.error(t('toast.pagePublishFailed'), {
        description: displayShareError(err),
      })
    } finally {
      setBusy(null)
    }
  }, [workspaceId, config.slug, includeData, password, share, hasUsableActionGrants, t])

  const runSetPassword = React.useCallback(async (value: string | null) => {
    setBusy('password')
    try {
      await window.electronAPI.setPagePublicationPassword(workspaceId, config.slug, value)
      toast.success(t('toast.pagePasswordUpdated'))
      setPassword('')
    } catch (err) {
      toast.error(t('toast.pagePasswordUpdateFailed'), {
        description: displayShareError(err),
      })
    } finally {
      setBusy(null)
    }
  }, [workspaceId, config.slug, t])

  const runUnpublish = React.useCallback(async () => {
    setBusy('unpublish')
    try {
      const result = await window.electronAPI.unpublishPage(workspaceId, config.slug)
      if (result.warning === 'remote-copy-may-remain') {
        toast.warning(t('toast.pageUnpublished'), { description: t('toast.pagePublicCopyMayRemain') })
      } else {
        toast.success(t('toast.pageUnpublished'))
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(t('toast.pageUnpublishFailed'), {
        description: displayShareError(err),
      })
    } finally {
      setBusy(null)
      setConfirmingUnpublish(false)
    }
  }, [workspaceId, config.slug, t, onOpenChange])

  const copyLink = React.useCallback(async () => {
    if (!share) return
    try {
      await navigator.clipboard.writeText(share.url)
      setCopied(true)
      toast.success(t('pages.share.linkCopied'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard denied — the URL stays selectable in the input.
    }
  }, [share, t])

  const contentDrifted = Boolean(share && config.contentDigest && share.publishedContentDigest !== config.contentDigest)
  const publishBlocked = scriptGrants.length > 0 || (hasUsableActionGrants && !ackViewOnly)

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pages.share.title')}</DialogTitle>
          {!share && <DialogDescription>{t('pages.share.publishDescription')}</DialogDescription>}
        </DialogHeader>

        {!share ? (
          // ------------------------------------------------------------
          // Not published yet
          // ------------------------------------------------------------
          <div className="flex flex-col gap-4">
            {hasSnapshot && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start justify-between gap-3">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm">{t('pages.share.includeData')}</span>
                    <span className="text-xs text-foreground/50">{t('pages.share.includeDataHint')}</span>
                  </span>
                  <Switch checked={includeData} onCheckedChange={setIncludeData} disabled={busy !== null} />
                </label>
                {secretCandidates.length > 0 && (
                  <span className="text-xs text-amber-500">
                    {t('pages.share.dataSecretWarning', { keys: secretKeysPreview })}
                  </span>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm">{t('pages.share.passwordLabel')}</span>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('pages.share.passwordPlaceholder')}
                disabled={busy !== null}
              />
              <span className={`text-xs ${passwordTooShort ? 'text-amber-500' : 'text-foreground/50'}`}>
                {passwordTooShort
                  ? t('pages.share.passwordTooShort', { min: PAGE_PASSWORD_MIN_LENGTH })
                  : t('pages.share.passwordHint', { min: PAGE_PASSWORD_MIN_LENGTH })}
              </span>
            </div>

            {scriptGrants.length > 0 ? (
              <ScriptGrantsBlock grants={scriptGrants} busyGrantId={busyGrantId} onRemove={removeGrant} />
            ) : hasUsableActionGrants ? (
              <label className="flex items-start justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm">{t('pages.share.actionsAckLabel')}</span>
                  <span className="text-xs text-foreground/60">{t('pages.share.actionsAck')}</span>
                </span>
                <Switch checked={ackViewOnly} onCheckedChange={setAckViewOnly} disabled={busy !== null} />
              </label>
            ) : null}
          </div>
        ) : (
          // ------------------------------------------------------------
          // Published
          // ------------------------------------------------------------
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm">{t('pages.share.linkLabel')}</span>
              <div className="flex items-center gap-2">
                <Input readOnly value={share.url} onFocus={e => e.currentTarget.select()} className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {t('pages.share.copyLink')}
                </Button>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-foreground/50">
                {share.passwordProtected
                  ? <><Lock className="h-3 w-3" /> {t('pages.share.passwordProtected')}</>
                  : <><Globe2 className="h-3 w-3" /> {t('pages.share.noPassword')}</>}
              </span>
            </div>

            {share.lastPublishError && (
              <Info_Alert variant="error" inline icon={<AlertTriangle className="h-4 w-4" />}>
                <Info_Alert.Title>{t('pages.share.lastError')}</Info_Alert.Title>
                <Info_Alert.Description className="break-all">{displayShareError(share.lastPublishError)}</Info_Alert.Description>
              </Info_Alert>
            )}

            {sharingEnabled ? (
              <>
                {/* A script approval added after publishing blocks republish too */}
                {scriptGrants.length > 0 && (
                  <ScriptGrantsBlock grants={scriptGrants} busyGrantId={busyGrantId} onRemove={removeGrant} />
                )}

                {/* Republish carries the previous includeData choice — same heads-up applies */}
                {secretCandidates.length > 0 && (
                  <span className="text-xs text-amber-500">
                    {t('pages.share.dataSecretWarning', { keys: secretKeysPreview })}
                  </span>
                )}

                {/* Content revision */}
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                  <span className="text-xs text-foreground/60">
                    {contentDrifted ? t('pages.share.contentUpdateAvailable') : t('pages.share.contentUpToDate')}
                  </span>
                  <Button
                    variant={contentDrifted ? 'default' : 'outline'}
                    size="sm"
                    onClick={runPublish}
                    disabled={busy !== null || scriptGrants.length > 0}
                    className="shrink-0"
                  >
                    {busy === 'publish' && <Spinner className="text-xs" />}
                    {t('pages.share.republish')}
                  </Button>
                </div>

                {/* Password management */}
                <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
                  <span className="text-sm">{t('pages.share.passwordLabel')}</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={share.passwordProtected ? t('pages.share.changePassword') : t('pages.share.passwordPlaceholder')}
                      disabled={busy !== null}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runSetPassword(password)}
                      disabled={busy !== null || password.length === 0 || passwordTooShort}
                      className="shrink-0"
                    >
                      {busy === 'password' && <Spinner className="text-xs" />}
                      {t('pages.share.savePassword')}
                    </Button>
                  </div>
                  {passwordTooShort && (
                    <span className="text-xs text-amber-500">
                      {t('pages.share.passwordTooShort', { min: PAGE_PASSWORD_MIN_LENGTH })}
                    </span>
                  )}
                  {share.passwordProtected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void runSetPassword(null)}
                      disabled={busy !== null}
                      className="self-start text-foreground/60"
                    >
                      {t('pages.share.removePassword')}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <span className="text-xs text-foreground/50">{t('pages.share.disabledNote')}</span>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {share ? (
            <>
              <span className="mr-auto text-xs text-foreground/40 self-center hidden sm:block">
                {t('pages.share.unpublishHint')}
              </span>
              {confirmingUnpublish ? (
                <Button variant="destructive" onClick={runUnpublish} disabled={busy !== null}>
                  {busy === 'unpublish' && <Spinner className="text-xs" />}
                  {t('pages.share.unpublish')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirmingUnpublish(true)} disabled={busy !== null}>
                  {t('pages.share.unpublish')}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
                {t('common.cancel')}
              </Button>
              <Button onClick={runPublish} disabled={busy !== null || publishBlocked || passwordTooShort || !sharingEnabled}>
                {busy === 'publish' && <Spinner className="text-xs" />}
                {t('pages.share.publish')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Publish-blocking notice for script approvals, with inline removal — the
 * server refuses to publish a page holding ANY script grant (even a stale
 * one), so the dialog explains that up front instead of failing on submit.
 */
function ScriptGrantsBlock({
  grants,
  busyGrantId,
  onRemove,
}: {
  grants: PageActionGrant[]
  busyGrantId: string | null
  onRemove: (grantId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/[0.06] p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
        <div className="min-w-0 text-sm">
          <div className="font-medium">{t('pages.share.scriptBlockedTitle')}</div>
          <div className="mt-0.5 text-xs text-foreground/60">{t('pages.share.scriptBlocked')}</div>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {grants.map(grant => (
          <li
            key={grant.id}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 break-words text-xs font-medium">
              {describeGrantAction(grant.action, t)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={busyGrantId !== null}
              onClick={() => void onRemove(grant.id)}
            >
              {busyGrantId === grant.id && <Spinner className="text-xs" />}
              {t('pages.grants.remove')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
