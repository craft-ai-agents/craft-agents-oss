import * as React from 'react'
import {
  Check,
  CheckCircle2,
  ClipboardList,
  FileArchive,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Music2,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  buildMissionBrief,
  hasSaveableMissionBrief,
  missionBriefContentKey,
  missionBriefMetadata,
  serializeMissionBriefBody,
  type MissionBrief,
  type MissionReference,
  type MissionType,
} from '@/lib/mission-brief'
import type {
  ContextDocDTO,
  ContextDocMetadata,
  MissionAssetKindHint,
  MissionAssetManifest,
  MissionAssetRecord,
} from '../../../shared/types'
import type { ReleaseBoard } from '@/lib/release-board'

const missionTypes: MissionType[] = ['single', 'ep', 'album', 'other']
const missionFieldClass = 'w-full rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2 text-sm text-white/78 outline-none placeholder:text-white/22 focus:border-orange-300/45'
type DrawerTab = 'brief' | 'assets'

type SaveMissionBrief = (input: {
  slug: string
  metadata: ContextDocMetadata
  body: string
}) => Promise<ContextDocDTO>

interface MissionBriefDrawerProps {
  open: boolean
  workspaceId: string
  mission: MissionBrief
  onOpenChange: (open: boolean) => void
  onSaved: (brief: MissionBrief) => void
  saveMissionBrief: SaveMissionBrief
  assetManifest: MissionAssetManifest | null
  assetBusy: boolean
  releaseBoard: ReleaseBoard
  onAddAsset: (kindHint: MissionAssetKindHint) => Promise<void>
  onImportAssetPaths: (filePaths: string[], kindHint?: MissionAssetKindHint) => Promise<void>
  onOpenAssetsFolder: () => Promise<void>
}

