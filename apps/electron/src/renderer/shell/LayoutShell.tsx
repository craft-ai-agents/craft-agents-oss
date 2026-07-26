import React, { useState, useMemo, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import {
  Command,
  Search,
  Settings,
  Brain,
  FolderKanban,
  Activity,
  Clapperboard,
  BookOpen,
  Plug,
  Globe,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Monitor,
  Construction,
  FileText,
  Plus,
  MessageSquarePlus,
} from 'lucide-react'
import { MemoryPanel } from '../panels/memory'
import { RunsPanel } from '../panels/runs'
import { CommandPanel } from '../panels/command'
import { ProjectsPanel } from '../panels/projects'
import { IntegrationsPanel } from '../panels/integrations'
import { SearchPanel } from '../panels/search'
import { SecurityPanel } from '../panels/security'
import { SettingsPanel } from '../panels/settings'
import { MediaLabPanel } from '../panels/media-lab'
import { PromptStudioPanel } from '../panels/prompts'
import { ProvidersPanel } from '../panels/ProvidersPanel'
import { HomeHero } from '../home'
import { sessionMetaMapAtom } from '../atoms/sessions'
// Sidebar brand uses the rasterised icon-set PNG (which already has the
// rounded-square dark card + emblem baked in), so the brand mark in the
// chrome is identical to the desktop app icon users see on their launcher.
import brandIconUrl from '@resources/icon-set/icon-512.png?url'
import './LayoutShell.css'

export type ShellView =
  | 'command'
  | 'runs'
  | 'projects'
  | 'memory'
  | 'media-lab'
  | 'prompts'
  | 'providers'
  | 'integrations'
  | 'security'
  | 'search'
  | 'settings'

export type ThemeMode = 'light' | 'dark' | 'system'

type WorkspaceTab = 'agent-chat' | 'code' | 'canvas' | 'preview' | 'tasks'
type RailTab = 'context' | 'files' | 'changes'

const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'agent-chat', label: 'Agent Chat' },
  { id: 'code', label: 'Code' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'preview', label: 'Preview' },
  { id: 'tasks', label: 'Tasks' },
]

const RAIL_TABS: { id: RailTab; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
]

const navItems = [
  { id: 'command' as ShellView, label: 'Command', icon: Command },
  { id: 'runs' as ShellView, label: 'Runs', icon: Activity },
  { id: 'projects' as ShellView, label: 'Projects', icon: FolderKanban },
  { id: 'memory' as ShellView, label: 'Memory', icon: Brain },
  { id: 'media-lab' as ShellView, label: 'Media Lab', icon: Clapperboard },
  { id: 'prompts' as ShellView, label: 'Prompt Studio', icon: BookOpen },
  { id: 'providers' as ShellView, label: 'Providers', icon: Plug },
  { id: 'integrations' as ShellView, label: 'Integrations', icon: Globe },
  { id: 'security' as ShellView, label: 'Security', icon: ShieldCheck },
  { id: 'search' as ShellView, label: 'Search', icon: Search },
  { id: 'settings' as ShellView, label: 'Settings', icon: Settings },
] as const

type LayoutShellProps = {
  initialView?: ShellView
  onNavigate?: (view: ShellView) => void
  theme?: ThemeMode
  onThemeChange?: (theme: ThemeMode) => void
  topBar?: React.ReactNode
  breadcrumbs?: { label: string; onClick?: () => void }[]
  /**
   * Start a new chat. Optional so the playground can mount the shell without
   * session plumbing, but the desktop app always supplies it — closing the last
   * chat otherwise leaves no way back into a conversation.
   */
  onNewChat?: () => void
  children?: React.ReactNode
}

