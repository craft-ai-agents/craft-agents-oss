/**
 * What's New timeline — version cards from release notes, mark-seen per version.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Cake, Check } from 'lucide-react'
import { FullscreenOverlayBase } from '@craft-agent/ui'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'

export interface WhatsNewNote {
  version: string
  content: string
}

export interface WhatsNewTimelineProps {
  isOpen: boolean
  onClose: () => void
  notes: WhatsNewNote[]
  onOpenUrl?: (url: string) => void
  /** Called after seen set updates (for badge refresh) */
  onSeenChange?: (seenVersions: string[]) => void
}

function loadSeenVersions(): string[] {
  const raw = storage.get<string[]>(storage.KEYS.whatsNewSeenVersions, [])
  return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : []
}

function saveSeenVersions(versions: string[]): void {
  const unique = Array.from(new Set(versions))
  storage.set(storage.KEYS.whatsNewSeenVersions, unique)
  // Keep legacy single-version key in sync with newest seen for badge bootstrap
  if (unique.length > 0) {
    const sorted = [...unique].sort((a, b) => compareSemverDesc(a, b))
    storage.set(storage.KEYS.whatsNewLastSeenVersion, sorted[0] ?? '')
  }
}

function compareSemverDesc(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** Parse getCombinedReleaseNotes() markdown into version cards. */
export function parseCombinedReleaseNotes(combined: string): WhatsNewNote[] {
  if (!combined.trim()) return []

  const chunks = combined.split(/\n---\n/)
  const notes: WhatsNewNote[] = []

  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue

    // Prefer "# v1.2.3" or "# 1.2.3"
    const headerMatch = trimmed.match(/^#\s+v?(\d+\.\d+(?:\.\d+)?[^\n]*)/i)
    if (headerMatch) {
      const version = headerMatch[1].trim()
      const content = trimmed.replace(/^#\s+v?\d+\.\d+(?:\.\d+)?[^\n]*\n*/i, '').trim()
      notes.push({ version, content: content || trimmed })
      continue
    }

    // Fallback: first line as title
    const firstLine = trimmed.split('\n')[0]?.replace(/^#\s*/, '').trim() || 'note'
    notes.push({ version: firstLine.replace(/^v/i, ''), content: trimmed })
  }

  return notes
}

export function WhatsNewTimeline({
  isOpen,
  onClose,
  notes,
  onOpenUrl,
  onSeenChange,
}: WhatsNewTimelineProps) {
  const { t } = useTranslation()
  const [seen, setSeen] = React.useState<string[]>(() => loadSeenVersions())
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  const markedRef = React.useRef<Set<string>>(new Set(loadSeenVersions()))

  React.useEffect(() => {
    if (!isOpen) return
    const current = loadSeenVersions()
    setSeen(current)
    markedRef.current = new Set(current)
  }, [isOpen, notes])

  const markSeen = React.useCallback((version: string) => {
    if (markedRef.current.has(version)) return
    markedRef.current.add(version)
    const next = Array.from(markedRef.current)
    saveSeenVersions(next)
    setSeen(next)
    onSeenChange?.(next)
  }, [onSeenChange])

  // Mark all currently listed versions as seen when the panel opens (user opened What's New).
  // Individual cards still show "new" until intersected for finer UX.
  React.useEffect(() => {
    if (!isOpen || notes.length === 0) return
    // Soft-mark latest immediately so top-bar badge clears on open
    markSeen(notes[0].version)
  }, [isOpen, notes, markSeen])

  const setCardRef = React.useCallback((version: string, node: HTMLElement | null) => {
    if (!node) return
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const v = (entry.target as HTMLElement).dataset.version
            if (v) markSeen(v)
          }
        },
        { threshold: 0.45 },
      )
    }
    observerRef.current.observe(node)
  }, [markSeen])

  React.useEffect(() => {
    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [])

  return (
    <FullscreenOverlayBase
      isOpen={isOpen}
      onClose={onClose}
      accessibleTitle={t('whatsNew.title')}
      title={t('whatsNew.title')}
      typeBadge={{
        icon: Cake,
        label: t('whatsNew.badge'),
        variant: 'blue',
      }}
    >
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-2">
        {notes.length === 0 ? (
          <div className="rounded-2xl border border-border/50 bg-background/80 px-6 py-12 text-center text-sm text-muted-foreground shadow-minimal">
            {t('whatsNew.empty')}
          </div>
        ) : (
          <ol className="relative space-y-4 border-l border-border/50 ml-3 pl-6">
            {notes.map((note, index) => {
              const isSeen = seen.includes(note.version)
              return (
                <li
                  key={`${note.version}-${index}`}
                  ref={(node) => setCardRef(note.version, node)}
                  data-version={note.version}
                  className="relative"
                >
                  <span
                    className={cn(
                      'absolute -left-[1.9rem] top-4 h-3 w-3 rounded-full border-2 border-background',
                      isSeen ? 'bg-muted-foreground/40' : 'bg-accent',
                    )}
                    aria-hidden
                  />
                  <article
                    className={cn(
                      'rounded-2xl border bg-background/90 shadow-minimal overflow-hidden',
                      isSeen ? 'border-border/50' : 'border-accent/35 ring-1 ring-accent/15',
                    )}
                  >
                    <header className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-foreground truncate">
                          {t('whatsNew.version', { version: note.version })}
                        </h2>
                        {index === 0 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {t('whatsNew.latest')}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          isSeen
                            ? 'bg-foreground/5 text-muted-foreground'
                            : 'bg-accent/15 text-accent',
                        )}
                      >
                        {isSeen ? (
                          <>
                            <Check className="h-3 w-3" />
                            {t('whatsNew.seen')}
                          </>
                        ) : (
                          t('whatsNew.new')
                        )}
                      </span>
                    </header>
                    <div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-foreground/90">
                      <Markdown
                        mode="full"
                        onUrlClick={onOpenUrl}
                      >
                        {note.content}
                      </Markdown>
                    </div>
                  </article>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </FullscreenOverlayBase>
  )
}