export function MissionBriefDrawer({
  open,
  workspaceId,
  mission,
  onOpenChange,
  onSaved,
  saveMissionBrief,
  assetManifest,
  assetBusy,
  releaseBoard,
  onAddAsset,
  onImportAssetPaths,
  onOpenAssetsFolder,
}: MissionBriefDrawerProps) {
  const [activeTab, setActiveTab] = React.useState<DrawerTab>('brief')
  const [draft, setDraft] = React.useState<Partial<MissionBrief>>(mission)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setDraft(mission)
  }, [mission])

  const editableBrief = React.useMemo(() => buildMissionBrief(workspaceId, draft), [draft, workspaceId])
  const savedBrief = React.useMemo(() => buildMissionBrief(workspaceId, mission), [mission, workspaceId])
  const canSave = hasSaveableMissionBrief(editableBrief)
  const briefDirty = React.useMemo(
    () => missionBriefContentKey(editableBrief) !== missionBriefContentKey(savedBrief),
    [editableBrief, savedBrief],
  )

  const save = React.useCallback(async () => {
    const brief = buildMissionBrief(workspaceId, {
      ...draft,
    })
    if (brief.status === 'empty') {
      toast.message('Nothing to save yet')
      return
    }
    if (!hasSaveableMissionBrief(brief)) {
      toast.message('Add a title or goal before saving')
      return
    }
    setSaving(true)
    try {
      await saveMissionBrief({
        slug: 'mission-brief',
        metadata: missionBriefMetadata(brief),
        body: serializeMissionBriefBody(brief),
      })
      onSaved(brief)
      toast.success('Campaign brief saved')
      if (mission.status === 'empty') {
        setActiveTab('assets')
      } else {
        onOpenChange(false)
      }
    } catch (err) {
      toast.error('Failed to save campaign brief', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }, [draft, mission.status, onOpenChange, onSaved, saveMissionBrief, workspaceId])

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.files.length) return
      event.preventDefault()
      const filePaths = Array.from(event.dataTransfer.files)
        .map((file) => window.electronAPI.getFilePath(file))
        .filter((path): path is string => Boolean(path))
      if (filePaths.length === 0) {
        toast.error('Could not read dropped files.')
        return
      }
      void onImportAssetPaths(filePaths, 'any')
    },
    [onImportAssetPaths],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent
        overlay={<div className="fixed inset-0 z-modal bg-black/20 backdrop-blur-[1px]" />}
        className="w-[min(560px,100vw)] !max-w-[min(560px,100vw)] border-l border-white/[0.08] bg-[#070707] text-white shadow-strong sm:!max-w-[560px]"
      >
        <DrawerHeader className="border-b border-white/[0.06] px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-orange-300/70">
                <ClipboardList className="h-3.5 w-3.5" />
                Campaign Brief
              </div>
              <DrawerTitle className="text-xl font-medium tracking-tight text-white">
                {mission.title || 'Create Campaign'}
              </DrawerTitle>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-white/50 hover:bg-white/[0.08] hover:text-white"
              aria-label="Close campaign brief"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DrawerHeader>

        <div className="flex gap-1 border-b border-white/[0.06] px-5 py-3">
          <TabButton active={activeTab === 'brief'} onClick={() => setActiveTab('brief')}>Brief</TabButton>
          <TabButton active={activeTab === 'assets'} onClick={() => setActiveTab('assets')}>Assets</TabButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {activeTab === 'brief' ? (
          <section className="rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
                  Campaign Brief
                </h3>
              </div>
              <span className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[10px] text-white/42">
                {editableBrief.completeness}% complete
              </span>
            </div>

            <div className="grid gap-3">
              <Field label="Title">
                <input
                  value={draft.title ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
                  className={missionFieldClass}
                  placeholder="Song, EP, or album name"
                />
              </Field>
              <Field label="Type">
                <select
                  value={draft.missionType ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, missionType: event.target.value as MissionType || undefined }))}
                  className={missionFieldClass}
                >
                  <option value="">Unknown</option>
                  {missionTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Goal">
                <textarea
                  value={draft.goal ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, goal: event.target.value }))}
                  className={cn(missionFieldClass, 'min-h-[84px] resize-none')}
                  placeholder="What are we trying to make happen?"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Release Target">
                  <input
                    value={draft.timeline ?? ''}
                    onChange={(event) => setDraft((value) => ({ ...value, timeline: event.target.value }))}
                    className={missionFieldClass}
                    placeholder="June 30, next month, this summer..."
                  />
                </Field>
                <Field label="Promo Budget">
                  <input
                    value={draft.promoBudget ?? ''}
                    onChange={(event) => setDraft((value) => ({ ...value, promoBudget: event.target.value }))}
                    className={missionFieldClass}
                    placeholder="$0, $500, $2k, not sure yet"
                  />
                </Field>
              </div>
              <Field label="Mood">
                <textarea
                  value={draft.mood ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, mood: event.target.value }))}
                  className={cn(missionFieldClass, 'min-h-[72px] resize-none')}
                  placeholder="What should it feel like?"
                />
              </Field>
              <Field label="Visual World">
                <textarea
                  value={draft.visualWorld ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, visualWorld: event.target.value }))}
                  className={cn(missionFieldClass, 'min-h-[72px] resize-none')}
                  placeholder="Colors, imagery, world, references"
                />
              </Field>
              <Field label="Target Listener">
                <input
                  value={draft.targetListener ?? ''}
                  onChange={(event) => setDraft((value) => ({ ...value, targetListener: event.target.value }))}
                  className={missionFieldClass}
                  placeholder="Who is this for?"
                />
              </Field>
              <Field label="References">
                <input
                  value={(draft.references ?? []).map((ref) => ref.value).join(', ')}
                  onChange={(event) => setDraft((value) => ({ ...value, references: parseReferences(event.target.value) }))}
                  className={missionFieldClass}
                  placeholder="artists, songs, visuals"
                />
              </Field>
              <Field label="Channels">
                <input
                  value={(draft.channels ?? []).join(', ')}
                  onChange={(event) => setDraft((value) => ({ ...value, channels: parseList(event.target.value) }))}
                  className={missionFieldClass}
                  placeholder="TikTok, Instagram, Spotify"
                />
              </Field>
            </div>
          </section>
          ) : (
            <AssetsSetup
              manifest={assetManifest}
              busy={assetBusy}
              releaseBoard={releaseBoard}
              onAdd={onAddAsset}
              onDrop={handleDrop}
              onOpenFolder={onOpenAssetsFolder}
            />
          )}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          {activeTab === 'brief' ? (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !canSave}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-orange-500 px-4 text-sm font-medium text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
                  title={!canSave ? 'Add a title or goal before saving' : undefined}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Accept Brief
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-medium text-white/62 hover:bg-white/[0.07] hover:text-white"
                >
                  Skip
                </button>
              </div>
              {!canSave ? (
                <p className="mt-2 text-center text-[11px] text-white/32">Needs a title or goal before saving.</p>
              ) : null}
            </>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={briefDirty ? save : () => onOpenChange(false)}
                disabled={briefDirty && (saving || !canSave)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-white/90 px-4 text-sm font-medium text-black hover:bg-white"
              >
                {briefDirty ? 'Save Brief' : 'Done'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('brief')}
                className="inline-flex h-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-sm font-medium text-white/62 hover:bg-white/[0.07] hover:text-white"
              >
                Brief
              </button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/32">{label}</span>
      {children}
    </label>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-full px-3 text-xs font-medium transition-colors',
        active
          ? 'bg-white/90 text-black'
          : 'bg-white/[0.025] text-white/50 hover:bg-white/[0.06] hover:text-white/80',
      )}
    >
      {children}
    </button>
  )
}

