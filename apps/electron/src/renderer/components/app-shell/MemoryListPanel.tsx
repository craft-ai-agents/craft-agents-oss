import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Brain, Pencil, Trash2, Check, Plus, Link2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import type { Lesson, LessonCategory, LessonConflictVerdict, LessonScope, MemoryInsights, ProjectMemoryDto, PromotionCandidate } from '@craft-agent/shared/memory/types'
import { useNavigation, routes } from '@/contexts/NavigationContext'
import { activeSessionIdAtom, sessionMetaMapAtom } from '@/atoms/sessions'

export interface MemoryListPanelProps {
  workspaceId?: string
  className?: string
}

const BUILTIN_CATEGORIES: LessonCategory[] = ['correction', 'preference', 'workflow', 'knowledge']

function formatTokenEstimate(text: string): number {
  return Math.ceil((text ?? '').length / 4)
}

function scopeChipClass(scope: LessonScope): string {
  return scope === 'global'
    ? 'bg-accent/15 text-accent'
    : 'bg-foreground/5 text-muted-foreground'
}

function sectionTitleClass(): string {
  return 'px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70'
}

// Rule identity across stores mirrors server-core lessonKey: trim + lowercase.
const ruleKey = (rule: string): string => rule.trim().toLowerCase()

export function MemoryListPanel({ workspaceId, className }: MemoryListPanelProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()

  const [lessons, setLessons] = React.useState<Lesson[]>([])
  const [preferences, setPreferences] = React.useState('')
  const [context, setContext] = React.useState('')
  // M5: read-only project MEMORY.md of the project the active session is bound
  // to (project memory is already prompt-injected by the agents; this only shows it).
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const activeProjectId = activeSessionId ? sessionMetaMap.get(activeSessionId)?.projectId : undefined
  const [projectMemory, setProjectMemory] = React.useState<ProjectMemoryDto | null>(null)
  const [historyDates, setHistoryDates] = React.useState<string[]>([])
  const [historyDate, setHistoryDate] = React.useState<string | null>(null)
  const [historyContent, setHistoryContent] = React.useState('')
  // L3: rules used in ≥2 workspaces, candidates for global promotion
  const [promotionCandidates, setPromotionCandidates] = React.useState<PromotionCandidate[]>([])
  // Y1: 7-day audit counters + live store aggregates for the insights card
  const [insights, setInsights] = React.useState<MemoryInsights | null>(null)
  // L2: conflicts reported by ADD_LESSON for the just-added rule (panel stays in the form)
  const [addConflicts, setAddConflicts] = React.useState<{
    rule: string
    workspaceId: string | null
    scope: LessonScope
    conflicts: LessonConflictVerdict[]
  } | null>(null)

  const [formOpen, setFormOpen] = React.useState(false)
  const [formRule, setFormRule] = React.useState('')
  const [formCategory, setFormCategory] = React.useState<LessonCategory>('workflow')
  const [formScope, setFormScope] = React.useState<LessonScope>('workspace')
  const [formNegative, setFormNegative] = React.useState(false)
  const [categoryTab, setCategoryTab] = React.useState<string | 'all'>('all')
  const [customCategory, setCustomCategory] = React.useState('')
  const [collapsedSections, setCollapsedSections] = React.useState<Record<string, boolean>>({
    context: false,
    history: true,
    project: false,
  })
  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }


  const [editingRule, setEditingRule] = React.useState<string | null>(null)
  const [editDraft, setEditDraft] = React.useState('')
  const [confirmDeleteRule, setConfirmDeleteRule] = React.useState<string | null>(null)

  const loadLessons = React.useCallback(() => {
    window.electronAPI
      .listMemoryLessons('both', workspaceId)
      .then(setLessons)
      .catch(() => setLessons([]))
  }, [workspaceId])

  const loadContext = React.useCallback(() => {
    window.electronAPI
      .getMemoryContext(workspaceId)
      .then((dto) => { setPreferences(dto.preferences); setContext(dto.context) })
      .catch(() => { setPreferences(''); setContext('') })
  }, [workspaceId])

  const loadHistoryDates = React.useCallback(() => {
    if (!workspaceId) { setHistoryDates([]); return }
    window.electronAPI
      .listMemoryHistory(workspaceId)
      .then((dto) => setHistoryDates(dto.dates))
      .catch(() => setHistoryDates([]))
  }, [workspaceId])

  const loadPromotionCandidates = React.useCallback(() => {
    window.electronAPI
      .listPromotionCandidates()
      .then(setPromotionCandidates)
      .catch(() => setPromotionCandidates([]))
  }, [])

  // Y1: the server accepts an optional workspace id — without one the card
  // falls back to global-only aggregates (audit reads are best-effort).
  const loadInsights = React.useCallback(() => {
    window.electronAPI
      .listInsights(workspaceId)
      .then(setInsights)
      .catch(() => setInsights(null))
  }, [workspaceId])

  const loadProjectMemory = React.useCallback(() => {
    if (!workspaceId || !activeProjectId) { setProjectMemory(null); return }
    window.electronAPI
      .getProjectMemory(workspaceId, activeProjectId)
      .then(setProjectMemory)
      .catch(() => setProjectMemory(null))
  }, [workspaceId, activeProjectId])

  React.useEffect(() => {
    loadLessons()
    loadContext()
    loadHistoryDates()
    loadPromotionCandidates()
    loadProjectMemory()
    loadInsights()
    setHistoryDate(null)
    setHistoryContent('')
    setAddConflicts(null)
    const off = window.electronAPI.onMemoryChanged(() => {
      loadLessons()
      loadContext()
      loadHistoryDates()
      loadPromotionCandidates()
      loadProjectMemory()
      loadInsights()
    })
    // Y1: pendingCount lives in the card, so pending-queue changes refresh it too.
    const offPending = window.electronAPI.onSkillsPendingChanged(() => loadInsights())
    return () => { off(); offPending() }
  }, [loadLessons, loadContext, loadHistoryDates, loadPromotionCandidates, loadProjectMemory, loadInsights])

  const openDate = (date: string) => {
    if (!workspaceId) return
    window.electronAPI
      .listMemoryHistory(workspaceId, date)
      .then((dto) => { setHistoryDate(dto.date); setHistoryContent(dto.content) })
      .catch(() => toast.error(t('memory.historyLoadFailed')))
  }

  const handleAdd = async () => {
    const rule = formRule.trim()
    if (!rule) return
    const targetWorkspaceId = formScope === 'global' ? null : workspaceId ?? null
    try {
      // L2: ADD_LESSON returns the stored lesson plus a best-effort conflict
      // list ([] when the check was unavailable) — the write stands either way.
      const category = (customCategory.trim() || formCategory) as LessonCategory
      const result = await window.electronAPI.addMemoryLesson(targetWorkspaceId, {
        rule,
        category,
        scope: formScope,
        ...(formNegative ? { negative: true } : {}),
      })
      setCustomCategory('')
      setFormRule('')
      setFormNegative(false)
      toast.success(t('memory.lessonAdded'))
      if (result.conflicts.length > 0) {
        setAddConflicts({
          rule: result.lesson.rule,
          workspaceId: targetWorkspaceId,
          scope: result.lesson.scope,
          conflicts: result.conflicts,
        })
      } else {
        setAddConflicts(null)
        setFormOpen(false)
      }
    } catch (err) {
      toast.error(t('memory.lessonAddFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // L2 panel: [Удалить новое] removes the just-added rule by text,
  // [Оставить оба] just dismisses the panel.
  const handleResolveAddConflicts = (deleteNew: boolean) => {
    const pending = addConflicts
    setAddConflicts(null)
    setFormOpen(false)
    if (!deleteNew || !pending) return
    window.electronAPI
      .deleteMemoryLesson(pending.workspaceId, pending.scope, pending.rule)
      .then(() => loadLessons())
      .catch((err) => {
        toast.error(t('memory.lessonDeleteFailed'), {
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  // L3: copy a repeated workspace rule into the global memory.
  const handlePromote = async (candidate: PromotionCandidate) => {
    try {
      const result = await window.electronAPI.promoteLesson(null, candidate.rule)
      if (!result) return
      toast.success(t('memory.promoted'))
      // Hide the row immediately; the global-lessons filter keeps it hidden on refetch.
      setPromotionCandidates((cs) => cs.filter((c) => ruleKey(c.rule) !== ruleKey(candidate.rule)))
      loadLessons()
      loadPromotionCandidates()
    } catch (err) {
      toast.error(t('memory.lessonUpdateFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // L4: jump to the session that produced the lesson. A deleted session is a
  // no-op handled by the router — navigation is best-effort by design.
  const handleViewSource = (lesson: Lesson) => {
    const sessionId = lesson.source.sessionId
    if (!sessionId) return
    try {
      navigate(routes.view.allSessions(sessionId))
    } catch {
      // source session no longer exists
    }
  }

  const handleSaveEdit = async (lesson: Lesson) => {
    const rule = editDraft.trim()
    if (!rule) { setEditingRule(null); return }
    try {
      await window.electronAPI.updateMemoryLesson(
        lesson.scope === 'global' ? null : workspaceId ?? null,
        lesson.scope,
        lesson.rule,
        { rule },
      )
      setEditingRule(null)
    } catch (err) {
      toast.error(t('memory.lessonUpdateFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleDelete = async (lesson: Lesson) => {
    try {
      await window.electronAPI.deleteMemoryLesson(
        lesson.scope === 'global' ? null : workspaceId ?? null,
        lesson.scope,
        lesson.rule,
      )
      setConfirmDeleteRule(null)
    } catch (err) {
      toast.error(t('memory.lessonDeleteFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleSaveContext = async (scope: LessonScope) => {
    try {
      await window.electronAPI.updateMemoryContext(
        scope === 'global' ? null : workspaceId ?? null,
        scope,
        scope === 'global' ? preferences : context,
      )
      toast.success(t('memory.contextSaved'))
    } catch (err) {
      toast.error(t('memory.contextSaveFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // L1: quality-first ordering inside each scope group — lessons with recorded
  // violations surface first, then the most-used ones (stable: file order within ties).
  const sortedLessons = [...lessons].sort(
    (a, b) => (b.conflicts?.length ?? 0) - (a.conflicts?.length ?? 0) || (b.usageCount ?? 0) - (a.usageCount ?? 0),
  )
  const globalLessons = sortedLessons.filter((l) => l.scope === 'global')
  const workspaceLessons = sortedLessons.filter((l) => l.scope === 'workspace')
  // L3: promotion leaves the workspace copies in place — a candidate stops
  // being actionable once the rule already exists in the global store.
  const globalRuleKeys: Record<string, true> = {}
  for (const l of globalLessons) globalRuleKeys[ruleKey(l.rule)] = true
  const visibleCandidates = promotionCandidates.filter((c) => !globalRuleKeys[ruleKey(c.rule)])

  const renderLesson = (lesson: Lesson) => {
    const key = `${lesson.scope}:${lesson.rule}`
    const isEditing = editingRule === key
    const isConfirming = confirmDeleteRule === key
    const tokenEstimate = formatTokenEstimate(lesson.rule)
    return (
      <li key={key} className="rounded-[8px] px-2 py-1.5 hover:bg-foreground/[0.03]">
        {isEditing ? (
          <div className="space-y-1.5">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-[8px] bg-foreground/[0.03] p-2 text-sm outline-none focus:bg-foreground/[0.05]"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleSaveEdit(lesson)}
                className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-[6px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
              >
                <Check className="size-3" />
                {t('memory.save')}
              </button>
              <button
                type="button"
                onClick={() => setEditingRule(null)}
                className="inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors"
              >
                {t('memory.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <span className="block text-sm whitespace-pre-wrap">{lesson.rule}</span>
        )}
        {!isEditing && (
          <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span title={t('memory.tokenEstimateHint')}>{t('memory.tokenEstimate', { count: tokenEstimate })}</span>
            {(lesson.usageCount ?? 0) > 0 && (
              <span>{t('memory.usedCount', { count: lesson.usageCount })}</span>
            )}
            {(lesson.conflicts?.length ?? 0) > 0 && (
              <span
                className="text-destructive"
                title={(lesson.conflicts ?? [])
                  .slice(-3)
                  .map((c) => `${new Date(c.ts).toLocaleString()} — ${c.reason}`)
                  .join('\n')}
              >
                {t('memory.conflictCount', { count: lesson.conflicts?.length ?? 0 })}
              </span>
            )}
          </span>
        )}
        {!isEditing && (
          <span className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
              {BUILTIN_CATEGORIES.includes(lesson.category)
                ? t(`memory.category.${lesson.category}`)
                : lesson.category}
            </span>
            {lesson.negative && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive">
                {t('memory.negativeBadge')}
              </span>
            )}
            <span className="flex-1" />
            {isConfirming ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleDelete(lesson)}
                  className="inline-flex items-center h-5 px-1.5 text-[10px] font-medium rounded-[6px] bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                >
                  {t('memory.deleteConfirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteRule(null)}
                  className="inline-flex items-center h-5 px-1.5 text-[10px] font-medium rounded-[6px] bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors"
                >
                  {t('memory.cancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={t('memory.editLesson')}
                  onClick={() => { setEditingRule(key); setEditDraft(lesson.rule) }}
                  className="inline-flex items-center justify-center size-5 rounded-[6px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label={t('memory.deleteLesson')}
                  onClick={() => setConfirmDeleteRule(key)}
                  className="inline-flex items-center justify-center size-5 rounded-[6px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-3" />
                </button>
                {lesson.source.sessionId && (
                  <button
                    type="button"
                    aria-label={t('memory.viewSource')}
                    title={t('memory.viewSource')}
                    onClick={() => handleViewSource(lesson)}
                    className="inline-flex items-center justify-center size-5 rounded-[6px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
                  >
                    <Link2 className="size-3" />
                  </button>
                )}
              </>
            )}
          </span>
        )}
      </li>
    )
  }

  const renderScopeGroup = (title: string, items: Lesson[]) => (
    <div className="mb-1">
      <div className={`${sectionTitleClass()} flex items-center gap-1.5`}>
        {title}
        <span className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold normal-case ${scopeChipClass(items[0]?.scope ?? 'workspace')}`}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-2 pb-1 text-xs text-muted-foreground/70">{t('memory.noLessons')}</div>
      ) : (
        <ul>{items.map(renderLesson)}</ul>
      )}
    </div>
  )

  // Y1: hiding the card entirely when there is nothing to report keeps the
  // fresh-install panel calm (and matches the onboarding dialog's stage).
  const insightsQuiet = !insights || (
    insights.lessonsAdded7d === 0 &&
    insights.conflicts7d === 0 &&
    insights.pendingCount === 0 &&
    insights.approved7d === 0
  )
  const insightCategories = insights ? Object.entries(insights.categories).sort(([a], [b]) => a.localeCompare(b)) : []

  // Category tabs = builtins ∪ custom categories present on lessons
  const categoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of BUILTIN_CATEGORIES) counts[c] = 0
    for (const lesson of sortedLessons) {
      const key = lesson.category || 'workflow'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, [sortedLessons])

  const categoryTabs = React.useMemo(() => {
    const custom = Object.keys(categoryCounts)
      .filter((c) => !BUILTIN_CATEGORIES.includes(c as LessonCategory) && categoryCounts[c] > 0)
      .sort((a, b) => a.localeCompare(b))
    return [...BUILTIN_CATEGORIES, ...custom]
  }, [categoryCounts])

  const filterByTab = (items: Lesson[]) => {
    if (categoryTab === 'all') return items
    return items.filter((l) => l.category === categoryTab)
  }

  const filteredGlobal = filterByTab(globalLessons)
  const filteredWorkspace = filterByTab(workspaceLessons)

  const sectionHeader = (key: string, title: string, extra?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => toggleSection(key)}
      className={`${sectionTitleClass()} flex w-full items-center gap-1.5 text-left hover:text-foreground`}
    >
      {collapsedSections[key] ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
      <span className="flex-1">{title}</span>
      {extra}
    </button>
  )

  return (
    <div className={`flex flex-col gap-2 px-1 pb-4 overflow-y-auto ${className ?? ''}`} data-list-role="memory">
      {/* Title row: Global left, Remember right */}
      <div className="mx-1 flex items-center gap-2 pt-1">
        <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {t('memory.globalLessons')}
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium rounded-[8px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
          >
            <Plus className="size-3.5" />
            {t('memory.remember')}
          </button>
        )}
      </div>

      {/* Category tabs with counters */}
      <div className="mx-1 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setCategoryTab('all')}
          className={`h-6 rounded-full px-2 text-[11px] font-medium transition-colors ${
            categoryTab === 'all'
              ? 'bg-foreground/10 text-foreground'
              : 'text-muted-foreground hover:bg-foreground/5'
          }`}
        >
          {t('memory.tabAll', { count: sortedLessons.length })}
        </button>
        {categoryTabs.map((cat) => {
          const label = BUILTIN_CATEGORIES.includes(cat as LessonCategory)
            ? t(`memory.category.${cat}`)
            : cat
          const count = categoryCounts[cat] ?? 0
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryTab(cat)}
              className={`h-6 rounded-full px-2 text-[11px] font-medium transition-colors ${
                categoryTab === cat
                  ? 'bg-foreground/10 text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/5'
              }`}
            >
              {label} ({count})
            </button>
          )
        })}
      </div>

      {/* L3: rules repeated across workspaces → promote to global */}
      {visibleCandidates.length > 0 && (
        <div className="mx-1 rounded-[8px] border border-accent/20 bg-accent/[0.06] p-2">
          <div className="px-0.5 pb-1 text-[11px] font-medium text-foreground">
            {t('memory.promotionBanner', { count: visibleCandidates.length })}
          </div>
          <ul className="space-y-1">
            {visibleCandidates.map((candidate) => (
              <li key={candidate.rule} className="flex items-center gap-1.5 rounded-[6px] px-0.5 py-0.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{candidate.rule}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {t('memory.promotionWorkspaces', { count: candidate.workspaceIds.length })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void handlePromote(candidate)}
                  className="shrink-0 inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                >
                  {t('memory.promoteAction')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Remember form */}
      {formOpen && (
        <div className="mx-1 space-y-1.5 rounded-[8px] bg-foreground/[0.03] p-2">
          <textarea
            value={formRule}
            onChange={(e) => setFormRule(e.target.value)}
            rows={3}
            placeholder={t('memory.rulePlaceholder')}
            className="w-full resize-y rounded-[8px] bg-background/60 p-2 text-sm outline-none"
          />
          <div className="flex items-center justify-end text-[10px] text-muted-foreground">
            {t('memory.tokenEstimate', { count: formatTokenEstimate(formRule) })}
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as LessonCategory)}
              className="h-6 flex-1 rounded-[6px] bg-background/60 px-1.5 text-[11px] text-foreground outline-none"
            >
              {BUILTIN_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`memory.category.${c}`)}</option>
              ))}
            </select>
            <select
              value={formScope}
              onChange={(e) => setFormScope(e.target.value as LessonScope)}
              className="h-6 flex-1 rounded-[6px] bg-background/60 px-1.5 text-[11px] text-foreground outline-none"
            >
              <option value="workspace">{t('memory.scope.workspace')}</option>
              <option value="global">{t('memory.scope.global')}</option>
            </select>
          </div>
          <input
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder={t('memory.customCategoryPlaceholder')}
            className="h-6 w-full rounded-[6px] bg-background/60 px-1.5 text-[11px] text-foreground outline-none"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={formNegative}
              onChange={(e) => setFormNegative(e.target.checked)}
            />
            {t('memory.negativeLabel')}
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!formRule.trim()}
              onClick={() => void handleAdd()}
              className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-[6px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
            >
              <Check className="size-3" />
              {t('memory.addLessonSubmit')}
            </button>
            <button
              type="button"
              onClick={() => { setFormOpen(false); setAddConflicts(null); setCustomCategory('') }}
              className="inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors"
            >
              {t('memory.cancel')}
            </button>
          </div>
          {addConflicts && addConflicts.conflicts.length > 0 && (
            <div className="space-y-1.5 rounded-[8px] border border-destructive/25 bg-destructive/10 p-2">
              <ul className="space-y-0.5">
                {addConflicts.conflicts.map((c, i) => (
                  <li key={`${c.existingRule}:${i}`} className="text-[11px] leading-snug text-destructive">
                    {t('memory.conflictWarning', { newRule: addConflicts.rule, existingRule: c.existingRule })}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleResolveAddConflicts(true)}
                  className="inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
                >
                  {t('memory.replaceNew')}
                </button>
                <button
                  type="button"
                  onClick={() => handleResolveAddConflicts(false)}
                  className="inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-foreground/5 text-muted-foreground hover:bg-foreground/10 transition-colors"
                >
                  {t('memory.keepBoth')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lessons grouped by scope */}
      {renderScopeGroup(t('memory.globalLessons'), filteredGlobal)}
      {renderScopeGroup(t('memory.workspaceLessons'), filteredWorkspace)}

      {/* Context — collapsible */}
      <div className="border-t border-foreground/5 pt-1.5">
        {sectionHeader('context', t('memory.contextSection'))}
        {!collapsedSections.context && (
          <div className="mx-1 space-y-2">
            <div>
              <div className="mb-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{t('memory.preferencesGlobal')}</span>
                <span>{t('memory.tokenEstimate', { count: formatTokenEstimate(preferences) })}</span>
              </div>
              <textarea
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-[8px] bg-foreground/[0.03] p-2 text-xs outline-none focus:bg-foreground/[0.05]"
              />
              <button
                type="button"
                onClick={() => void handleSaveContext('global')}
                className="mt-0.5 inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
              >
                {t('memory.saveContext')}
              </button>
            </div>
            {workspaceId && (
              <div>
                <div className="mb-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t('memory.contextWorkspace')}</span>
                  <span>{t('memory.tokenEstimate', { count: formatTokenEstimate(context) })}</span>
                </div>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-[8px] bg-foreground/[0.03] p-2 text-xs outline-none focus:bg-foreground/[0.05]"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveContext('workspace')}
                  className="mt-0.5 inline-flex items-center h-6 px-2 text-[11px] font-medium rounded-[6px] bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
                >
                  {t('memory.saveContext')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Project */}
      {workspaceId && activeProjectId && projectMemory && (
        <div className="border-t border-foreground/5 pt-1.5">
          {sectionHeader('project', t('memory.projectSection'))}
          {!collapsedSections.project && (
            <>
              <div className="mx-1 mb-0.5 px-1">
                <button
                  type="button"
                  onClick={() => navigate(routes.view.projects(projectMemory.slug))}
                  title={t('memory.projectOpen')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                >
                  <Link2 className="size-3" />
                  {projectMemory.name}
                </button>
              </div>
              {projectMemory.memoryContent ? (
                <pre className="mx-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-[8px] bg-foreground/[0.03] p-2 text-[11px] leading-snug text-foreground/80">
                  {projectMemory.memoryContent}
                </pre>
              ) : (
                <div className="px-2 pb-1 text-xs text-muted-foreground/70">{t('memory.projectEmpty')}</div>
              )}
            </>
          )}
        </div>
      )}

      {/* History — collapsible */}
      {workspaceId && (
        <div className="border-t border-foreground/5 pt-1.5">
          {sectionHeader('history', t('memory.historySection'))}
          {!collapsedSections.history && (
            <>
              {historyDates.length === 0 ? (
                <div className="px-2 pb-1 text-xs text-muted-foreground/70">{t('memory.historyEmpty')}</div>
              ) : (
                <ul>
                  {historyDates.map((date) => (
                    <li key={date}>
                      <button
                        type="button"
                        onClick={() => openDate(date)}
                        className={`w-full rounded-[8px] px-2 py-1 text-left text-sm transition-colors ${
                          historyDate === date ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
                        }`}
                      >
                        {date}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {historyDate && (
                <pre className="mx-1 mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-[8px] bg-foreground/[0.03] p-2 text-[11px] leading-snug text-foreground/80">
                  {historyContent || t('memory.historyEmptyEntry')}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {lessons.length === 0 && !formOpen && !preferences && !context && (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <Brain className="size-6 opacity-40" />
          <span className="text-sm">{t('memory.emptyHint')}</span>
        </div>
      )}

      {/* Insights / stats at bottom */}
      {!insightsQuiet && insights && (
        <div className="mx-1 mt-2 space-y-1 rounded-[8px] border border-foreground/10 bg-foreground/[0.03] p-2" data-list-role="memory-insights">
          <div className="px-0.5 text-[11px] leading-snug text-muted-foreground">
            {t('memory.insightsLine', {
              lessonsAdded7d: insights.lessonsAdded7d,
              conflicts7d: insights.conflicts7d,
              pendingCount: insights.pendingCount,
              approved7d: insights.approved7d,
            })}
          </div>
          {insightCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {insightCategories.map(([category, count]) => (
                <span
                  key={category}
                  className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground"
                >
                  {t('memory.insightsChip', {
                    label: BUILTIN_CATEGORIES.includes(category as LessonCategory)
                      ? t(`memory.category.${category}`)
                      : category,
                    count,
                  })}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
