import * as React from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, FileVideo, FolderOpen, History, Minus, Plus, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useOutputs, type OutputAssetDTO, type OutputManifestDTO } from '@/hooks/useOutputs'
import { findVideoProjectAsset, formatDuration, summarizeVideoProject } from '@/components/outputs/video-project-output'
import type { RunnerVideoProject, VideoClip } from '@craft-agent/shared/video'

interface Props {
  workspaceId: string
  outputId: string
}

type VideoProject = RunnerVideoProject

type VideoStudioElectronAPI = typeof window.electronAPI & {
  writeOutputAssetText?: (workspaceId: string, outputId: string, assetId: string, content: string) => Promise<boolean>
}

export default function VideoStudioPage({ workspaceId, outputId }: Props) {
  const { getOutput } = useOutputs(workspaceId)
  const [manifest, setManifest] = React.useState<OutputManifestDTO | null>(null)
  const [projectAsset, setProjectAsset] = React.useState<OutputAssetDTO | null>(null)
  const [project, setProject] = React.useState<VideoProject | null>(null)
  const [rawJson, setRawJson] = React.useState('')
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await getOutput(outputId)
      if (!loaded) throw new Error('Output not found.')
      const asset = findVideoProjectAsset(loaded)
      if (!asset) throw new Error('This output does not include a Video Studio project file.')
      const text = await window.electronAPI.readOutputAssetText(workspaceId, outputId, asset.id)
      const parsed = JSON.parse(text) as VideoProject
      setManifest(loaded)
      setProjectAsset(asset)
      setProject(parsed)
      setRawJson(JSON.stringify(parsed, null, 2))
      const firstClip = parsed.timeline?.tracks?.flatMap((track) => track.clips ?? [])[0]
      setSelectedClipId(firstClip?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [getOutput, outputId, workspaceId])

  React.useEffect(() => {
    void load()
  }, [load])

  const selectedClip = React.useMemo(() => {
    if (!project || !selectedClipId) return null
    for (const track of project.timeline?.tracks ?? []) {
      const clip = track.clips?.find((item) => item.id === selectedClipId)
      if (clip) return clip
    }
    return null
  }, [project, selectedClipId])

  const updateProject = React.useCallback((updater: (current: VideoProject) => VideoProject) => {
    setProject((current) => {
      if (!current) return current
      const next = updater(current)
      setRawJson(JSON.stringify(next, null, 2))
      return next
    })
  }, [])

  const updateSelectedClip = React.useCallback((patch: Partial<VideoClip>) => {
    if (!selectedClipId) return
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => ({
        ...track,
        clips: (track.clips ?? []).map((clip) => clip.id === selectedClipId ? { ...clip, ...patch } : clip),
      }))
      const durationMs = computeTimelineDuration(tracks)
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs,
          tracks,
        },
      }
    })
  }, [selectedClipId, updateProject])

  const nudgeSelectedClip = React.useCallback((deltaMs: number) => {
    if (!selectedClip) return
    updateSelectedClip({ startMs: Math.max(0, (selectedClip.startMs ?? 0) + deltaMs) })
  }, [selectedClip, updateSelectedClip])

  const resizeSelectedClip = React.useCallback((deltaMs: number) => {
    if (!selectedClip) return
    updateSelectedClip({ durationMs: Math.max(100, (selectedClip.durationMs ?? 1000) + deltaMs) })
  }, [selectedClip, updateSelectedClip])

  const save = async () => {
    if (!projectAsset) return
    setSaving(true)
    try {
      const parsed = addUserEditVersion(JSON.parse(rawJson) as VideoProject)
      await (window.electronAPI as VideoStudioElectronAPI).writeOutputAssetText?.(
        workspaceId,
        outputId,
        projectAsset.id,
        `${JSON.stringify(parsed, null, 2)}\n`,
      )
      setProject(parsed)
      setRawJson(JSON.stringify(parsed, null, 2))
      toast.success('Video project saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="runneros-glass-route flex h-full items-center justify-center text-sm text-white/50">Loading Video Studio</div>
  }

  if (error || !project || !manifest) {
    return (
      <div className="m-5 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span>{error ?? 'Video project unavailable.'}</span>
      </div>
    )
  }

  const summary = summarizeVideoProject(project)
  const tracks = project.timeline?.tracks ?? []
  const media = project.media ?? []
  const duration = project.timeline?.durationMs ?? 0

  return (
    <div className="runneros-glass-route h-full overflow-hidden">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/42">
              <FileVideo className="h-3.5 w-3.5" />
              Video Studio
            </div>
            <input
              value={project.title}
              onChange={(event) => updateProject((current) => ({ ...current, title: event.target.value }))}
              className="mt-1 w-full min-w-0 bg-transparent text-2xl font-semibold text-white outline-none"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {projectAsset && (
              <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => window.electronAPI.showOutputInFolder(workspaceId, outputId, projectAsset.id)}>
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                Show
              </Button>
            )}
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reload
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? 'Saving' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_300px] gap-0">
          <aside className="min-h-0 overflow-auto border-r border-white/[0.08] p-3">
            <PanelTitle title="Media" value={`${media.length}`} />
            <div className="mt-2 grid gap-2">
              {media.length === 0 ? <EmptyText>No media yet</EmptyText> : media.map((item) => (
                <div key={item.id} className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2">
                  <div className="truncate text-sm font-medium text-white/78">{item.label ?? item.id}</div>
                  <div className="mt-1 truncate text-xs text-white/42">{item.type ?? 'media'} · {item.path ?? ''}</div>
                </div>
              ))}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="grid shrink-0 grid-cols-4 gap-2 border-b border-white/[0.08] p-3">
              <Metric label="Duration" value={formatDuration(duration)} />
              <Metric label="Canvas" value={`${summary?.width ?? '-'} x ${summary?.height ?? '-'}`} />
              <Metric label="FPS" value={String(summary?.fps ?? '-')} />
              <Metric label="Versions" value={String(summary?.versionCount ?? 0)} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <PanelTitle title="Timeline" value={`${summary?.clipCount ?? 0} clips`} />
              <div className="mt-3 grid gap-3">
                {tracks.map((track) => (
                  <div key={track.id} className="rounded-md border border-white/[0.08] bg-black/30">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-xs text-white/48">
                      <span>{track.label ?? track.id}</span>
                      <span>{track.type ?? 'track'}</span>
                    </div>
                    <div className="flex min-h-[58px] items-center gap-2 overflow-x-auto p-2">
                      {(track.clips ?? []).length === 0 ? <span className="text-xs text-white/35">No clips</span> : track.clips!.map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => setSelectedClipId(clip.id)}
                          className={`h-10 min-w-[112px] rounded-md border px-2 text-left text-xs ${selectedClipId === clip.id ? 'border-[#f97316]/70 bg-[#f97316]/18 text-white' : 'border-white/[0.08] bg-white/[0.045] text-white/68'}`}
                          style={{ width: `${Math.max(112, Math.min(320, (clip.durationMs ?? 1000) / 12))}px` }}
                        >
                          <span className="block truncate font-medium">{clip.label ?? clip.type ?? 'clip'}</span>
                          <span className="block truncate text-white/42">{formatDuration(clip.startMs ?? 0)} · {formatDuration(clip.durationMs ?? 0)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>

          <aside className="min-h-0 overflow-auto border-l border-white/[0.08] p-3">
            <PanelTitle title="Inspector" value={selectedClip ? 'Clip' : 'Project'} />
            {selectedClip ? (
              <div className="mt-3 grid gap-3">
                <Field label="Label" value={selectedClip.label ?? ''} onChange={(value) => updateSelectedClip({ label: value })} />
                <div className="grid gap-1 text-xs text-white/42">
                  Clip Tools
                  <div className="grid grid-cols-4 gap-1">
                    <IconButton label="-250 ms" onClick={() => nudgeSelectedClip(-250)}><ChevronLeft className="h-3.5 w-3.5" /></IconButton>
                    <IconButton label="+250 ms" onClick={() => nudgeSelectedClip(250)}><ChevronRight className="h-3.5 w-3.5" /></IconButton>
                    <IconButton label="Trim -" onClick={() => resizeSelectedClip(-250)}><Minus className="h-3.5 w-3.5" /></IconButton>
                    <IconButton label="Trim +" onClick={() => resizeSelectedClip(250)}><Plus className="h-3.5 w-3.5" /></IconButton>
                  </div>
                </div>
                <NumberField label="Start ms" value={selectedClip.startMs ?? 0} onChange={(value) => updateSelectedClip({ startMs: Math.max(0, value) })} />
                <NumberField label="Duration ms" value={selectedClip.durationMs ?? 1000} onChange={(value) => updateSelectedClip({ durationMs: Math.max(1, value) })} />
                {selectedClip.mediaId && <ReadOnlyValue label="Media ID" value={selectedClip.mediaId} />}
              </div>
            ) : <EmptyText>Select a clip to inspect</EmptyText>}

            <div className="mt-5">
              <PanelTitle title="Project JSON" value="editable" />
              <textarea
                value={rawJson}
                onChange={(event) => setRawJson(event.target.value)}
                spellCheck={false}
                className="mt-2 h-80 w-full resize-none rounded-md border border-white/[0.08] bg-black/45 p-2 font-mono text-xs text-white/68 outline-none focus:border-[#f97316]/50"
              />
            </div>

            <div className="mt-5">
              <PanelTitle title="Agent Changes" value={`${project.agentEvents?.length ?? 0}`} />
              <div className="mt-2 grid gap-2">
                {(project.agentEvents ?? []).slice(-5).reverse().map((event, index) => (
                  <div key={event.id ?? index} className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2 text-xs">
                    <div className="text-white/72">{event.summary ?? event.toolName ?? 'Agent edit'}</div>
                    <div className="mt-1 text-white/38">{event.agentSlug ?? 'agent'} · {event.createdAt ?? ''}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <PanelTitle title="Versions" value={`${project.versions?.length ?? 0}`} />
              <div className="mt-2 grid gap-2">
                {(project.versions ?? []).slice(-6).reverse().map((version) => (
                  <div key={version.id} className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2 text-xs">
                    <div className="flex items-center gap-1.5 text-white/72">
                      <History className="h-3.5 w-3.5 text-white/38" />
                      <span className="truncate">{version.summary}</span>
                    </div>
                    <div className="mt-1 text-white/38">{version.actor}{version.agentSlug ? ` · ${version.agentSlug}` : ''} · {version.createdAt}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function computeTimelineDuration(tracks: VideoProject['timeline']['tracks']): number {
  return tracks.reduce((duration, track) => Math.max(
    duration,
    ...(track.clips ?? []).map((clip) => (clip.startMs ?? 0) + (clip.durationMs ?? 0)),
  ), 0)
}

function addUserEditVersion(project: VideoProject): VideoProject {
  const now = new Date().toISOString()
  return {
    ...project,
    updatedAt: now,
    versions: [
      ...(project.versions ?? []),
      {
        id: crypto.randomUUID(),
        createdAt: now,
        summary: 'Edited in Video Studio',
        actor: 'user',
      },
    ],
  }
}

function PanelTitle({ title, value }: { title: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-white/42">
      <span>{title}</span>
      {value && <span>{value}</span>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.035] p-2">
      <div className="text-xs text-white/42">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-white/78">{value}</div>
    </div>
  )
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3 text-sm text-white/42">{children}</div>
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-xs text-white/42">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="h-8 rounded-md border border-white/[0.08] bg-black/35 px-2 text-sm text-white/72 outline-none focus:border-[#f97316]/50" />
    </label>
  )
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-xs text-white/42">
      {label}
      <div className="h-8 truncate rounded-md border border-white/[0.08] bg-black/25 px-2 py-1.5 text-sm text-white/55">{value}</div>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-8 items-center justify-center rounded-md border border-white/[0.08] bg-black/35 text-white/68 outline-none hover:border-[#f97316]/40 hover:text-white"
    >
      {children}
    </button>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-xs text-white/42">
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-8 rounded-md border border-white/[0.08] bg-black/35 px-2 text-sm text-white/72 outline-none focus:border-[#f97316]/50" />
    </label>
  )
}
