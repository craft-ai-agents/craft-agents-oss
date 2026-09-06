import * as React from 'react'
import { PanelsTopLeft, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { pagesAtom, pagesProjectFilterAtom, PAGES_UNASSIGNED_PROJECT } from '@/atoms/pages'
import { projectsAtom } from '@/atoms/projects'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import {
  ProjectMultiSelectFilter,
  type ProjectFilterOption,
} from '../app-shell/ProjectMultiSelectFilter'
import { PageTile, type PageTileProject } from './PageTile'
import { DeletePageDialog } from './DeletePageDialog'
import type { LoadedPage } from '@craft-agent/shared/pages/types'

/**
 * Pages library — the full-width home grid (mirrors the Kanban board pane).
 * Header carries the controlled Project filter (with an Unassigned sentinel)
 * and the New Page action; tiles open the embedded page render.
 */
export function PagesHome() {
  const { activeWorkspaceId } = useAppShellContext()
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const pages = useAtomValue(pagesAtom)
  const projects = useAtomValue(projectsAtom)
  const [projectFilter, setProjectFilter] = useAtom(pagesProjectFilterAtom)
  const [pendingDelete, setPendingDelete] = React.useState<LoadedPage | null>(null)

  // Keep the (module-global) filter scoped to the current workspace + live
  // projects: clear on workspace switch, prune ids whose project no longer
  // exists. The Unassigned sentinel always survives pruning.
  const prevWorkspaceRef = React.useRef(activeWorkspaceId)
  React.useEffect(() => {
    if (prevWorkspaceRef.current !== activeWorkspaceId) {
      prevWorkspaceRef.current = activeWorkspaceId
      setProjectFilter(prev => (prev.length ? [] : prev))
      return
    }
    setProjectFilter(prev => {
      if (prev.length === 0) return prev
      const live = prev.filter(
        id => id === PAGES_UNASSIGNED_PROJECT || projects.some(p => p.config.id === id),
      )
      return live.length === prev.length ? prev : live
    })
  }, [activeWorkspaceId, projects, setProjectFilter])

  const projectOptions = React.useMemo<ProjectFilterOption[]>(
    () => projects.map(p => ({ id: p.config.id, name: p.config.name, color: p.config.color })),
    [projects],
  )

  const projectsById = React.useMemo(() => {
    const map = new Map<string, PageTileProject>()
    for (const project of projects) {
      map.set(project.config.id, { name: project.config.name, color: project.config.color })
    }
    return map
  }, [projects])

  const visiblePages = React.useMemo(() => {
    let list = pages
    if (projectFilter.length > 0) {
      const allow = new Set(projectFilter)
      list = pages.filter(page => {
        const projectId = page.config.projectId
        if (projectId === undefined) return allow.has(PAGES_UNASSIGNED_PROJECT)
        return allow.has(projectId)
      })
    }
    return [...list].sort((a, b) => b.config.updatedAt - a.config.updatedAt)
  }, [pages, projectFilter])

  const openPage = React.useCallback(
    (slug: string) => navigate(routes.view.pages(slug)),
    [navigate],
  )

  // Blank page, bound to the first selected (real) project so it stays
  // visible under an active filter — mirrors the board's create behavior.
  const handleCreatePage = React.useCallback(async () => {
    if (!activeWorkspaceId) return
    const boundProjectId = projectFilter.find(id => id !== PAGES_UNASSIGNED_PROJECT)
    try {
      const created = await window.electronAPI.createPage(activeWorkspaceId, {
        name: t('pages.newPage'),
        kind: 'interactive',
        ...(boundProjectId ? { projectId: boundProjectId } : {}),
      })
      navigate(routes.view.pages(created.slug))
    } catch (err) {
      toast.error(t('toast.pageCreateFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [activeWorkspaceId, projectFilter, t, navigate])

  const handleAskAgent = React.useCallback(() => {
    navigate(routes.action.newSession({ input: t('pages.askAgentPrompt') }))
  }, [navigate, t])

  const handleConfirmDelete = React.useCallback(async () => {
    if (!activeWorkspaceId || !pendingDelete) return
    const { slug, name } = pendingDelete.config
    setPendingDelete(null)
    try {
      const result = await window.electronAPI.deletePage(activeWorkspaceId, slug)
      if (result?.publicCopyMayRemain) {
        toast.warning(t('toast.pageDeleted', { name }), {
          description: t('toast.pagePublicCopyMayRemain'),
        })
      } else {
        toast.success(t('toast.pageDeleted', { name }))
      }
    } catch (err) {
      toast.error(t('toast.pageDeleteFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [activeWorkspaceId, pendingDelete, t])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Sticky header: title + count, project filter, primary action */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-sm font-medium">{t('sidebar.pages')}</span>
          <span className="text-xs text-foreground/40">{pages.length}</span>
          {(projectOptions.length > 0 || projectFilter.length > 0) && (
            <ProjectMultiSelectFilter
              projects={projectOptions}
              value={projectFilter}
              onChange={setProjectFilter}
              unassignedId={PAGES_UNASSIGNED_PROJECT}
            />
          )}
        </div>
        <button
          type="button"
          onClick={handleCreatePage}
          disabled={!activeWorkspaceId}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('pages.newPage')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <EntityListEmptyScreen
            icon={<PanelsTopLeft />}
            title={t('pages.emptyTitle')}
            description={t('pages.emptyDescription')}
          >
            <button
              onClick={handleAskAgent}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-foreground/[0.02] px-3 text-xs font-medium shadow-minimal transition-colors hover:bg-foreground/[0.05]"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t('pages.askAgent')}
            </button>
            <button
              onClick={handleCreatePage}
              className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-foreground/[0.02] px-3 text-xs font-medium shadow-minimal transition-colors hover:bg-foreground/[0.05]"
            >
              <Plus className="h-3.5 w-3.5" /> {t('pages.createBlank')}
            </button>
          </EntityListEmptyScreen>
        ) : visiblePages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground/50">
            {t('pages.noMatches')}
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-5">
            {visiblePages.map(page => (
              <PageTile
                key={page.config.id}
                page={page}
                project={page.config.projectId ? projectsById.get(page.config.projectId) : undefined}
                onOpen={() => openPage(page.config.slug)}
                onDelete={() => setPendingDelete(page)}
              />
            ))}
          </div>
        )}
      </div>

      <DeletePageDialog
        pageName={pendingDelete?.config.name ?? null}
        shared={Boolean(pendingDelete?.config.share)}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
