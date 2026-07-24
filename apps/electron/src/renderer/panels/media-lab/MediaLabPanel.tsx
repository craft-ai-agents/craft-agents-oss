import React, { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Clapperboard, Image, Music, Video, FileText, Loader2, ExternalLink } from 'lucide-react'
import type { SessionFile } from '@craft-agent/shared/protocol/dto'
import { sessionMetaMapAtom } from '../../atoms/sessions'
import { useAppShellContext } from '../../context/AppShellContext'
import './MediaLabPanel.css'

type MediaKind = 'image' | 'video' | 'audio' | 'doc'

type MediaItem = {
  name: string
  path: string
  size?: number
  kind: MediaKind
  sessionId: string
  sessionTitle: string
}

const EXT: Record<MediaKind, string[]> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'],
  video: ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
  audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'],
  doc: ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.md'],
}

const KIND_ICON: Record<MediaKind, typeof Image> = {
  image: Image,
  video: Video,
  audio: Music,
  doc: FileText,
}

/** How many recent sessions to scan — file listing is per-session, so this bounds the fan-out. */
const SESSION_SCAN_LIMIT = 40

function classify(name: string): MediaKind | null {
  const lower = name.toLowerCase()
  for (const kind of Object.keys(EXT) as MediaKind[]) {
    if (EXT[kind].some((ext) => lower.endsWith(ext))) return kind
  }
  return null
}

/** SessionFile trees are nested; walk them into a flat list of media files. */
function walk(
  files: SessionFile[],
  sessionId: string,
  sessionTitle: string,
  out: MediaItem[],
): void {
  for (const file of files) {
    if (file.type === 'directory') {
      if (file.children?.length) walk(file.children, sessionId, sessionTitle, out)
      continue
    }
    const kind = classify(file.name)
    if (!kind) continue
    out.push({ name: file.name, path: file.path, size: file.size, kind, sessionId, sessionTitle })
  }
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function MediaLabPanel() {
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const { onOpenFile } = useAppShellContext()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<MediaKind | 'all'>('all')

  const recentSessions = useMemo(
    () =>
      Array.from(metaMap.values())
        .filter((m) => !m.hidden && !m.isArchived)
        .sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
        .slice(0, SESSION_SCAN_LIMIT)
        .map((m) => ({ id: m.id, title: m.name || m.preview || m.id })),
    [metaMap],
  )

  useEffect(() => {
    let cancelled = false
    const scan = async () => {
      setLoading(true)
      const found: MediaItem[] = []
      try {
        const results = await Promise.all(
          recentSessions.map(async (session) => {
            try {
              const files = await window.electronAPI.getSessionFiles(session.id)
              return { session, files }
            } catch {
              return { session, files: [] as SessionFile[] }
            }
          }),
        )
        for (const { session, files } of results) {
          walk(files, session.id, session.title, found)
        }
        if (cancelled) return
        setItems(found)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void scan()
    return () => {
      cancelled = true
    }
  }, [recentSessions])

  const counts = useMemo(() => {
    const map = new Map<MediaKind, number>()
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1)
    return map
  }, [items])

  const visible = useMemo(
    () => (kindFilter === 'all' ? items : items.filter((i) => i.kind === kindFilter)),
    [items, kindFilter],
  )

  const open = (item: MediaItem) => {
    onOpenFile(item.path)
  }

  return (
    <div className="media-panel">
      <div className="media-panel__header">
        <div className="media-panel__title">
          <Clapperboard size={20} />
          <h2>Media Lab</h2>
          {loading ? (
            <Loader2 size={15} className="media-panel__spinner" />
          ) : (
            <span className="media-panel__count">{visible.length}</span>
          )}
        </div>
      </div>

      <div className="media-panel__filters">
        <button
          type="button"
          className={`media-chip${kindFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setKindFilter('all')}
        >
          All <span>{items.length}</span>
        </button>
        {(Object.keys(EXT) as MediaKind[])
          .filter((kind) => counts.get(kind))
          .map((kind) => {
            const Icon = KIND_ICON[kind]
            return (
              <button
                key={kind}
                type="button"
                className={`media-chip${kindFilter === kind ? ' is-active' : ''}`}
                onClick={() => setKindFilter(kind)}
              >
                <Icon size={13} />
                {kind} <span>{counts.get(kind)}</span>
              </button>
            )
          })}
      </div>

      <div className="media-panel__grid">
        {error && <div className="media-panel__error">{error}</div>}
        {!loading && !error && visible.length === 0 && (
          <div className="media-panel__empty">
            <Clapperboard size={48} />
            <p>No media found</p>
            <span>Images, video, audio and documents produced by your sessions appear here.</span>
          </div>
        )}
        {visible.map((item) => {
          const Icon = KIND_ICON[item.kind]
          return (
            <button
              key={`${item.sessionId}-${item.path}`}
              type="button"
              className="media-card"
              onClick={() => open(item)}
              title={item.path}
            >
              <div className={`media-card__preview is-${item.kind}`}>
                {item.kind === 'image' ? (
                  <img src={`file://${item.path}`} alt={item.name} loading="lazy" />
                ) : (
                  <Icon size={28} />
                )}
              </div>
              <div className="media-card__body">
                <span className="media-card__name">{item.name}</span>
                <span className="media-card__meta">
                  {formatSize(item.size)}
                  {item.size ? ' · ' : ''}
                  {item.sessionTitle}
                </span>
              </div>
              <ExternalLink size={13} className="media-card__open" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
