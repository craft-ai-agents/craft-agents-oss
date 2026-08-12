/**
 * CraftPageBlock — renders ```craft-page fences.
 *
 * Deliberately a COMPACT CARD in the transcript, not a live inline iframe.
 * Every authoring turn emits a new fence in a new message, so after five edits
 * an inline-iframe design leaves five live pages stacked in the chat, each an
 * independent renderer process. The card is cheap; the real page opens in a
 * fullscreen overlay.
 *
 * Security notes that are easy to undo by accident:
 *
 * - The iframe carries NO `sandbox` attribute. Sandboxing is delivered by the
 *   CSP response header on the page, and adding the attribute as well makes
 *   WebKit execute no scripts at all (ADR 0001 D2, enforced by
 *   scripts/check-page-sandbox.ts).
 * - The src is always the WRAPPER URL resolved over RPC. Never point it at
 *   /p/… directly: framing is what supplies `frame-src 'self'`, the control
 *   that blocks a page navigating itself off-origin.
 */

import * as React from 'react'
import { FileCode2, Maximize2, AlertTriangle, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { usePlatform } from '../../context/PlatformContext'
import { parseCraftPageSpec, craftPageFrameKey, type CraftPageSpec } from './craft-page-spec'
import { CraftPageConsent } from './CraftPageConsent'
import type { QueryRequest } from './craft-page-consent'

interface CraftPageBlockProps {
  code: string
  className?: string
}

export function CraftPageBlock({ code, className }: CraftPageBlockProps) {
  const { t } = useTranslation()
  const {
    onResolvePageUrl, onOpenUrl,
    onListPageQueryRequests, onApprovePageQueries, onRevokePageQueries,
  } = usePlatform()

  const parsed = React.useMemo(() => parseCraftPageSpec(code), [code])
  const spec: CraftPageSpec | null = parsed.ok ? parsed.spec : null

  const [url, setUrl] = React.useState<string | null>(null)
  const [canOpenExternally, setCanOpenExternally] = React.useState(false)
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [expanded, setExpanded] = React.useState(false)
  const [requests, setRequests] = React.useState<QueryRequest[]>([])

  // Re-resolve whenever the REVISION changes, not just the page. The wrapper URL
  // is stable across revisions, but tying the effect to the frame key keeps the
  // resolve and the remount on the same trigger, so they can never disagree.
  const frameKey = spec ? craftPageFrameKey(spec) : ''

  React.useEffect(() => {
    if (!spec || !onResolvePageUrl) {
      setState(spec ? 'unavailable' : 'idle')
      return
    }
    let cancelled = false
    setState('loading')
    onResolvePageUrl(spec.pageId)
      .then((resolved) => {
        if (cancelled) return
        if (resolved) {
          setUrl(resolved.url)
          setCanOpenExternally(resolved.canOpenExternally)
          setState('ready')
        } else setState('unavailable')
      })
      .catch(() => { if (!cancelled) setState('unavailable') })
    return () => { cancelled = true }
  }, [frameKey, onResolvePageUrl, spec])

  // What the page asked for. Re-read on every revision: an edit can add or
  // withdraw a request, and a stale list would show the user a decision about
  // the previous version of the page.
  const reloadRequests = React.useCallback(() => {
    if (!spec || !onListPageQueryRequests) return
    onListPageQueryRequests(spec.pageId)
      // Fail closed and silent: with no readable request list there is nothing
      // to consent to, which is the safe direction.
      .then(setRequests, () => setRequests([]))
  }, [spec?.pageId, onListPageQueryRequests])

  React.useEffect(() => { reloadRequests() }, [frameKey, reloadRequests])

  // Malformed fence: show the raw block rather than swallowing it, so the model
  // (and the user) can see what was actually emitted.
  if (!parsed.ok) {
    return (
      <div className={cn('my-2', className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <AlertTriangle className="size-3.5" />
          <span>{parsed.reason}</span>
        </div>
        <CodeBlock code={code} language="json" />
      </div>
    )
  }

  const title = spec!.title || t('craftPage.untitled')

  return (
    <div className={cn('my-2', className)}>
      <div className="rounded-[10px] border border-border bg-background shadow-minimal overflow-hidden">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">
              {t('craftPage.revision', { rev: spec!.rev })}
              {state === 'unavailable' && ` · ${t('craftPage.unavailable')}`}
            </div>
          </div>
          {/* Only offered when the server says this page may be loaded
              top-level. A page holding connector grants must stay framed —
              frame-src does not protect a top-level document, and nothing
              replaces it in a third-party browser (ADR 0001 D6). */}
          {state === 'ready' && canOpenExternally && url && onOpenUrl && (
            <button
              type="button"
              onClick={() => onOpenUrl(url)}
              title={t('craftPage.openInBrowser')}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs"
            >
              <ExternalLink className="size-3.5" />
              {t('craftPage.openInBrowser')}
            </button>
          )}
          <button
            type="button"
            disabled={state !== 'ready'}
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
          >
            <Maximize2 className="size-3.5" />
            {expanded ? t('craftPage.hide') : t('craftPage.open')}
          </button>
        </div>

        {/* Consent sits ABOVE the preview: the decision belongs in front of
            the thing it is about, and a user who scrolls past a rendered page
            has already stopped reading. */}
        {requests.length > 0 && spec && onApprovePageQueries && onRevokePageQueries && (
          <CraftPageConsent
            className="mx-3 mb-3"
            requests={requests}
            onApprove={async (queries) => {
              await onApprovePageQueries(spec.pageId, queries)
              reloadRequests()
              // The page must be reloaded to pick up its new handles — they are
              // inlined into the wrapper document at render time.
              setExpanded(false)
            }}
            onRevoke={async () => {
              await onRevokePageQueries(spec.pageId)
              reloadRequests()
              setExpanded(false)
            }}
          />
        )}

        {expanded && state === 'ready' && url && (
          <iframe
            // Keyed on pageId:rev so an edited page genuinely remounts. Keying
            // on pageId alone lets React reuse the element and the browser reuse
            // the cached document, so the edit appears to do nothing.
            key={frameKey}
            src={url}
            title={title}
            className="w-full border-0 border-t border-border"
            style={{ height: 520 }}
          />
        )}
      </div>
    </div>
  )
}
