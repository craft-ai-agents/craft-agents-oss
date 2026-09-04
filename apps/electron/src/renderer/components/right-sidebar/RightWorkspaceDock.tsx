import * as React from 'react'
import {
  ChevronRight,
  FileOutput,
  Files,
  ListChecks,
  Maximize2,
  PanelRightClose,
  Plus,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { SessionFilesSection } from './SessionFilesSection'
import { SessionArtifactsSection } from './SessionArtifactsSection'
import { DeliverableBriefSection } from './DeliverableBriefSection'
import {
  normalizeRightDockTabs,
  type OpenDockTab,
  type RightDockTabType,
} from './right-workspace-dock-state'

export { normalizeRightDockTabs } from './right-workspace-dock-state'
export type { OpenDockTab, RightDockTabType } from './right-workspace-dock-state'

interface RightDockTabDefinition {
  type: RightDockTabType
  icon: React.ComponentType<{ className?: string }>
  multiple?: boolean
}

const TAB_DEFINITIONS: RightDockTabDefinition[] = [
  { type: 'brief', icon: ListChecks },
  { type: 'artifacts', icon: FileOutput },
  { type: 'files', icon: Files },
]

interface RightWorkspaceDockProps {
  activeSessionId: string | null
  sessionFolderPath?: string
  isProcessing?: boolean
  onClose: () => void
  overlay?: boolean
}

export function RightWorkspaceDock({
  activeSessionId,
  sessionFolderPath,
  isProcessing,
  onClose,
  overlay = false,
}: RightWorkspaceDockProps) {
  const { t } = useTranslation()
  const [width, setWidth] = React.useState(() => storage.get(storage.KEYS.rightDockWidth, 420))
  const [tabs, setTabs] = React.useState<OpenDockTab[]>(() =>
    normalizeRightDockTabs(storage.get<OpenDockTab[]>(storage.KEYS.rightDockTabs, [
      { id: 'brief', type: 'brief' },
      { id: 'artifacts', type: 'artifacts' },
    ]))
  )
  const [activeTabId, setActiveTabId] = React.useState(() => storage.get(storage.KEYS.rightDockActiveTab, 'brief'))
  const [maximized, setMaximized] = React.useState(false)
  const resizingRef = React.useRef(false)

  React.useEffect(() => storage.set(storage.KEYS.rightDockWidth, width), [width])
  React.useEffect(() => storage.set(storage.KEYS.rightDockTabs, tabs), [tabs])
  React.useEffect(() => storage.set(storage.KEYS.rightDockActiveTab, activeTabId), [activeTabId])

  React.useEffect(() => {
    if (tabs.some(tab => tab.id === activeTabId)) return
    setActiveTabId(tabs[0]?.id ?? 'brief')
  }, [activeTabId, tabs])

  React.useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!resizingRef.current || maximized) return
      const next = Math.min(Math.max(window.innerWidth - event.clientX, 320), Math.floor(window.innerWidth * 0.5))
      setWidth(next)
    }
    const handleUp = () => {
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [maximized])

  const openTab = React.useCallback((definition: RightDockTabDefinition) => {
    const existing = tabs.find(tab => tab.type === definition.type)
    if (existing && !definition.multiple) {
      setActiveTabId(existing.id)
      return
    }
    const id = definition.multiple ? `${definition.type}-${crypto.randomUUID().slice(0, 6)}` : definition.type
    setTabs(current => [...current, { id, type: definition.type }])
    setActiveTabId(id)
  }, [tabs])

  const closeTab = React.useCallback((id: string) => {
    setTabs(current => {
      if (current.length === 1) return current
      const index = current.findIndex(tab => tab.id === id)
      const next = current.filter(tab => tab.id !== id)
      if (id === activeTabId) setActiveTabId(next[Math.min(index, next.length - 1)]?.id ?? next[0].id)
      return next
    })
  }, [activeTabId])

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]

  return (
    <aside
      className={cn(
        'relative z-panel flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-background shadow-middle',
        (maximized || overlay) && 'absolute inset-y-0 right-0 z-overlay',
      )}
      style={{ width: maximized ? 'min(960px, calc(100vw - 24px))' : overlay ? `min(${width}px, calc(100vw - 24px))` : width, borderRadius: 12 }}
      aria-label={t('rightDock.title')}
    >
      {!maximized && !overlay && (
        <div
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize"
          onMouseDown={event => {
            event.preventDefault()
            resizingRef.current = true
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
        />
      )}

      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-foreground/[0.06] px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.map(tab => {
            const definition = TAB_DEFINITIONS.find(item => item.type === tab.type)!
            const Icon = definition.icon
            const label = t(`rightDock.${tab.type}`)
            const duplicateCount = tabs.filter(item => item.type === tab.type).length
            const duplicateIndex = tabs.filter(item => item.type === tab.type).findIndex(item => item.id === tab.id) + 1
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  'group flex h-8 max-w-40 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
                  tab.id === activeTabId ? 'bg-foreground/[0.07] text-foreground' : 'text-foreground/45 hover:bg-foreground/[0.035] hover:text-foreground/70',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}{duplicateCount > 1 ? ` ${duplicateIndex}` : ''}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t('rightDock.closeTab', { name: label })}
                  onClick={event => { event.stopPropagation(); closeTab(tab.id) }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      closeTab(tab.id)
                    }
                  }}
                  className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-foreground/10 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            )
          })}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground/50 hover:bg-foreground/[0.05] hover:text-foreground">
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="start" minWidth="min-w-64">
              {TAB_DEFINITIONS.map(definition => {
                const Icon = definition.icon
                return (
                  <StyledDropdownMenuItem key={definition.type} onSelect={() => openTab(definition)}>
                    <Icon className="h-4 w-4" />
                    <span className="flex-1">{t(`rightDock.${definition.type}`)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-foreground/25" />
                  </StyledDropdownMenuItem>
                )
              })}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => setMaximized(value => !value)} className="rounded-md p-1.5 text-foreground/45 hover:bg-foreground/[0.05] hover:text-foreground" aria-label={t('rightDock.maximize')}>
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-foreground/45 hover:bg-foreground/[0.05] hover:text-foreground" aria-label={t('rightDock.close')}>
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab?.type === 'brief' && (
          <DeliverableBriefSection
            key={`brief:${activeSessionId ?? 'empty'}`}
            sessionId={activeSessionId}
            isProcessing={isProcessing}
          />
        )}
        {activeTab?.type === 'artifacts' && (
          <SessionArtifactsSection
            key={`artifacts:${activeSessionId ?? 'empty'}`}
            sessionId={activeSessionId}
            isProcessing={isProcessing}
          />
        )}
        {activeTab?.type === 'files' && (
          activeSessionId
            ? <SessionFilesSection key={`files:${activeSessionId}`} sessionId={activeSessionId} sessionFolderPath={sessionFolderPath} hideHeader />
            : <DockEmpty icon={Files} title={t('rightDock.selectSession')} />
        )}
      </div>
    </aside>
  )
}

function DockEmpty({ icon: Icon, title }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center px-8 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.04] text-foreground/40">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground/75">{title}</p>
    </div>
  )
}
