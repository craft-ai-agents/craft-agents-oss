import { useCallback, useEffect, useState } from 'react'
import {
  Activity, Clock, Cpu, Zap, TrendingUp, Play,
  Plus, Scissors, Drum, Calendar, CheckCircle2, AlertCircle,
  Music, Brain, Plug, MessageSquare, ArrowRight,
} from 'lucide-react'
import type { Session, LoadedSource, MediaItem } from '../../../shared/types'

interface DashboardStats {
  activeSessions: number
  totalSessions: number
  processingSessions: number
  audioCount: number
  memoryCount: number
  sourceCount: number
  connectedSources: number
  automationCount: number
}

interface ActivityEntry {
  id: string
  time: number
  icon: typeof Activity
  label: string
  detail: string
  color: string
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function DashboardPanel() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [recentAudio, setRecentAudio] = useState<MediaItem[]>([])
  const [recentSessions, setRecentSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const sessions = await window.electronAPI.getSessions()
      const workspaceId = sessions[0]?.workspaceId ?? 'default'

      const [audioPage, sources, automations, memoryStats] = await Promise.all([
        window.electronAPI.mediaList({ kind: 'audio', limit: 6 }).catch(() => ({ items: [] as MediaItem[], hasMore: false, nextCursor: null })),
        window.electronAPI.getSources(workspaceId).catch(() => [] as LoadedSource[]),
        window.electronAPI.getAutomations(workspaceId).catch(() => null),
        window.electronAPI.getMemoryStats().catch(() => null),
      ])

      const sorted = [...sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      setRecentSessions(sorted.slice(0, 5))

      const processing = sessions.filter((s) => s.isProcessing).length
      setStats({
        activeSessions: sessions.filter((s) => s.isProcessing || (Date.now() - s.lastMessageAt) < 3600000).length,
        totalSessions: sessions.length,
        processingSessions: processing,
        audioCount: audioPage.items.length,
        memoryCount: memoryStats?.totalActive ?? 0,
        sourceCount: sources.length,
        connectedSources: sources.filter((s: any) => s.config?.connectionStatus === 'connected' || s.config?.isAuthenticated).length,
        automationCount: automations && typeof automations === 'object' && 'automations' in automations
          ? Object.keys((automations as any).automations ?? {}).length
          : 0,
      })

      setRecentAudio(audioPage.items.slice(0, 4))

      const entries: ActivityEntry[] = []
      for (const session of sorted.slice(0, 8)) {
        entries.push({
          id: session.id,
          time: session.lastMessageAt,
          icon: MessageSquare,
          label: session.name || session.id,
          detail: session.isProcessing ? 'Processing...' : `${session.messages?.length ?? 0} messages`,
          color: session.isProcessing ? '#22c55e' : '#a855f7',
        })
      }
      setActivity(entries)
    } catch {
      // best-effort
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [refresh])

  const handleNewChat = useCallback(async () => {
    try {
      const sessions = await window.electronAPI.getSessions()
      const workspaceId = sessions[0]?.workspaceId ?? 'default'
      await window.electronAPI.createSession(workspaceId)
    } catch {
      // best-effort
    }
  }, [])

  return (
    <div className="dashboard">
      <div className="dashboard__header">
        <div>
          <h2>Dashboard</h2>
          <p>Welcome back — here's what's happening</p>
        </div>
        <button type="button" className="dashboard__refresh" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="dashboard__grid">
        <div className="dashboard__stats-row">
          <StatCard icon={MessageSquare} label="Sessions" value={stats?.totalSessions ?? '—'} sub={`${stats?.activeSessions ?? 0} active`} color="#a855f7" />
          <StatCard icon={Zap} label="Processing" value={stats?.processingSessions ?? '—'} sub={stats?.processingSessions ? 'running now' : 'idle'} color="#22c55e" />
          <StatCard icon={Music} label="Audio files" value={stats?.audioCount ?? '—'} sub="in library" color="#3b82f6" />
          <StatCard icon={Brain} label="Memories" value={stats?.memoryCount ?? '—'} sub="stored" color="#f59e0b" />
          <StatCard icon={Plug} label="Sources" value={`${stats?.connectedSources ?? '—'}/${stats?.sourceCount ?? '—'}`} sub="connected" color="#06b6d4" />
          <StatCard icon={Calendar} label="Automations" value={stats?.automationCount ?? '—'} sub="configured" color="#ec4899" />
        </div>

        <div className="dashboard__main-row">
          <div className="dashboard__card dashboard__activity">
            <div className="dashboard__card-header">
              <Activity size={16} />
              <h3>While you were away</h3>
            </div>
            <div className="dashboard__activity-list">
              {loading ? (
                <div className="dashboard__loading">Loading activity...</div>
              ) : activity.length === 0 ? (
                <div className="dashboard__empty">No recent activity</div>
              ) : (
                activity.map((entry) => {
                  const Icon = entry.icon
                  return (
                    <div key={entry.id} className="dashboard__activity-item">
                      <span className="dashboard__activity-icon" style={{ color: entry.color }}>
                        <Icon size={14} />
                      </span>
                      <div className="dashboard__activity-text">
                        <strong>{entry.label}</strong>
                        <small>{entry.detail}</small>
                      </div>
                      <span className="dashboard__activity-time">{formatRelative(entry.time)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="dashboard__card dashboard__quick-actions">
            <div className="dashboard__card-header">
              <Zap size={16} />
              <h3>Quick actions</h3>
            </div>
            <div className="dashboard__action-grid">
              <button type="button" className="dashboard__action" onClick={handleNewChat}>
                <Plus size={20} />
                <span>New chat</span>
              </button>
              <button type="button" className="dashboard__action" onClick={() => window.location.hash = 'archstudio://allSessions'}>
                <MessageSquare size={20} />
                <span>Sessions</span>
              </button>
              <button type="button" className="dashboard__action" onClick={() => window.location.hash = 'media-lab'}>
                <Music size={20} />
                <span>Media Lab</span>
              </button>
              <button type="button" className="dashboard__action" onClick={() => window.location.hash = 'knowledge'}>
                <Brain size={20} />
                <span>Knowledge</span>
              </button>
            </div>
          </div>
        </div>

        <div className="dashboard__bottom-row">
          <div className="dashboard__card dashboard__recent-sessions">
            <div className="dashboard__card-header">
              <MessageSquare size={16} />
              <h3>Recent sessions</h3>
              <button type="button" className="dashboard__see-all" onClick={() => window.location.hash = 'archstudio://allSessions'}>
                See all <ArrowRight size={12} />
              </button>
            </div>
            <div className="dashboard__session-list">
              {recentSessions.length === 0 ? (
                <div className="dashboard__empty">No sessions yet</div>
              ) : (
                recentSessions.map((session) => (
                  <div key={session.id} className="dashboard__session-item" onClick={() => window.location.hash = `archstudio://allSessions/session/${session.id}`}>
                    <span className={`dashboard__session-status${session.isProcessing ? ' is-processing' : ''}`} />
                    <div className="dashboard__session-info">
                      <strong>{session.name || session.id}</strong>
                      <small>{formatRelative(session.lastMessageAt)} · {session.messages?.length ?? 0} messages</small>
                    </div>
                    {session.isProcessing && <span className="dashboard__session-badge">live</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="dashboard__card dashboard__recent-audio">
            <div className="dashboard__card-header">
              <Music size={16} />
              <h3>Latest audio</h3>
              <button type="button" className="dashboard__see-all" onClick={() => window.location.hash = 'media-lab'}>
                Open Media <ArrowRight size={12} />
              </button>
            </div>
            <div className="dashboard__audio-list">
              {recentAudio.length === 0 ? (
                <div className="dashboard__empty">No audio generated yet</div>
              ) : (
                recentAudio.map((item) => (
                  <div key={item.path} className="dashboard__audio-item">
                    <Play size={16} />
                    <div className="dashboard__audio-info">
                      <strong>{item.name}</strong>
                      <small>{formatRelative(item.mtime ?? 0)}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Activity
  label: string
  value: string | number
  sub: string
  color: string
}) {
  return (
    <div className="dashboard__stat-card" style={{ '--stat-color': color } as React.CSSProperties}>
      <div className="dashboard__stat-icon" style={{ background: `${color}20`, color }}>
        <Icon size={18} />
      </div>
      <div className="dashboard__stat-data">
        <span className="dashboard__stat-label">{label}</span>
        <span className="dashboard__stat-value">{value}</span>
        <span className="dashboard__stat-sub">{sub}</span>
      </div>
    </div>
  )
}