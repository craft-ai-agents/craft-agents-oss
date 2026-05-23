import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronDown, ChevronRight, Plus, Search, Zap } from 'lucide-react'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { skillSelection } from '@/hooks/useEntitySelection'
import { useEntityListInteractions } from '@/hooks/useEntityListInteractions'
import { useAction } from '@/actions'
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list'
import { EntityRow } from '@/components/ui/entity-row'
import { SkillMenu } from './SkillMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import type { LoadedSkill } from '../../../shared/types'
import { isSystemGlobalSkillSlug } from '@craft-agent/shared/skills/system'
import {
  isSkillCategoryId,
  SKILL_CATEGORIES,
  SKILL_CATEGORY_LABELS,
  UNCATEGORIZED_SKILL_CATEGORY_ID,
  type SkillCategoryId,
} from '@craft-agent/shared/skills/types'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  className?: string
}

const SKILL_CATEGORY_ORDER = SKILL_CATEGORIES.map(category => category.id)

type SkillCategoryFilter = 'all' | SkillCategoryId

type SkillBrowseMetadata = {
  category?: unknown
  tags?: unknown
}

function getSkillBrowseFields(skill: LoadedSkill): { category: SkillCategoryId; tags: string[] } {
  const metadata = skill.metadata as SkillBrowseMetadata
  const category = isSkillCategoryId(metadata.category)
    ? metadata.category
    : UNCATEGORIZED_SKILL_CATEGORY_ID
  const rawTags: unknown = metadata.tags
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim())
    : typeof rawTags === 'string'
      ? rawTags.split(',').map(tag => tag.trim()).filter(Boolean)
      : []

  return { category, tags }
}

function getSkillCategory(skill: LoadedSkill): SkillCategoryId {
  return getSkillBrowseFields(skill).category
}

function getSkillTags(skill: LoadedSkill): string[] {
  return getSkillBrowseFields(skill).tags
}

function groupSkillsByCategory(skills: LoadedSkill[]): EntityListGroup<LoadedSkill>[] {
  const grouped = new Map<SkillCategoryId, LoadedSkill[]>()
  for (const category of SKILL_CATEGORY_ORDER) {
    grouped.set(category, [])
  }

  for (const skill of skills) {
    grouped.get(getSkillCategory(skill))?.push(skill)
  }

  return SKILL_CATEGORY_ORDER
    .map(category => ({
      key: category,
      label: SKILL_CATEGORY_LABELS[category],
      items: grouped.get(category) ?? [],
    }))
    .filter(group => group.items.length > 0)
}

function getCategoryCounts(skills: LoadedSkill[]): Map<SkillCategoryId, number> {
  const counts = new Map<SkillCategoryId, number>()
  for (const category of SKILL_CATEGORY_ORDER) {
    counts.set(category, 0)
  }

  for (const skill of skills) {
    const category = getSkillCategory(skill)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }

  return counts
}