function AssetsSetup({
  manifest,
  busy,
  releaseBoard,
  onAdd,
  onDrop,
  onOpenFolder,
}: {
  manifest: MissionAssetManifest | null
  busy: boolean
  releaseBoard: ReleaseBoard
  onAdd: (kindHint: MissionAssetKindHint) => Promise<void>
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onOpenFolder: () => Promise<void>
}) {
  const files = manifest?.files ?? []
  const master = firstAsset(files, ['master', 'demo'])
  const lyrics = firstAsset(files, ['lyrics'])
  const cover = firstAsset(files, ['cover-art'])
  const photos = files.filter((file) => file.status === 'available' && file.kind === 'press-photo').length
  const rawVideo = files.filter((file) => file.status === 'available' && file.kind === 'raw-video').length
  const refs = files.filter((file) => file.status === 'available' && ['moodboard-image', 'audio-reference'].includes(file.kind)).length
  const toCreate = releaseBoard.categories
    .flatMap((category) => category.items.map((item) => ({ category: category.label, item })))
    .filter(({ item }) => ['canvas', 'lyric-clips', 'viral-clips', 'ugc-clips', 'lyric-video', 'ad-creatives'].includes(item.id))

  return (
    <div className="grid gap-4">
      <section
        className="rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={onDrop}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
              Provided
            </h3>
            <p className="mt-1 text-xs text-white/36">{files.length} file{files.length === 1 ? '' : 's'} in campaign vault</p>
          </div>
          <button
            type="button"
            onClick={() => void onOpenFolder()}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-white/60 hover:bg-white/[0.07] hover:text-white"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Folder
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <AssetBucket icon={Music2} label="Master" value={master?.label ?? 'Missing'} active={Boolean(master)} busy={busy} onClick={() => onAdd('master')} />
          <AssetBucket icon={FileText} label="Lyrics" value={lyrics?.label ?? 'Missing'} active={Boolean(lyrics)} busy={busy} onClick={() => onAdd('lyrics')} />
          <AssetBucket icon={ImageIcon} label="Cover Art" value={cover?.label ?? 'Missing'} active={Boolean(cover)} busy={busy} onClick={() => onAdd('cover-art')} />
          <AssetBucket icon={ImageIcon} label="Photos" value={photos ? `${photos} added` : 'Add'} active={photos > 0} busy={busy} onClick={() => onAdd('any')} />
          <AssetBucket icon={Video} label="Raw Video" value={rawVideo ? `${rawVideo} added` : 'Add'} active={rawVideo > 0} busy={busy} onClick={() => onAdd('any')} />
          <AssetBucket icon={Sparkles} label="References" value={refs ? `${refs} added` : 'Add'} active={refs > 0} busy={busy} onClick={() => onAdd('any')} />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onAdd('any')}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.10] bg-white/[0.012] text-sm font-medium text-white/52 hover:bg-white/[0.04] hover:text-white/78 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Drop files here or add to Inbox
        </button>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-[#0b0b0b] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">
            To Create
          </h3>
          <FileArchive className="h-3.5 w-3.5 text-white/25" />
        </div>
        <div className="grid gap-2">
          {toCreate.map(({ category, item }) => {
            const done = item.status === 'done'
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.045] bg-white/[0.012] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white/76">{item.label}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-white/28">{category}</p>
                </div>
                <span className={cn(
                  'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium',
                  done ? 'bg-emerald-400/10 text-emerald-300/78' : 'bg-white/[0.035] text-white/38',
                )}>
                  {done ? <CheckCircle2 className="h-3 w-3" /> : null}
                  {done ? 'Ready' : 'Needed'}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function AssetBucket({
  icon: Icon,
  label,
  value,
  active,
  busy,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  active: boolean
  busy: boolean
  onClick: () => Promise<void>
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onClick()}
      className="group min-w-0 rounded-xl border border-white/[0.045] bg-white/[0.012] p-3 text-left transition-colors hover:border-white/[0.10] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <Icon className={cn('h-4 w-4', active ? 'text-orange-300/80' : 'text-white/32')} />
        <span className={cn('h-2 w-2 rounded-full', active ? 'bg-emerald-400/80' : 'bg-white/[0.10]')} />
      </div>
      <p className="truncate text-sm font-medium text-white/78">{label}</p>
      <p className={cn('mt-0.5 truncate text-xs', active ? 'text-white/45' : 'text-white/28')}>{value}</p>
    </button>
  )
}

function firstAsset(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): MissionAssetRecord | null {
  return files.find((file) => file.status === 'available' && kinds.includes(file.kind)) ?? null
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseReferences(value: string): MissionReference[] {
  return parseList(value).map((item) => ({ type: 'other', value: item }))
}
