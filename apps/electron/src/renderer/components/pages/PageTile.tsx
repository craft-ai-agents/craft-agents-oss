import * as React from 'react'
import { Globe2, Lock, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import type { LoadedPage } from '@craft-agent/shared/pages/types'
import { PAGE_KIND_ICONS, PageFreshness, PageKindBadge } from './page-visuals'
import { useInView } from '@/hooks/useInView'

export interface PageTileProject {
  name: string
  color?: string
}

interface PageTileProps {
  page: LoadedPage
  /** Resolved owning project (undefined when the page is unassigned) */
  project?: PageTileProject
  onOpen: () => void
  onDelete: () => void
}

/**
 * One tile in the Pages library grid. Shows the cached preview poster when one
 * is fresh (lazily fetched once the tile scrolls into view); otherwise falls
 * back to a deterministic placeholder (kind glyph + title monogram + project
 * accent). "Fresh" = the poster's digest matches the current content digest,
 * mirroring `isThumbnailFresh` server-side (inlined here — the renderer must
 * not import Node-backed `@craft-agent/shared` code).
 */
export function PageTile({ page, project, onOpen, onDelete }: PageTileProps) {
  const { t } = useTranslation()
  const { config } = page
  const KindIcon = PAGE_KIND_ICONS[config.kind]
  const monogram = (config.name.trim()[0] ?? '?').toUpperCase()
  const accent = project?.color

  const posterDigest =
    config.thumbnail && config.contentDigest && config.thumbnail.digest === config.contentDigest
      ? config.contentDigest
      : null

  const [thumbRef, inView] = useInView<HTMLDivElement>()
  const [posterUrl, setPosterUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    // Reset when the page has no fresh poster (e.g. content just changed).
    if (!posterDigest) {
      setPosterUrl(null)
      return
    }
    if (!inView) return
    let cancelled = false
    void window.electronAPI
      .getPageThumbnail(page.workspaceId, config.slug)
      .then((result) => {
        // Guard against a stale response after another content change.
        if (!cancelled && result && result.digest === posterDigest) setPosterUrl(result.dataUrl)
      })
      .catch(() => { /* posterless → placeholder stays */ })
    return () => { cancelled = true }
  }, [page.workspaceId, config.slug, posterDigest, inView])

  const refreshPreview = React.useCallback(() => {
    void window.electronAPI
      .regeneratePageThumbnail(page.workspaceId, config.slug)
      .then((queued) => {
        if (queued) toast.success(t('toast.pagePreviewQueued'))
        else toast.error(t('toast.pagePreviewFailed'))
      })
      .catch(() => toast.error(t('toast.pagePreviewFailed')))
  }, [page.workspaceId, config.slug, t])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label={config.name}
          className={cn(
            'group relative flex flex-col overflow-hidden rounded-xl border border-foreground/[0.08] bg-card text-left shadow-minimal',
            'cursor-pointer transition-colors duration-150 hover:border-foreground/20 hover:bg-foreground/[0.02]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          {/* Project accent: hairline + dot, never a full-card tint */}
          {accent && (
            <span
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
          )}

          {/* Preview poster when fresh, else the deterministic placeholder (16:10, visual inset) */}
          <div className="p-3 pb-0">
            <div
              ref={thumbRef}
              className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-lg bg-foreground/[0.03]"
            >
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-top"
                />
              ) : (
                <>
                  <span className="select-none text-4xl font-semibold text-foreground/[0.08]">{monogram}</span>
                  <KindIcon className="absolute h-6 w-6 text-foreground/25" strokeWidth={1.75} aria-hidden />
                  <span
                    className="absolute -right-4 -top-4 h-16 w-16 rounded-full border border-foreground/[0.05]"
                    aria-hidden
                  />
                  <span
                    className="absolute -bottom-6 -left-2 h-14 w-24 rounded-full border border-foreground/[0.04]"
                    aria-hidden
                  />
                </>
              )}
            </div>
          </div>

          {/* Footer: title, then metadata */}
          <div className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
            <span className="truncate text-[13px] font-semibold text-foreground">{config.name}</span>
            <span className="flex min-w-0 items-center gap-2">
              <PageKindBadge kind={config.kind} />
              {project && (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/50">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color ?? 'var(--muted-foreground)' }}
                    aria-hidden
                  />
                  <span className="truncate">{project.name}</span>
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-2">
                {config.share && (
                  <span
                    className="inline-flex items-center text-foreground/45"
                    role="img"
                    aria-label={t('pages.shared')}
                    title={t('pages.shared')}
                  >
                    {config.share.passwordProtected
                      ? <Lock className="h-3 w-3" aria-hidden />
                      : <Globe2 className="h-3 w-3" aria-hidden />}
                  </span>
                )}
                <PageFreshness config={config} />
              </span>
            </span>
          </div>
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={onOpen}>
          {t('common.open')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={refreshPreview}>
          <RefreshCw />
          {t('pages.refreshPreview')}
        </StyledContextMenuItem>
        <StyledContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 />
          {t('pages.deletePage')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}