function getSkillSearchText(skill: LoadedSkill): string {
  const category = getSkillCategory(skill)
  const categoryLabel = SKILL_CATEGORY_LABELS[category]
  const tags = getSkillTags(skill)

  return normalizeSearchText([
    skill.slug,
    skill.metadata.name,
    skill.metadata.description,
    category,
    categoryLabel,
    categoryLabel.replace(/&/g, 'and'),
    categoryLabel.replace(/&/g, ''),
    ...tags,
  ].join(' '))
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface SkillPanelItem {
  icon?: React.ReactNode
  title: React.ReactNode
  badges?: React.ReactNode
  trailing?: React.ReactNode
  menu?: React.ReactNode
}

interface GroupedSkillsPanelProps {
  skills: LoadedSkill[]
  selectedSkillSlug?: string | null
  onSkillClick: (skill: LoadedSkill) => void
  emptyState?: React.ReactNode
  className?: string
  mapItem: (skill: LoadedSkill) => SkillPanelItem
}

function GroupedSkillsPanel({
  skills,
  selectedSkillSlug,
  onSkillClick,
  emptyState,
  className,
  mapItem,
}: GroupedSkillsPanelProps) {
  const selectionStore = skillSelection.useSelectionStore()
  const groups = React.useMemo(() => groupSkillsByCategory(skills), [skills])
  const groupedSkills = React.useMemo(() => groups.flatMap(group => group.items), [groups])
  const itemIndexBySlug = React.useMemo(() => {
    return new Map(groupedSkills.map((skill, index) => [skill.slug, index]))
  }, [groupedSkills])
  const interactions = useEntityListInteractions<LoadedSkill>({
    items: groupedSkills,
    getId: (skill) => skill.slug,
    keyboard: {
      onNavigate: (skill) => onSkillClick(skill),
      onActivate: (skill) => onSkillClick(skill),
    },
    multiSelect: true,
    selectionStore,
  })

  useAction('navigator.clearSelection', () => {
    interactions.selection.clear()
  }, {
    enabled: () => interactions.selection.isMultiSelectActive,
  }, [interactions.selection])

  return (
    <EntityList<LoadedSkill>
      groups={groups}
      getKey={(skill) => skill.slug}
      containerRef={interactions.listProps.containerRef}
      containerProps={interactions.listProps.containerProps}
      className={className}
      emptyState={emptyState}
      renderItem={(skill, index, isFirst) => {
        const mapped = mapItem(skill)
        const rowProps = interactions.getRowProps(skill, itemIndexBySlug.get(skill.slug) ?? index)

        return (
          <EntityRow
            icon={mapped.icon}
            title={mapped.title}
            badges={mapped.badges}
            trailing={mapped.trailing}
            isSelected={selectedSkillSlug === skill.slug}
            isInMultiSelect={rowProps.isInMultiSelect}
            showSeparator={!isFirst}
            onClick={() => onSkillClick(skill)}
            buttonProps={rowProps.buttonProps}
            menuContent={mapped.menu}
          />
        )
      }}
    />
  )
}

export function SkillsListPanel({
  skills,
  onDeleteSkill,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const [collapsedCategories, setCollapsedCategories] = React.useState<Set<string>>(() => new Set())
  const visibleSkills = React.useMemo(
    () => skills.filter(skill => skill.source !== 'global' || !isSystemGlobalSkillSlug(skill.slug)),
    [skills],
  )

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  const toggleCategory = React.useCallback((category: string) => {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }, [])
  return (
    <>
      <div className={className ? `flex min-h-0 flex-1 flex-col ${className}` : 'flex min-h-0 flex-1 flex-col'}>
        {className?.includes('runneros-library-grid') ? (
          <div className="runneros-glass-route min-h-0 flex-1 overflow-y-auto px-8 py-8">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#fdba74]">
                  <Zap className="h-3.5 w-3.5" />
                  Skill layer
                </div>
                <h1 className="text-[28px] font-semibold leading-tight text-white">{t('sidebar.skills')}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Reusable capabilities available to agents in this workspace.</p>
              </div>
              <div className="flex items-center gap-2">
                {workspaceRootPath && (
                  <EditPopover
                    align="end"
                    trigger={
                      <button
                        type="button"
                        className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.045] px-3 text-xs font-medium text-white/76 transition-colors hover:bg-white/[0.08] hover:text-white"
                      >
                        <Plus className="size-3.5" />
                        Add skill
                      </button>
                    }
                    {...getEditConfig('add-skill', workspaceRootPath)}
                  />
                )}
                {workspaceId && (
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#fb923c]/30 bg-[#f97316]/18 px-3 text-xs font-medium text-white shadow-middle transition-colors hover:bg-[#f97316]/26"
                    title="Open global skills library"
                  >
                    <BookOpen className="size-3.5" />
                    Library
                  </button>
                )}
              </div>
            </div>

            {visibleSkills.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-white/[0.12] bg-white/[0.03] p-8 text-center text-sm text-white/55">
                {t('skillsList.noSkillsConfigured')}
              </div>
            ) : (
              <div className="space-y-5">
                {groupSkillsByCategory(visibleSkills).map((group) => {
                  const collapsed = collapsedCategories.has(group.key)

                  return (
                  <section key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(group.key)}
                      className="mb-2 flex w-full items-center gap-2.5 text-left"
                      aria-expanded={!collapsed}
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0 text-white/30" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-white/30" />
                      )}
                      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">{group.label}</h2>
                      <div className="h-px flex-1 bg-white/[0.06]" />
                      <span className="text-[11px] text-white/32">{group.items.length}</span>
                    </button>
                    {!collapsed && (
                    <div className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-3">
                      {group.items.map((skill) => {
                        const tags = getSkillTags(skill)
                        return (
                          <div key={skill.slug} className="group relative min-h-[78px] overflow-hidden rounded-[11px] border border-white/[0.075] bg-white/[0.035] p-2.5 shadow-middle transition-all duration-200 hover:-translate-y-0.5 hover:border-[#fb923c]/35 hover:bg-white/[0.06] hover:shadow-middle">
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#fb923c]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                            <button type="button" onClick={() => onSkillClick(skill)} className="flex w-full items-start gap-2 text-left">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.08] bg-white/[0.06] shadow-middle">
                                <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
                              </div>
                              <div className="min-w-0 flex-1 pr-6">
                                <div className="truncate text-[12px] font-semibold text-white">{skill.metadata.name}</div>
                                <p className="mt-1 line-clamp-2 text-[9.5px] leading-3.5 text-white/44">{skill.metadata.description}</p>
                              </div>
                            </button>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {skill.source === 'project' && (
                                <span className="rounded-[6px] border border-white/[0.06] bg-black/20 px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.10em] text-white/36">
                                  {t('skillsList.projectBadge')}
                                </span>
                              )}
                              {tags.slice(0, 3).map(tag => (
                                <span key={tag} className="rounded-[6px] border border-white/[0.06] bg-black/20 px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.10em] text-white/36">
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                              <SkillMenu
                                skillSlug={skill.slug}
                                skillName={skill.metadata.name}
                                onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
                                onShowInFinder={() => {
                                  if (canRevealLocally) void window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
                                }}
                                canShowInFinder={canRevealLocally}
                                onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
                                canDelete={skill.source === 'workspace'}
                                deleteLabel={skill.source === 'workspace' ? t('skillsList.deleteSkill') : t('skillsList.managedByProject')}
                                onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? () => {
                                  setSendResourceSlug(skill.slug)
                                  setSendResourceLabel(skill.metadata.name)
                                  setSendDialogOpen(true)
                                } : undefined}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    )}
                  </section>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
        <>
        {workspaceId && (
          <div className="flex shrink-0 items-center justify-end px-2 py-1">
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
              title="Open global skills library"
            >
              <BookOpen className="size-3.5" />
              Library
            </button>
          </div>
        )}
        <GroupedSkillsPanel
          skills={visibleSkills}
          selectedSkillSlug={selectedSkillSlug}
          onSkillClick={onSkillClick}
          className="min-h-0 flex-1"
          emptyState={
            <EntityListEmptyScreen
              icon={<Zap />}
              title={t('skillsList.noSkillsConfigured')}
              description={t('skillsList.emptyDescription')}
              docKey="skills"
            >
              {workspaceRootPath && (
                <EditPopover
                  align="center"
                  trigger={
                    <button className="inline-flex h-7 items-center rounded-[8px] bg-background px-3 text-xs font-medium shadow-minimal transition-colors hover:bg-foreground/[0.03]">
                      {t('skillsList.addSkill')}
                    </button>
                  }
                  {...getEditConfig('add-skill', workspaceRootPath)}
                />
              )}
            </EntityListEmptyScreen>
          }
          mapItem={(skill) => ({
            icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
            title: skill.metadata.name,
            badges: (
              <span className="flex min-w-0 items-center gap-1.5">
                {skill.source === 'project' && (
                  <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('skillsList.projectBadge')}
                  </span>
                )}
                <span className="truncate">{skill.metadata.description}</span>
              </span>
            ),
            menu: (
              <SkillMenu
                skillSlug={skill.slug}
                skillName={skill.metadata.name}
                onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
                onShowInFinder={() => {
                  if (canRevealLocally) {
                    void window.electronAPI.showInFolder(`${skill.path}/SKILL.md`)
                  }
                }}
                canShowInFinder={canRevealLocally}
                onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
                canDelete={skill.source === 'workspace'}
                deleteLabel={skill.source === 'workspace' ? t('skillsList.deleteSkill') : t('skillsList.managedByProject')}
                onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? () => {
                  setSendResourceSlug(skill.slug)
                  setSendResourceLabel(skill.metadata.name)
                  setSendDialogOpen(true)
                } : undefined}
              />
            ),
          })}
        />
        </>
        )}
      </div>

      {workspaceId && (
        <GlobalSkillsLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          workspaceId={workspaceId}
          activeSkills={skills}
        />
      )}

      {sendResourceSlug && (
        <SendResourceToWorkspaceDialog
          open={sendDialogOpen}
          onOpenChange={setSendDialogOpen}
          resourceType="skill"
          resourceIds={[sendResourceSlug]}
          resourceLabel={sendResourceLabel}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
        />
      )}

    </>
  )
}

interface GlobalSkillsLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  activeSkills: LoadedSkill[]
}

function GlobalSkillsLibraryDialog({
  open,
  onOpenChange,
  workspaceId,
  activeSkills,
}: GlobalSkillsLibraryDialogProps) {
  const [globalSkills, setGlobalSkills] = React.useState<LoadedSkill[]>([])
  const [enabledSlugs, setEnabledSlugs] = React.useState<Set<string>>(new Set())
  const [query, setQuery] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState<SkillCategoryFilter>('all')
  const [loading, setLoading] = React.useState(false)
  const [updatingSlug, setUpdatingSlug] = React.useState<string | null>(null)
  const activeBySlug = React.useMemo(() => new Map(activeSkills.map(skill => [skill.slug, skill])), [activeSkills])
  const categoryCounts = React.useMemo(() => getCategoryCounts(globalSkills), [globalSkills])
  const visibleCategories = React.useMemo(() => {
    return SKILL_CATEGORY_ORDER.filter(category => (categoryCounts.get(category) ?? 0) > 0)
  }, [categoryCounts])

  React.useEffect(() => {
    if (categoryFilter !== 'all' && (categoryCounts.get(categoryFilter) ?? 0) === 0) {
      setCategoryFilter('all')
    }
  }, [categoryCounts, categoryFilter])

  React.useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    Promise.all([
      window.electronAPI.listGlobalSkills(workspaceId),
      window.electronAPI.getEnabledGlobalSkills(workspaceId),
    ]).then(([loadedGlobalSkills, loadedEnabledSlugs]) => {
      if (cancelled) return
      setGlobalSkills((loadedGlobalSkills || []).slice().sort((a, b) => a.metadata.name.localeCompare(b.metadata.name)))
      setEnabledSlugs(new Set(loadedEnabledSlugs || []))
    }).catch((error) => {
      console.error('[Skills] Failed to load global library:', error)
      if (!cancelled) {
        setGlobalSkills([])
        setEnabledSlugs(new Set())
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, workspaceId])

  const filteredSkills = React.useMemo(() => {
    const normalized = normalizeSearchText(query)
    return globalSkills.filter(skill => {
      const matchesCategory = categoryFilter === 'all' || getSkillCategory(skill) === categoryFilter
      const matchesQuery = !normalized || getSkillSearchText(skill).includes(normalized)
      return matchesCategory && matchesQuery
    })
  }, [globalSkills, query, categoryFilter])

  const filteredGroups = React.useMemo(() => groupSkillsByCategory(filteredSkills), [filteredSkills])

  const handleToggle = React.useCallback(async (skill: LoadedSkill, enabled: boolean) => {
    setUpdatingSlug(skill.slug)
    setEnabledSlugs(prev => {
      const next = new Set(prev)
      if (enabled) next.add(skill.slug)
      else next.delete(skill.slug)
      return next
    })

    try {
      const persisted = await window.electronAPI.setGlobalSkillEnabled(workspaceId, skill.slug, enabled)
      setEnabledSlugs(new Set(persisted || []))
    } catch (error) {
      console.error('[Skills] Failed to update global skill:', error)
      setEnabledSlugs(prev => {
        const next = new Set(prev)
        if (enabled) next.delete(skill.slug)
        else next.add(skill.slug)
        return next
      })
    } finally {
      setUpdatingSlug(null)
    }
  }, [workspaceId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] min-w-0 max-w-2xl overflow-hidden p-0">
        <DialogHeader className="min-w-0 border-b border-foreground/10 px-5 py-4">
          <DialogTitle className="text-base">Global skills library</DialogTitle>
          <DialogDescription>
            Enable only the shared skills this workspace should see.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 overflow-hidden px-5 pb-5">
          <div className="mb-3 flex h-9 min-w-0 items-center gap-2 rounded-md border border-foreground/10 bg-background px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search global skills"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="mb-3 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] transition-colors ${
                categoryFilter === 'all'
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
              }`}
            >
              All
              <span className="text-[10px] text-muted-foreground">{globalSkills.length}</span>
            </button>
            {visibleCategories.map(category => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] transition-colors ${
                  categoryFilter === category
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
                }`}
              >
                {SKILL_CATEGORY_LABELS[category]}
                <span className="text-[10px] text-muted-foreground">{categoryCounts.get(category)}</span>
              </button>
            ))}
          </div>

          <div className="max-h-[min(420px,55vh)] min-w-0 overflow-y-auto rounded-md border border-foreground/10">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading skills...</div>
            ) : filteredSkills.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No global skills found</div>
            ) : (
              filteredGroups.map((group, groupIndex) => (
                <div key={group.key} className={groupIndex > 0 ? 'border-t border-foreground/10' : undefined}>
                  <div className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((skill, index) => {
                    const activeSkill = activeBySlug.get(skill.slug)
                    const isEnabled = enabledSlugs.has(skill.slug)
                    const isLocalOverride = !!activeSkill && activeSkill.source !== 'global'
                    const isUpdating = updatingSlug === skill.slug
                    const category = getSkillCategory(skill)
                    const tags = getSkillTags(skill)

                    return (
                      <div
                        key={skill.slug}
                        className={`flex min-w-0 items-center gap-3 px-4 py-3 ${index > 0 ? 'border-t border-foreground/10' : ''}`}
                      >
                        <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium">{skill.metadata.name}</div>
                            {isLocalOverride && (
                              <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                Local override
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {skill.metadata.description}
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                            <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {SKILL_CATEGORY_LABELS[category]}
                            </span>
                            {tags.slice(0, 3).map(tag => (
                              <span key={tag} className="rounded-full bg-foreground/[0.03] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                            {tags.length > 3 && (
                              <span className="px-1 text-[10px] text-muted-foreground">
                                +{tags.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                        <Switch
                          className="shrink-0"
                          checked={isEnabled}
                          disabled={isUpdating}
                          onCheckedChange={(checked) => {
                            void handleToggle(skill, checked)
                          }}
                          aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${skill.metadata.name}`}
                        />
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
