/**
 * Entity multi-view tabs: Standard | Map | Outline | Graph | SiYuan map | …
 * Generalizes SessionViewTabs for session / note / knowledge surfaces.
 * Spec: docs/superpowers/specs/2026-08-08-entity-mindmap-views-design.md
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitBranch,
  ListTree,
  MessageSquare,
  Network,
  Share2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'

export type EntityViewId =
  | 'standard'
  | 'map'
  | 'outline'
  | 'graph'
  | 'mindmap'
  | 'teamchat'

export interface EntityViewCapability {
  id: EntityViewId
  available: boolean
  labelKey: string
  icon: LucideIcon
}

const DEFAULT_ICONS: Record<EntityViewId, LucideIcon> = {
  standard: MessageSquare,
  map: Network,
  outline: ListTree,
  graph: Share2,
  mindmap: Network,
  teamchat: GitBranch,
}

export function defaultSessionEntityCapabilities(opts?: {
  siyuanConnected?: boolean
}): EntityViewCapability[] {
  const siyuan = opts?.siyuanConnected ?? false
  return [
    { id: 'standard', available: true, labelKey: 'entityView.standard', icon: DEFAULT_ICONS.standard },
    { id: 'map', available: true, labelKey: 'entityView.map', icon: DEFAULT_ICONS.map },
    { id: 'outline', available: true, labelKey: 'entityView.outline', icon: DEFAULT_ICONS.outline },
    { id: 'graph', available: siyuan, labelKey: 'entityView.graph', icon: DEFAULT_ICONS.graph },
    {
      id: 'mindmap',
      available: siyuan,
      labelKey: 'entityView.mindmapSiyuan',
      icon: DEFAULT_ICONS.mindmap,
    },
    { id: 'teamchat', available: false, labelKey: 'entityView.teamChat', icon: DEFAULT_ICONS.teamchat },
  ]
}

export function defaultNoteEntityCapabilities(): EntityViewCapability[] {
  return [
    { id: 'standard', available: true, labelKey: 'entityView.standard', icon: DEFAULT_ICONS.standard },
    { id: 'map', available: true, labelKey: 'entityView.map', icon: DEFAULT_ICONS.map },
    { id: 'outline', available: true, labelKey: 'entityView.outline', icon: DEFAULT_ICONS.outline },
  ]
}

export function defaultKnowledgeEntityCapabilities(opts?: {
  siyuanConnected?: boolean
}): EntityViewCapability[] {
  const siyuan = opts?.siyuanConnected ?? false
  return [
    { id: 'standard', available: true, labelKey: 'entityView.standard', icon: DEFAULT_ICONS.standard },
    { id: 'map', available: true, labelKey: 'entityView.map', icon: DEFAULT_ICONS.map },
    { id: 'outline', available: true, labelKey: 'entityView.outline', icon: DEFAULT_ICONS.outline },
    { id: 'graph', available: siyuan, labelKey: 'entityView.graph', icon: DEFAULT_ICONS.graph },
  ]
}

function readStoredView(
  scopeKey: string,
  capabilities: EntityViewCapability[],
  fallback: EntityViewId,
): EntityViewId {
  const fromNew = storage.get<string | null>(storage.KEYS.entityViewMode, null, scopeKey)
  const legacySessionId = scopeKey.startsWith('session:') ? scopeKey.slice('session:'.length) : null
  const fromLegacy =
    legacySessionId != null
      ? storage.get<string | null>(storage.KEYS.sessionViewMode, null, legacySessionId)
      : null
  const raw = fromNew ?? fromLegacy ?? fallback
  const available = capabilities.some((c) => c.id === raw && c.available)
  return available ? (raw as EntityViewId) : fallback
}

export function useEntityView(
  scopeKey: string,
  capabilities: EntityViewCapability[],
  defaultId: EntityViewId = 'standard',
): [EntityViewId, (id: EntityViewId) => void] {
  const capsKey = capabilities.map((c) => `${c.id}:${c.available ? 1 : 0}`).join(',')

  const [view, setViewState] = React.useState<EntityViewId>(() =>
    readStoredView(scopeKey, capabilities, defaultId),
  )

  React.useEffect(() => {
    setViewState(readStoredView(scopeKey, capabilities, defaultId))
    // capabilities identity via capsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capsKey tracks availability
  }, [scopeKey, capsKey, defaultId])

  const setView = React.useCallback(
    (id: EntityViewId) => {
      setViewState(id)
      storage.set(storage.KEYS.entityViewMode, id, scopeKey)
      // Keep legacy session key in sync for session scopes
      if (scopeKey.startsWith('session:')) {
        storage.set(storage.KEYS.sessionViewMode, id, scopeKey.slice('session:'.length))
      }
    },
    [scopeKey],
  )

  return [view, setView]
}

export interface EntityViewTabsProps {
  value: EntityViewId
  onChange: (id: EntityViewId) => void
  capabilities: EntityViewCapability[]
  className?: string
}

export function EntityViewTabs({ value, onChange, capabilities, className }: EntityViewTabsProps) {
  const { t } = useTranslation()
  const visible = capabilities.filter((c) => c.available || c.id === value)

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 px-3 py-1.5 border-b border-border/40 bg-background/40 shrink-0',
        className,
      )}
      role="tablist"
      aria-label={t('entityView.tabsLabel')}
    >
      {visible.map(({ id, labelKey, icon: Icon, available }) => {
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={!available && !active}
            onClick={() => available && onChange(id)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
              !available && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{t(labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}

export interface EntityViewPlaceholderProps {
  view: EntityViewId
  labelKey?: string
}

export function EntityViewPlaceholder({ view, labelKey }: EntityViewPlaceholderProps) {
  const { t } = useTranslation()
  const Icon = DEFAULT_ICONS[view] ?? Network
  const key = labelKey ?? `entityView.${view}`

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center min-h-0">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/5 text-muted-foreground">
        <Icon className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t(key)}</p>
        <p className="text-sm text-muted-foreground">{t('entityView.comingSoon')}</p>
      </div>
    </div>
  )
}
