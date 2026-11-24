/**
 * CompactSessionListFilter
 *
 * Bottom-sheet replacement for the desktop session-list filter dropdown,
 * used when AppShell is in compact / mobile mode. Mirrors the behaviour of
 * `CompactPermissionModeSelector` and `CompactWorkspaceSwitcher`: the trigger
 * is the same `HeaderIconButton` users see on desktop, but the picker opens
 * as a vaul `Drawer` so it isn't clipped by the narrow viewport / panel
 * container query the desktop Radix dropdown gets caught on.
 *
 * Behaviour notes vs. the desktop dropdown:
 * - Hierarchical submenus collapse to a single flat list per section
 *   (Statuses, Labels). Tapping a row toggles include; tapping the trailing
 *   mode chip on an active row toggles include ↔ exclude.
 * - Pinned filters (from the route, e.g. flagged / state / label views) are
 *   shown as disabled rows with a check mark, matching the dropdown.
 * - The search input filters statuses + labels into a single combined view,
 *   reusing the same scoring helpers as the desktop dropdown
 *   (`filterSessionStatuses`, `filterItems` from `label-menu-utils`).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Calendar,
  Check,
  Flag,
  Inbox,
  Layers,
  GripVertical,
  ListFilter,
  MailOpen,
  Search,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { LabelIcon } from '@/components/ui/label-icon'
import { filterSessionStatuses } from '@/components/ui/label-menu'
import {
  createLabelMenuItems,
  filterItems as filterLabelMenuItems,
  type LabelMenuItem,
} from '@/components/ui/label-menu-utils'
import { findLabelById } from '@craft-agent/shared/labels'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { type SessionStatus, type SessionStatusId } from '@/config/session-status-config'
import type { ChatGroupingMode } from './SessionList'

type FilterMode = 'include' | 'exclude'

interface PinnedFilters {
  pinnedStatusId: string | null
  pinnedLabelId: string | null
  pinnedFlagged: boolean
}

interface CompactSessionListFilterProps {
  listFilter: Map<SessionStatusId, FilterMode>
  setListFilter: (
    updater:
      | Map<SessionStatusId, FilterMode>
      | ((prev: Map<SessionStatusId, FilterMode>) => Map<SessionStatusId, FilterMode>),
  ) => void
  labelFilter: Map<string, FilterMode>
  setLabelFilter: (
    updater:
      | Map<string, FilterMode>
      | ((prev: Map<string, FilterMode>) => Map<string, FilterMode>),
  ) => void
  pinnedFilters: PinnedFilters
  effectiveSessionStatuses: SessionStatus[]
  displayLabelConfigs: LabelConfig[]
  labelConfigs: LabelConfig[]
  chatGroupingMode: ChatGroupingMode
  setChatGroupingMode: (mode: ChatGroupingMode) => void
  isStateSubView: boolean
  onOpenSearch: () => void
}

export function CompactSessionListFilter({
  listFilter,
  setListFilter,
  labelFilter,
  setLabelFilter,
  pinnedFilters,
  effectiveSessionStatuses,
  displayLabelConfigs,
  labelConfigs,
  chatGroupingMode,
  setChatGroupingMode,
  isStateSubView,
  onOpenSearch,
}: CompactSessionListFilterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const flatLabelItems = React.useMemo(
    (): LabelMenuItem[] => createLabelMenuItems(displayLabelConfigs),
    [displayLabelConfigs],
  )

  const trimmedQuery = query.trim()
  const isSearching = trimmedQuery !== ''

  const results = React.useMemo(() => {
    return {
      states: isSearching
        ? filterSessionStatuses(effectiveSessionStatuses, trimmedQuery)
        : effectiveSessionStatuses,
      labels: isSearching
        ? filterLabelMenuItems(flatLabelItems, trimmedQuery)
        : flatLabelItems,
    }
  }, [isSearching, trimmedQuery, effectiveSessionStatuses, flatLabelItems])

  const hasUserFilter = listFilter.size > 0 || labelFilter.size > 0
  const hasAnyFilter =
    hasUserFilter
    || pinnedFilters.pinnedFlagged
    || !!pinnedFilters.pinnedStatusId
    || !!pinnedFilters.pinnedLabelId

  const toggleStatus = (id: SessionStatusId) => {
    if (id === pinnedFilters.pinnedStatusId) return
    setListFilter(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, 'include')
      return next
    })
  }

  const cycleStatusMode = (id: SessionStatusId) => {
    setListFilter(prev => {
      const next = new Map(prev)
      const current = next.get(id)
      if (current === 'include') next.set(id, 'exclude')
      else if (current === 'exclude') next.delete(id)
      else next.set(id, 'include')
      return next
    })
  }

  const toggleLabel = (id: string) => {
    if (id === pinnedFilters.pinnedLabelId) return
    setLabelFilter(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, 'include')
      return next
    })
  }

  const cycleLabelMode = (id: string) => {
    setLabelFilter(prev => {
      const next = new Map(prev)
      const current = next.get(id)
      if (current === 'include') next.set(id, 'exclude')
      else if (current === 'exclude') next.delete(id)
      else next.set(id, 'include')
      return next
    })
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <HeaderIconButton
          icon={<ListFilter className="size-4" />}
          aria-label={t('sidebar.filterChats')}
          className={cn(hasUserFilter && 'bg-accent-tint text-accent hover:bg-accent-tint hover:text-accent')}
        />
      </DrawerTrigger>

      <DrawerContent className="max-h-[75vh]">
        <DrawerHeader className="flex flex-row items-center justify-between gap-3">
          <DrawerTitle>{t('sidebar.filterChats')}</DrawerTitle>
          {hasUserFilter && (
            <button
              type="button"
              onClick={() => {
                setListFilter(new Map())
                setLabelFilter(new Map())
              }}
              className="text-label text-secondary hover:text-foreground"
            >
              {t('common.clear')}
            </button>
          )}
        </DrawerHeader>

        <div className="px-4 pb-2">
          <label className="field-surface rounded-md px-3 h-control-xl flex items-center gap-2">
            <Search className="size-4 text-tertiary shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sidebar.searchStatusesLabels')}
              className="flex-1 min-w-0 bg-transparent text-copy-lg text-foreground placeholder:text-tertiary outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="shrink-0 size-7 flex items-center justify-center text-tertiary rounded-full hover:bg-fill-hover"
                aria-label={t('common.clear')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6">
          {!isSearching && hasAnyFilter && (
            <PinnedSummary
              pinnedFilters={pinnedFilters}
              effectiveSessionStatuses={effectiveSessionStatuses}
              labelConfigs={labelConfigs}
            />
          )}

          {results.states.length > 0 && (
            <Section title={t('sidebar.statuses')}>
              {results.states.map(state => {
                const isPinned = state.id === pinnedFilters.pinnedStatusId
                const mode = listFilter.get(state.id)
                const colorize = state.iconColorable
                return (
                  <FilterRow
                    key={state.id}
                    icon={state.icon}
                    iconColor={colorize ? state.resolvedColor : undefined}
                    bareIcon
                    label={state.label}
                    mode={mode}
                    pinned={isPinned}
                    onTap={() => toggleStatus(state.id)}
                    onModeTap={mode ? () => cycleStatusMode(state.id) : undefined}
                  />
                )
              })}
            </Section>
          )}

          {results.labels.length > 0 && (
            <Section title={t('sidebar.labels')}>
              {results.labels.map(item => {
                const isPinned = item.id === pinnedFilters.pinnedLabelId
                const mode = labelFilter.get(item.id)
                return (
                  <FilterRow
                    key={item.id}
                    icon={<LabelIcon label={item.config} size="lg" />}
                    label={
                      item.parentPath ? (
                        <>
                          <span className="text-tertiary">{item.parentPath}</span>
                          {item.label}
                        </>
                      ) : (
                        item.label
                      )
                    }
                    mode={mode}
                    pinned={isPinned}
                    onTap={() => toggleLabel(item.id)}
                    onModeTap={mode ? () => cycleLabelMode(item.id) : undefined}
                  />
                )
              })}
            </Section>
          )}

          {isSearching && results.states.length === 0 && results.labels.length === 0 && (
            <div className="px-4 py-6 text-center text-label text-tertiary">
              No matches
            </div>
          )}

          {!isSearching && (
            <Section title={t('sidebar.group')} icon={<Layers className="h-3.5 w-3.5" />}>
              <FilterRow
                icon={<Calendar className="h-4 w-4" />}
                label={t('sidebar.groupByDate')}
                radioSelected={chatGroupingMode === 'date'}
                onTap={() => setChatGroupingMode('date')}
              />
              {!isStateSubView && (
                <>
                  <FilterRow
                    icon={<Inbox className="h-4 w-4" />}
                    label={t('sidebar.groupByStatus')}
                    radioSelected={chatGroupingMode === 'status'}
                    onTap={() => setChatGroupingMode('status')}
                  />
                  <FilterRow
                    icon={<MailOpen className="h-4 w-4" />}
                    label={t('sidebar.groupByUnread')}
                    radioSelected={chatGroupingMode === 'unread'}
                    onTap={() => setChatGroupingMode('unread')}
                  />
                </>
              )}
              <FilterRow
                icon={<GripVertical className="h-4 w-4" />}
                label={t('sidebar.groupByManual')}
                radioSelected={chatGroupingMode === 'manual'}
                onTap={() => setChatGroupingMode('manual')}
              />
            </Section>
          )}

          {!isSearching && (
            <div className="px-2 pt-2">
              <DrawerClose asChild>
                <button
                  type="button"
                  onClick={onOpenSearch}
                  className="w-full flex items-center gap-3 px-2 min-h-row-touch rounded-md hover:bg-fill-hover active:bg-fill-pressed text-left"
                >
                  <Search className="size-4 text-tertiary shrink-0" />
                  <span className="text-copy font-medium">{t('sidebar.search')}</span>
                </button>
              </DrawerClose>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="pt-3">
      <div className="px-2 pb-1 flex items-center gap-1.5 text-label-sm font-medium text-tertiary">
        {icon}
        <span>{title}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function FilterRow({
  icon,
  iconColor,
  bareIcon,
  label,
  mode,
  pinned,
  radioSelected,
  onTap,
  onModeTap,
}: {
  icon: React.ReactNode
  iconColor?: string
  /** Status icons render via EntityIcon and accept a `bare` prop to skip their own container. */
  bareIcon?: boolean
  label: React.ReactNode
  mode?: FilterMode
  pinned?: boolean
  radioSelected?: boolean
  onTap?: () => void
  onModeTap?: () => void
}) {
  const renderedIcon = bareIcon
    ? (
      <span className="shrink-0 h-5 w-5 flex items-center justify-center" style={iconColor ? { color: iconColor } : undefined}>
        {React.isValidElement(icon)
          ? React.cloneElement(icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : icon}
      </span>
    )
    : (
      <span className="shrink-0 h-5 w-5 flex items-center justify-center" style={iconColor ? { color: iconColor } : undefined}>
        {icon}
      </span>
    )

  return (
    <div
      role="button"
      onClick={pinned ? undefined : onTap}
      className={cn(
        'flex items-center gap-3 px-3 min-h-row-touch rounded-md',
        pinned ? 'opacity-60' : 'cursor-pointer hover:bg-fill-hover active:bg-fill-pressed',
      )}
    >
      {renderedIcon}
      <span className="flex-1 min-w-0 text-copy truncate">{label}</span>
      {pinned && <Check className="size-4 text-tertiary shrink-0" />}
      {!pinned && radioSelected && <Check className="size-4 text-accent shrink-0" />}
      {!pinned && mode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onModeTap?.()
          }}
          className={cn(
            'shrink-0 h-9 min-w-9 px-2.5 rounded-sm text-label-sm font-medium flex items-center justify-center gap-1',
            mode === 'include'
              ? 'bg-raised text-foreground shadow-elev-1'
              : 'bg-destructive-tint text-destructive',
          )}
          aria-label={mode === 'include' ? 'Switch to exclude' : 'Switch to include'}
        >
          {mode === 'include' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}

function PinnedSummary({
  pinnedFilters,
  effectiveSessionStatuses,
  labelConfigs,
}: {
  pinnedFilters: PinnedFilters
  effectiveSessionStatuses: SessionStatus[]
  labelConfigs: LabelConfig[]
}) {
  const { t } = useTranslation()
  const pinnedStatus = pinnedFilters.pinnedStatusId
    ? effectiveSessionStatuses.find(s => s.id === pinnedFilters.pinnedStatusId)
    : null
  const pinnedLabel = pinnedFilters.pinnedLabelId
    ? findLabelById(labelConfigs, pinnedFilters.pinnedLabelId)
    : null

  if (!pinnedFilters.pinnedFlagged && !pinnedStatus && !pinnedLabel) return null

  return (
    <div className="px-2 pt-1 pb-2">
      <div className="flex flex-wrap gap-1.5 px-1">
        {pinnedFilters.pinnedFlagged && (
          <PinnedChip icon={<Flag className="h-3.5 w-3.5" />} label={t('sidebar.flagged')} />
        )}
        {pinnedStatus && (
          <PinnedChip
            icon={
              <span style={pinnedStatus.iconColorable ? { color: pinnedStatus.resolvedColor } : undefined}>
                {React.isValidElement(pinnedStatus.icon)
                  ? React.cloneElement(pinnedStatus.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
                  : pinnedStatus.icon}
              </span>
            }
            label={pinnedStatus.label}
          />
        )}
        {pinnedLabel && (
          <PinnedChip icon={<LabelIcon label={pinnedLabel} size="lg" />} label={pinnedLabel.name} />
        )}
      </div>
    </div>
  )
}

function PinnedChip({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-sm bg-fill-hover text-label text-secondary">
      <span className="shrink-0 inline-flex items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
      <Check className="h-3 w-3 shrink-0 text-tertiary" />
    </span>
  )
}
