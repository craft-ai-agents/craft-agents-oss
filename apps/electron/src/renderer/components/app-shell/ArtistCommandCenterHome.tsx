import * as React from 'react'
import {
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Disc3,
  Eye,
  Megaphone,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import type { MissionAssetKindHint, MissionAssetManifest } from '../../../shared/types'
import {
  MISSION_ASSET_CONTEXT_SLUG,
  missionAssetContextMetadata,
  serializeMissionAssetContext,
} from '@/lib/mission-asset-context'
import {
  MISSION_BRIEF_CONTEXT_SLUG,
  emptyMissionBrief,
  parseMissionBriefDoc,
  type MissionBrief,
} from '@/lib/mission-brief'
import {
  RELEASE_BOARD_CONTEXT_SLUG,
  buildDefaultReleaseBoard,
  getBoardTotals,
  getCategoryProgress,
  mergeReleaseBoardWithAssets,
  parseReleaseBoardDoc,
  releaseBoardMetadata,
  serializeReleaseBoardBody,
  toggleReleaseBoardItem,
  type ReleaseBoard,
  type ReleaseBoardCategory,
} from '@/lib/release-board'
import { MissionBriefDrawer } from './MissionBriefDrawer'

interface ArtistCommandCenterHomeProps {
  workspaceId: string
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  meta?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-white/[0.04] pb-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3 w-3 text-white/40" />
        <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">{title}</h3>
      </div>
      {meta ? (
        <span className="text-[8px] font-medium uppercase tracking-widest text-white/30">
          {meta}
        </span>
      ) : null}
    </div>
  )
}

function CommandCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-white/[0.04] bg-[#0A0A0A] p-4 shadow-minimal transition-colors hover:bg-white/[0.02]',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function ArtistCommandCenterHome({ workspaceId }: ArtistCommandCenterHomeProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [showAgents, setShowAgents] = React.useState(false)
  const [assetManifest, setAssetManifest] = React.useState<MissionAssetManifest | null>(null)
  const [assetBusy, setAssetBusy] = React.useState(false)
  const [selectedReleaseCategoryId, setSelectedReleaseCategoryId] = React.useState<ReleaseBoardCategory['id'] | null>(null)
  const lastAutoSavedReleaseBoardBody = React.useRef<string | null>(null)
  const { docs, loading, upsert } = useWorkspaceContext(workspaceId)

  const savedMission = React.useMemo(() => {
    const doc = docs.find((item) => item.slug === MISSION_BRIEF_CONTEXT_SLUG)
    return parseMissionBriefDoc(doc)
  }, [docs])

  const [optimisticMission, setOptimisticMission] = React.useState<MissionBrief | null>(null)
  const savedReleaseBoard = React.useMemo(() => {
    const doc = docs.find((item) => item.slug === RELEASE_BOARD_CONTEXT_SLUG)
    return parseReleaseBoardDoc(doc)
  }, [docs])
  const [optimisticReleaseBoard, setOptimisticReleaseBoard] = React.useState<ReleaseBoard | null>(null)

  React.useEffect(() => {
    if (savedMission) setOptimisticMission(null)
  }, [savedMission])

  React.useEffect(() => {
    if (savedReleaseBoard) setOptimisticReleaseBoard(null)
  }, [savedReleaseBoard])

  const emptyMission = React.useMemo(
    () => emptyMissionBrief(workspaceId || 'workspace'),
    [workspaceId],
  )
  const mission = optimisticMission ?? savedMission ?? emptyMission
  const releaseBoardBase = React.useMemo(
    () => optimisticReleaseBoard ?? savedReleaseBoard ?? buildDefaultReleaseBoard(workspaceId || 'workspace'),
    [optimisticReleaseBoard, savedReleaseBoard, workspaceId],
  )
  const releaseBoard = React.useMemo(
    () => mergeReleaseBoardWithAssets(releaseBoardBase, assetManifest),
    [assetManifest, releaseBoardBase],
  )
  const releaseBoardBody = React.useMemo(
    () => serializeReleaseBoardBody(releaseBoard),
    [releaseBoard],
  )
  const selectedReleaseCategory = React.useMemo(
    () => releaseBoard.categories.find((category) => category.id === selectedReleaseCategoryId) ?? null,
    [releaseBoard.categories, selectedReleaseCategoryId],
  )
  const hasMission = mission.status !== 'empty'
  const title = mission.title || 'Untitled Mission'
  const subtitle = hasMission
    ? mission.goal || mission.mood || 'Mission brief started. Add more context when ready.'
    : 'Start with a goal, files, or an agent.'
  const focus = mission.timeline || mission.releaseDate || (hasMission ? mission.missionType || 'Mission active' : 'No brief yet')
  const readinessLabel = hasMission ? `${mission.completeness}% ready` : 'Not started'
  const nextMove = React.useMemo(
    () => hasMission ? missionNextMove(assetManifest) : 'Create the mission brief.',
    [assetManifest, hasMission],
  )

  React.useEffect(() => {
    let cancelled = false
    if (!workspaceId) return
    window.electronAPI.getMissionAssetManifest(workspaceId)
      .then((manifest) => {
        if (!cancelled) setAssetManifest(manifest)
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const importAssetPaths = React.useCallback(
    async (filePaths: string[], kindHint: MissionAssetKindHint = 'any') => {
      if (!hasMission) {
        setDrawerOpen(true)
        toast.info('Create the mission first, then add files.')
        return
      }
      if (filePaths.length === 0) return
      setAssetBusy(true)
      try {
        const result = await window.electronAPI.importMissionAssets(workspaceId, filePaths, { kindHint })
        setAssetManifest(result.manifest)
        await upsert({
          slug: MISSION_ASSET_CONTEXT_SLUG,
          metadata: missionAssetContextMetadata(),
          body: serializeMissionAssetContext(result.manifest),
        })
        const skipped = result.skipped.length ? ` ${result.skipped.length} skipped.` : ''
        if (result.imported.length === 0) {
          toast.warning(`No mission assets added.${skipped}`)
          return
        }
        toast.success(`Added ${result.imported.length} mission asset${result.imported.length === 1 ? '' : 's'}.${skipped}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setAssetBusy(false)
      }
    },
    [hasMission, upsert, workspaceId],
  )

  const saveReleaseBoard = React.useCallback(
    async (nextBoard: ReleaseBoard) => {
      setOptimisticReleaseBoard(nextBoard)
      try {
        await upsert({
          slug: RELEASE_BOARD_CONTEXT_SLUG,
          metadata: releaseBoardMetadata(nextBoard),
          body: serializeReleaseBoardBody(nextBoard),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [upsert],
  )

  React.useEffect(() => {
    if (!workspaceId || loading) return
    const shouldSeedBoard = !savedReleaseBoard
    const shouldSyncAssetMatches = savedReleaseBoard && releaseBoardBody !== serializeReleaseBoardBody(savedReleaseBoard)
    if (!shouldSeedBoard && !shouldSyncAssetMatches) return
    if (lastAutoSavedReleaseBoardBody.current === releaseBoardBody) return

    lastAutoSavedReleaseBoardBody.current = releaseBoardBody
    void upsert({
      slug: RELEASE_BOARD_CONTEXT_SLUG,
      metadata: releaseBoardMetadata(releaseBoard),
      body: releaseBoardBody,
    }).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }, [loading, releaseBoard, releaseBoardBody, savedReleaseBoard, upsert, workspaceId])

  const toggleReleaseItem = React.useCallback(
    (categoryId: ReleaseBoardCategory['id'], itemId: string) => {
      void saveReleaseBoard(toggleReleaseBoardItem(releaseBoard, categoryId, itemId))
    },
    [releaseBoard, saveReleaseBoard],
  )

  const chooseAndImport = React.useCallback(
    async (kindHint: MissionAssetKindHint = 'any') => {
      if (!hasMission) {
        setDrawerOpen(true)
        toast.info('Create the mission first, then add files.')
        return
      }
      setAssetBusy(true)
      try {
        const filePaths = await window.electronAPI.chooseMissionAssetFiles(workspaceId, kindHint)
        await importAssetPaths(filePaths, kindHint)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setAssetBusy(false)
      }
    },
    [hasMission, importAssetPaths, workspaceId],
  )

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-5 py-4 xl:px-8 xl:py-5">
        <section className="relative min-h-[230px] overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A]">
          <div className="absolute -left-[20%] -top-[40%] h-[600px] w-[600px] rounded-full bg-orange-600/10 blur-[120px]" />
          <div className="absolute -bottom-[40%] -right-[10%] h-[600px] w-[600px] rounded-full bg-indigo-600/5 blur-[120px]" />

          <div className="absolute bottom-7 right-8 hidden w-[28%] rounded-[24px] border border-white/[0.04] bg-white/[0.015] p-4 2xl:block">
            <p className="mb-2 text-[9px] font-medium uppercase tracking-[0.18em] text-white/35">Mission Context</p>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full rounded-full bg-orange-400" style={{ width: `${mission.completeness}%` }} />
            </div>
            <p className="mt-3 text-xs leading-5 text-white/42">
              {hasMission
                ? 'The command center is now using this mission brief as workspace context.'
                : 'Nothing is required before agents can work. The brief just makes them sharper.'}
            </p>
          </div>

          <div className="relative z-10 flex min-h-[230px] flex-col justify-between p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5 pr-4 backdrop-blur-md">
                <span className={cn('flex h-2 w-2 items-center justify-center rounded-full', hasMission ? 'bg-emerald-500/20' : 'bg-white/10')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', hasMission ? 'bg-emerald-500' : 'bg-white/35')} />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/70">
                  {hasMission ? 'Mission Active' : 'Mission Empty'}
                </span>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">Focus</p>
                <p className="mt-1.5 text-xs font-medium capitalize text-white/70">{focus}</p>
              </div>
            </div>

            <div className="my-5 max-w-[760px]">
              <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl md:text-6xl lg:text-[56px] lg:leading-[0.94]">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                {subtitle}
              </p>
            </div>

            <div className="flex flex-col gap-4 border-t border-white/[0.05] pt-4 md:flex-row md:items-end md:justify-between">
              <div className="flex w-full max-w-2xl flex-col gap-4 md:flex-row md:items-end md:gap-8">
                <div className="w-full max-w-[250px]">
                  <div className="mb-2 flex justify-between text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">
                    <span>Brief</span>
                    <span className="text-white/60">{readinessLabel}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.04]">
                    <div className="h-full rounded-full bg-orange-500/80" style={{ width: `${mission.completeness}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-medium text-white/72">
                    {hasMission ? 'Mission context saved' : 'No mission brief yet'}
                  </p>
                </div>
                <div className="hidden md:block">
                  <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">Next Move</p>
                  <p className="text-xs font-medium text-white/80">
                    {nextMove}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-5 text-xs font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
                >
                  {hasMission ? 'Edit Mission' : 'Create Mission'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <ReleaseBoardRow
          board={releaseBoard}
          onSelectCategory={setSelectedReleaseCategoryId}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <CommandCard>
            <SectionTitle icon={ShieldCheck} title="Approvals" meta="None" />
            <EmptyCardLine
              title="No pending approvals"
              detail={hasMission ? 'Approvals will appear when workflows create review points.' : 'Create a mission before approval workflows matter.'}
            />
          </CommandCard>

          <CommandCard>
            <SectionTitle icon={CalendarClock} title="Today" meta="Local" />
            {mission.timeline || mission.releaseDate ? (
              <div className="relative mt-2.5 space-y-3.5 pl-3.5 before:absolute before:bottom-1 before:left-[5.5px] before:top-1 before:w-px before:bg-white/[0.04]">
                <TimelineLine time="Now" title={mission.timeline || mission.releaseDate || 'Mission timeline'} area="Mission" />
                <TimelineLine time="Next" title="Ask an agent to turn this into a plan" area="Delegation" />
              </div>
            ) : (
              <EmptyCardLine title="No timeline yet" detail="Add a release date or rough window in the mission brief." />
            )}
          </CommandCard>

          <CommandCard>
            <button
              type="button"
              onClick={() => setShowAgents((value) => !value)}
              className="group flex w-full items-center justify-between text-left"
              aria-expanded={showAgents}
            >
              <div className="flex items-center gap-2">
                <Bot className="h-3 w-3 text-white/40 group-hover:text-white/60" />
                <h3 className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/60">Active Agents</h3>
                <span className="ml-2 rounded bg-white/[0.03] px-2 py-0.5 text-[8px] font-medium tracking-widest text-white/40">
                  Quiet
                </span>
              </div>
              <ChevronDown className={cn('h-4 w-4 text-white/20 transition-transform duration-300 group-hover:text-white/50', showAgents && 'rotate-180')} />
            </button>

            <div className={cn('grid transition-all duration-300 ease-in-out', showAgents ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-2 grid-rows-[0fr] opacity-0')}>
              <div className="overflow-hidden">
                <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-white/32" />
                    <div>
                      <p className="text-sm font-medium text-white/75">No background agents running</p>
                      <p className="mt-1 text-xs leading-5 text-white/38">
                        Once a mission workflow starts, agent runs and handoffs can appear here.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CommandCard>
        </div>
      </div>

      <MissionBriefDrawer
        open={drawerOpen}
        workspaceId={workspaceId}
        mission={mission}
        onOpenChange={setDrawerOpen}
        onSaved={setOptimisticMission}
        saveMissionBrief={upsert}
        assetManifest={assetManifest}
        assetBusy={assetBusy}
        releaseBoard={releaseBoard}
        onAddAsset={chooseAndImport}
        onImportAssetPaths={importAssetPaths}
        onOpenAssetsFolder={async () => {
          if (!hasMission) {
            setDrawerOpen(true)
            toast.info('Create the mission first, then open the assets folder.')
            return
          }
          try {
            const opened = await window.electronAPI.openMissionAssetsFolder(workspaceId)
            if (!opened) toast.error('Could not open mission assets folder.')
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
          }
        }}
      />

      <ReleaseBoardDialog
        category={selectedReleaseCategory}
        onOpenChange={(open) => {
          if (!open) setSelectedReleaseCategoryId(null)
        }}
        onToggleItem={toggleReleaseItem}
      />
    </div>
  )
}

const releaseCategoryIcons: Record<ReleaseBoardCategory['id'], React.ComponentType<{ className?: string }>> = {
  music: Disc3,
  visuals: Eye,
  setup: Settings2,
  content: ClipboardCheck,
  promotion: Megaphone,
  team: Users,
}

function missionNextMove(manifest: MissionAssetManifest | null): string {
  const files = manifest?.files.filter((file) => file.status === 'available') ?? []
  if (!files.some((file) => file.kind === 'master' || file.kind === 'demo')) return 'Add the master in Mission Assets.'
  if (!files.some((file) => file.kind === 'lyrics')) return 'Add lyrics in Mission Assets.'
  if (!files.some((file) => file.kind === 'cover-art')) return 'Add cover art in Mission Assets.'
  return 'Use the release board or launch an agent.'
}

function ReleaseBoardRow({
  board,
  onSelectCategory,
}: {
  board: ReleaseBoard
  onSelectCategory: (categoryId: ReleaseBoardCategory['id']) => void
}) {
  const totals = getBoardTotals(board)

  return (
    <CommandCard className="p-3">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-white/45" />
          <p className="min-w-0 truncate text-sm font-medium text-white/82">
            Release Board <span className="text-xs font-normal text-white/32">({totals.done}/{totals.total})</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {board.categories.map((category) => (
          <ReleaseBoardTile
            key={category.id}
            category={category}
            onClick={() => onSelectCategory(category.id)}
          />
        ))}
      </div>
    </CommandCard>
  )
}

function ReleaseBoardTile({
  category,
  onClick,
}: {
  category: ReleaseBoardCategory
  onClick: () => void
}) {
  const Icon = releaseCategoryIcons[category.id]
  const progress = getCategoryProgress(category)
  const allDone = progress.total > 0 && progress.done === progress.total

  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-w-0 rounded-xl border border-white/[0.045] bg-white/[0.012] p-2.5 text-left transition-colors hover:border-white/[0.09] hover:bg-white/[0.035]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
            allDone ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-white/[0.05] bg-white/[0.02]',
          )}>
            <Icon className={cn('h-3.5 w-3.5', allDone ? 'text-emerald-300/80' : 'text-white/45')} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white/78">{category.label}</p>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex gap-1">
        {category.items.map((item) => (
          <span
            key={item.id}
            className={cn(
              'h-1 flex-1 rounded-full',
              item.status === 'done' ? 'bg-emerald-400/70' : 'bg-white/[0.07]',
            )}
          />
        ))}
      </div>
    </button>
  )
}

function ReleaseBoardDialog({
  category,
  onOpenChange,
  onToggleItem,
}: {
  category: ReleaseBoardCategory | null
  onOpenChange: (open: boolean) => void
  onToggleItem: (categoryId: ReleaseBoardCategory['id'], itemId: string) => void
}) {
  const Icon = category ? releaseCategoryIcons[category.id] : CheckCircle2
  const progress = category ? getCategoryProgress(category) : { done: 0, total: 0 }

  return (
    <Dialog open={Boolean(category)} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/[0.08] bg-[#070707] text-white shadow-modal-small sm:max-w-[560px]">
        {category ? (
          <>
            <DialogHeader className="pr-8">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025]">
                  <Icon className="h-4 w-4 text-white/58" />
                </span>
                <div>
                  <DialogTitle className="text-base font-medium text-white/88">{category.label}</DialogTitle>
                  <DialogDescription className="mt-1 text-xs text-white/38">
                    {progress.done}/{progress.total} handled
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-2">
              {category.items.map((item) => {
                const done = item.status === 'done'
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.045] bg-white/[0.012] px-3 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleItem(category.id, item.id)}
                      aria-label={done ? `Mark ${item.label} as needed` : `Mark ${item.label} as done`}
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                        done
                          ? 'border-emerald-400/30 bg-emerald-400/14 text-emerald-300'
                          : 'border-white/[0.10] bg-white/[0.018] text-white/28 hover:border-white/20 hover:text-white/60',
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm font-medium', done ? 'text-white/78' : 'text-white/84')}>
                        {item.label}
                      </p>
                      {item.linkedAssetId ? (
                        <p className="mt-0.5 truncate text-[10px] text-emerald-300/48">Matched from mission assets</p>
                      ) : null}
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-1 text-[9px] font-medium uppercase tracking-[0.14em]',
                      done ? 'bg-emerald-400/10 text-emerald-300/75' : 'bg-white/[0.035] text-white/32',
                    )}>
                      {done ? 'Done' : 'Needed'}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EmptyCardLine({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/[0.03] bg-white/[0.012] p-4">
      <p className="text-sm font-medium text-white/76">{title}</p>
      <p className="mt-1 text-xs leading-5 text-white/36">{detail}</p>
    </div>
  )
}

function TimelineLine({ time, title, area }: { time: string; title: string; area: string }) {
  return (
    <div className="relative flex gap-3">
      <span className="absolute -left-[16px] top-1.5 h-1.5 w-1.5 rounded-full bg-white/20 ring-[3px] ring-[#0A0A0A]" />
      <span className="w-9 shrink-0 pt-0.5 text-[9px] font-medium tracking-widest text-white/30">{time}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-white/80">{title}</span>
        <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-white/30">{area}</span>
      </div>
    </div>
  )
}