function LayoutShell({
  initialView = 'command',
  onNavigate,
  theme = 'system',
  onThemeChange,
  topBar,
  breadcrumbs,
  onNewChat,
  children,
}: LayoutShellProps) {
  const [activeView, setActiveView] = useState<ShellView>(initialView)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('agent-chat')
  const [activeRailTab, setActiveRailTab] = useState<RailTab>('context')
  const [serverStatus, setServerStatus] = useState<{ running: boolean; url?: string } | null>(null)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const hasLiveSession = useMemo(
    () => Array.from(metaMap.values()).some((m) => !m.hidden && !m.isArchived && m.isProcessing),
    [metaMap],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.getServerStatus) return
    let cancelled = false
    const refresh = () => {
      window.electronAPI.getServerStatus().then((status) => {
        if (!cancelled) setServerStatus(status)
      }).catch(() => {
        if (!cancelled) setServerStatus({ running: false })
      })
    }
    refresh()
    const id = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const resolvedTheme = useMemo(() => {
    if (theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
      return 'light'
    }
    return theme
  }, [theme])

  const activeLabel = navItems.find((item) => item.id === activeView)?.label ?? activeView

  const handleNavigate = (view: ShellView) => {
    setActiveView(view)
    onNavigate?.(view)
  }

  return (
    <div className={`layout-shell layout-shell--${resolvedTheme}`}>
      <aside
        className={`layout-sidebar ${sidebarCollapsed ? 'layout-sidebar--collapsed' : ''}`}
        aria-label="Primary"
      >
        <div className="layout-sidebar__header">
          {!sidebarCollapsed && (
            <img
              src={brandIconUrl}
              alt="ARCHstudio"
              className="layout-sidebar__brand"
              draggable={false}
            />
          )}
          <button
            type="button"
            className="layout-sidebar__toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        {onNewChat && (
          <button
            type="button"
            className="layout-new-chat"
            onClick={onNewChat}
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={16} aria-hidden="true" />
            {!sidebarCollapsed && <span>New chat</span>}
          </button>
        )}

        <nav className="layout-sidebar__nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeView === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`layout-nav-item ${isActive ? 'layout-nav-item--active' : ''}`}
                onClick={() => handleNavigate(item.id)}
                title={item.label}
              >
                <Icon size={18} aria-hidden="true" />
                {!sidebarCollapsed && <span className="layout-nav-item__label">{item.label}</span>}
              </button>
            )
          })}
        </nav>

        <div className="layout-sidebar__footer" />
      </aside>

      <div className="layout-main">
        <header className="layout-topbar">
          {topBar ?? (
            <div className="layout-topbar__default">
              <div className="layout-topbar__left">
                <h1 className="layout-topbar__title">
                  {activeLabel}
                </h1>
                {breadcrumbs && breadcrumbs.length > 0 && (
                  <nav className="layout-breadcrumbs" aria-label="Breadcrumb">
                    {breadcrumbs.map((crumb, index) => (
                      <React.Fragment key={index}>
                        {index > 0 && <span className="layout-breadcrumbs__sep">/</span>}
                        {crumb.onClick ? (
                          <button
                            type="button"
                            className="layout-breadcrumbs__link"
                            onClick={crumb.onClick}
                          >
                            {crumb.label}
                          </button>
                        ) : (
                          <span className="layout-breadcrumbs__current">{crumb.label}</span>
                        )}
                      </React.Fragment>
                    ))}
                  </nav>
                )}
              </div>
              <div className="layout-topbar__actions">
                <span
                  className="layout-topbar__status"
                  data-status={serverStatus === null ? 'loading' : serverStatus.running ? 'online' : 'offline'}
                >
                  <i />
                  {serverStatus ? (
                    serverStatus.running ? 'Server running' : 'Server offline'
                  ) : (
                    'Checking status…'
                  )}
                </span>
              </div>
            </div>
          )}
        </header>

        <main className="layout-content" role="main">
          {activeView === 'memory' ? (
            <MemoryPanel />
          ) : activeView === 'runs' ? (
            <RunsPanel />
          ) : activeView === 'projects' ? (
            <ProjectsPanel />
          ) : activeView === 'providers' ? (
            <ProvidersPanel />
          ) : activeView === 'integrations' ? (
            <IntegrationsPanel />
          ) : activeView === 'search' ? (
            <SearchPanel />
          ) : activeView === 'security' ? (
            <SecurityPanel />
          ) : activeView === 'settings' ? (
            <SettingsPanel />
          ) : activeView === 'media-lab' ? (
            <MediaLabPanel />
          ) : activeView === 'prompts' ? (
            <PromptStudioPanel />
          ) : activeView === 'command' ? (
            children ? (
              <section className="arch-agent-workspace" aria-label="Agent session workspace">
                <div className="arch-agent-workspace__tabs">
                  {WORKSPACE_TABS.map((tab) => {
                    const isImplemented = tab.id === 'agent-chat'
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={activeWorkspaceTab === tab.id ? 'is-active' : ''}
                        onClick={() => setActiveWorkspaceTab(tab.id)}
                        aria-label={isImplemented ? tab.label : `${tab.label} (not yet implemented)`}
                        title={isImplemented ? tab.label : `${tab.label} — coming soon`}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                  {hasLiveSession && <span className="arch-agent-workspace__live"><i /> Live</span>}
                  <div className="layout-theme-toggle layout-theme-toggle--live titlebar-no-drag">
                    {([
                      { mode: 'light' as ThemeMode, icon: Sun, label: 'Light' },
                      { mode: 'dark' as ThemeMode, icon: Moon, label: 'Dark' },
                      { mode: 'system' as ThemeMode, icon: Monitor, label: 'System' },
                    ]).map(({ mode: m, icon: Icon, label }) => (
                      <button
                        key={m}
                        type="button"
                        className={`layout-theme-option ${theme === m ? 'layout-theme-option--active' : ''}`}
                        onClick={() => onThemeChange?.(m)}
                        aria-label={`${label} theme`}
                        title={label}
                      >
                        <Icon size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>                <div className="arch-agent-workspace__body">
                <div className="arch-agent-workspace__session">
                  {activeWorkspaceTab === 'agent-chat' ? (
                    children
                  ) : (
                    <div className="layout-placeholder">
                      <Construction size={48} />
                      <p>{WORKSPACE_TABS.find((t) => t.id === activeWorkspaceTab)?.label} view is not yet implemented.</p>
                    </div>
                  )}
                </div>
                <aside className="arch-context-rail" aria-label="Session context">
                  <div className="arch-context-rail__tabs">
                    {RAIL_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={activeRailTab === tab.id ? 'is-active' : ''}
                        onClick={() => setActiveRailTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                    {activeRailTab === 'context' ? (
                    <>
                      <section>
                        <label>Active agent</label>
                        <div className="arch-agent-card">
                          <span className="arch-agent-card__mark">A</span>
                          <div><strong>ARCH Builder</strong><small>Owner agent</small></div>
                          <i />
                        </div>
                      </section>
                      <section>
                        <label>Session mode</label>
                        <div className="arch-context-row"><strong>Owner Auto</strong><span>Active</span></div>
                      </section>
                      <section>
                        <label>Model</label>
                        <div className="arch-context-row"><strong>Auto select</strong><span>Ready</span></div>
                      </section>
                      <section>
                        <label>Capabilities</label>
                        <div className="arch-capability-grid">
                          <span>Code</span><span>Files</span><span>Web</span><span>Tools</span>
                        </div>
                      </section>
                      <section className="arch-context-rail__meter">
                        <div><label>Memory</label><span>Local</span></div>
                        <b><i /></b>
                      </section>
                    </>
                  ) : (
                    <section>
                      <label>{activeRailTab === 'files' ? 'Session Files' : 'Recent Changes'}</label>
                      <div className="layout-placeholder" style={{ minHeight: 120 }}>
                        <FileText size={24} />
                        <p style={{ fontSize: 11, marginTop: 8 }}>
                          {activeRailTab === 'files'
                            ? 'No files attached to this session yet.'
                            : 'No changes recorded yet.'}
                        </p>
                      </div>
                    </section>
                  )}
                  </aside>
                </div>
              </section>
            ) : (
              <div className="layout-command-view">
                <HomeHero
                  onOpenCommand={() => handleNavigate('command')}
                  onExploreMemory={() => handleNavigate('memory')}
                />
                {/* Primary way back into a conversation. Without this, closing the
                    last chat leaves the Command view with no path to a new one. */}
                {onNewChat && (
                  <button type="button" className="layout-start-chat" onClick={onNewChat}>
                    <MessageSquarePlus size={18} aria-hidden="true" />
                    <span>
                      <strong>Start a new chat</strong>
                      <small>Open a fresh session with your agent</small>
                    </span>
                  </button>
                )}
                <CommandPanel />
              </div>
            )
          ) : (
            children ?? (
              <div className="layout-placeholder">
                <p>Select a view to get started.</p>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  )
}

export default LayoutShell
