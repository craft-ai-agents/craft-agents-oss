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

interface CraftPageBlockProps {
  code: string
  className?: string
}

export function CraftPageBlock({ code, className }: CraftPageBlockProps) {
  const { t } = useTranslation()
  const { onResolvePageUrl, onOpenUrl } = usePlatform()

  const parsed = React.useMemo(() => parseCraftPageSpec(code), [code])
  const spec: CraftPageSpec | null = parsed.ok ? parsed.spec : null

  const [url, setUrl] = React.useState<string | null>(null)
  const [canOpenExternally, setCanOpenExternally] = React.useState(false)
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [expanded, setExpanded] = React.useState(false)

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
