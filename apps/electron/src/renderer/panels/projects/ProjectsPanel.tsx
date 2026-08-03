import React, { useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { FolderKanban, Search, Folder, Clock, Layers, Archive } from 'lucide-react'
import { projectsAtom } from '../../atoms/projects'
import { sessionMetaMapAtom } from '../../atoms/sessions'
import './ProjectsPanel.css'

export type ProjectsPanelProps = {
  onSelectProject?: (projectId: string) => void
  selectedProjectId?: string
}

function formatRelative(ts?: number): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function ProjectsPanel({ onSelectProject, selectedProjectId }: ProjectsPanelProps) {
  const projects = useAtomValue(projectsAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  /** sessionCount + lastActivity per projectId, derived from live session metadata */
  const stats = useMemo(() => {
    const map = new Map<string, { sessions: number; active: number; lastActivity?: number }>()
    for (const meta of metaMap.values()) {
      if (!meta.projectId || meta.hidden) continue
      const entry = map.get(meta.projectId) ?? { sessions: 0, active: 0 }
      entry.sessions += 1
      if (meta.isProcessing) entry.active += 1
      const ts = meta.lastMessageAt ?? meta.createdAt
      if (ts && (!entry.lastActivity || ts > entry.lastActivity)) entry.lastActivity = ts
      map.set(meta.projectId, entry)
    }
    return map
  }, [metaMap])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects
      .filter((p) => (showArchived ? true : !p.config.archivedAt))
      .filter(
        (p) =>
          !q ||
          p.config.name.toLowerCase().includes(q) ||
          (p.config.description ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aa = stats.get(a.config.id)?.lastActivity ?? a.config.updatedAt
        const bb = stats.get(b.config.id)?.lastActivity ?? b.config.updatedAt
        return bb - aa
      })
  }, [projects, search, showArchived, stats])

  const archivedCount = projects.filter((p) => p.config.archivedAt).length

  return (
    <div className="projects-panel">
      <div className="projects-panel__header">
        <div className="projects-panel__title">
          <FolderKanban size={20} />
          <h2>Projects</h2>
          <span className="projects-panel__count">{visible.length}</span>
        </div>
        <div className="projects-panel__controls">
          <div className="projects-panel__search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {archivedCount > 0 && (
            <button
              type="button"
              className={`projects-panel__toggle${showArchived ? ' is-active' : ''}`}
              onClick={() => setShowArchived((v) => !v)}
              title="Show archived projects"
            >
              <Archive size={14} />
              {archivedCount}
            </button>
          )}
        </div>
      </div>

      <div className="projects-panel__grid">
        {visible.length === 0 && (
          <div className="projects-panel__empty">
            <FolderKanban size={48} />
            <p>{projects.length === 0 ? 'No projects yet' : 'No projects match your search'}</p>
          </div>
        )}
        {visible.map((project) => {
          const cfg = project.config
          const stat = stats.get(cfg.id)
          const isSelected = cfg.id === selectedProjectId
          return (
            <button
              key={cfg.id}
              type="button"
              className={`projects-card${isSelected ? ' is-selected' : ''}${cfg.archivedAt ? ' is-archived' : ''}`}
              style={cfg.color ? ({ '--project-accent': cfg.color } as React.CSSProperties) : undefined}
              onClick={() => onSelectProject?.(cfg.id)}
            >
              <span className="projects-card__accent" />
              <div className="projects-card__header">
                <h3>{cfg.name}</h3>
                {stat?.active ? <span className="projects-card__live">{stat.active} running</span> : null}
              </div>
              {cfg.description && <p className="projects-card__desc">{cfg.description}</p>}
              <div className="projects-card__meta">
                <span>
                  <Layers size={13} />
                  {stat?.sessions ?? 0} sessions
                </span>
                <span>
                  <Clock size={13} />
                  {formatRelative(stat?.lastActivity ?? cfg.updatedAt)}
                </span>
              </div>
              {cfg.workingDirectory && (
                <div className="projects-card__path" title={cfg.workingDirectory}>
                  <Folder size={13} />
                  <span>{cfg.workingDirectory}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
