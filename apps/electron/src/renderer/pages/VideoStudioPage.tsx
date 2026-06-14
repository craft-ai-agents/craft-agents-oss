import * as React from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, FileVideo, FolderOpen, History, Loader2, Magnet, Minus, Plus, Redo2, RefreshCw, Save, Scissors, ShieldCheck, Trash2, Undo2, Upload } from 'lucide-react'
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

interface TimelineDragState {
  clipId: string
  startX: number
  initialStartMs: number
  active: boolean
}

type VideoStudioElectronAPI = typeof window.electronAPI & {
  writeOutputAssetText?: (workspaceId: string, outputId: string, assetId: string, content: string) => Promise<boolean>
  importVideoStudioMedia?: (workspaceId: string, outputId: string, options?: { mode?: 'files' | 'folder' }) => Promise<{ imported: Array<{ label: string }>; skipped?: number }>
  inspectVideoStudio?: (workspaceId: string, outputId: string) => Promise<{ ok: boolean; assetId: string; status: number }>
  dryRunVideoStudio?: (workspaceId: string, outputId: string) => Promise<{ ok: boolean; assetId: string; status: number }>
  exportVideoStudio?: (workspaceId: string, outputId: string, preset?: string) => Promise<{ assetId: string }>
}

export default function VideoStudioPage({ workspaceId, outputId }: Props) {
  const { getOutput } = useOutputs(workspaceId)
  const [manifest, setManifest] = React.useState<OutputManifestDTO | null>(null)
  const [projectAsset, setProjectAsset] = React.useState<OutputAssetDTO | null>(null)
  const [project, setProject] = React.useState<VideoProject | null>(null)
  const [rawJson, setRawJson] = React.useState('')
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [playheadMs, setPlayheadMs] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const [checking, setChecking] = React.useState<'inspect' | 'dry-run' | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [timelineDrag, setTimelineDrag] = React.useState<TimelineDragState | null>(null)
  const [undoStack, setUndoStack] = React.useState<VideoProject[]>([])
  const [redoStack, setRedoStack] = React.useState<VideoProject[]>([])
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
      setUndoStack([])
      setRedoStack([])
      const latestRender = findLatestVideoRenderAsset(loaded)
      if (latestRender) {
        const url = await window.electronAPI.readOutputAssetDataUrl(workspaceId, outputId, latestRender.id)
        setPreviewUrl(url)
      } else {
        setPreviewUrl(null)
      }
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

  React.useEffect(() => {
    const cleanup = window.electronAPI.onOutputsUpdated?.((changedWorkspaceId) => {
      if (changedWorkspaceId === workspaceId) void load()
    })
    return cleanup
  }, [load, workspaceId])

  const selectedClip = React.useMemo(() => {
    if (!project || !selectedClipId) return null
    for (const track of project.timeline?.tracks ?? []) {
      const clip = track.clips?.find((item) => item.id === selectedClipId)
      if (clip) return clip
    }
    return null
  }, [project, selectedClipId])

  const updateProject = React.useCallback((updater: (current: VideoProject) => VideoProject, options: { recordHistory?: boolean } = {}) => {
    setProject((current) => {
      if (!current) return current
      const next = updater(current)
      if (next === current) return current
      if (options.recordHistory !== false) {
        setUndoStack((items) => [...items.slice(-49), current])
        setRedoStack([])
      }
      setRawJson(JSON.stringify(next, null, 2))
      return next
    })
  }, [])

  const restoreProject = React.useCallback((next: VideoProject) => {
    setProject(next)
    setRawJson(JSON.stringify(next, null, 2))
    const clipStillExists = selectedClipId && next.timeline?.tracks?.some((track) => track.clips?.some((clip) => clip.id === selectedClipId))
    if (!clipStillExists) {
      const firstClip = next.timeline?.tracks?.flatMap((track) => track.clips ?? [])[0]
      setSelectedClipId(firstClip?.id ?? null)
    }
  }, [selectedClipId])

  const undo = React.useCallback(() => {
    if (!project || undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack((items) => items.slice(0, -1))
    setRedoStack((items) => [...items.slice(-49), project])
    restoreProject(previous)
  }, [project, restoreProject, undoStack])

  const redo = React.useCallback(() => {
    if (!project || redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setRedoStack((items) => items.slice(0, -1))
    setUndoStack((items) => [...items.slice(-49), project])
    restoreProject(next)
  }, [project, redoStack, restoreProject])

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

  const moveClip = React.useCallback((clipId: string, startMs: number, snap = true, recordHistory = true) => {
    updateProject((current) => moveClipInProject(current, clipId, startMs, snap), { recordHistory })
  }, [updateProject])

  React.useEffect(() => {
    if (!timelineDrag) return

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - timelineDrag.startX
      if (!timelineDrag.active && Math.abs(deltaX) < 4) return
      if (!timelineDrag.active) {
        setProject((current) => {
          if (current) {
            setUndoStack((items) => [...items.slice(-49), current])
            setRedoStack([])
          }
          return current
        })
        setTimelineDrag((current) => current ? { ...current, active: true } : current)
      }
      const deltaMs = Math.round(deltaX * 12)
      moveClip(timelineDrag.clipId, timelineDrag.initialStartMs + deltaMs, true, false)
    }
    const handlePointerUp = () => {
      setTimelineDrag(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [moveClip, timelineDrag])

  const nudgeSelectedClip = React.useCallback((deltaMs: number) => {
    if (!selectedClip) return
    updateSelectedClip({ startMs: Math.max(0, (selectedClip.startMs ?? 0) + deltaMs) })
  }, [selectedClip, updateSelectedClip])

  const resizeSelectedClip = React.useCallback((deltaMs: number) => {
    if (!selectedClip) return
    updateSelectedClip({ durationMs: Math.max(100, (selectedClip.durationMs ?? 1000) + deltaMs) })
  }, [selectedClip, updateSelectedClip])

  const packTimeline = React.useCallback(() => {
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        let cursor = 0
        const clips = [...(track.clips ?? [])]
          .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
          .map((clip) => {
            const nextClip = { ...clip, startMs: cursor }
            cursor += Math.max(1, clip.durationMs ?? 1)
            return nextClip
          })
        return { ...track, clips }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    toast.success('Timeline packed.')
  }, [updateProject])

  const duplicateSelectedClip = React.useCallback(() => {
    if (!selectedClipId) return
    let createdId: string | null = null
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        const index = (track.clips ?? []).findIndex((clip) => clip.id === selectedClipId)
        if (index === -1) return track
        const clips = [...(track.clips ?? [])]
        const clip = clips[index]
        if (!clip) return track
        createdId = crypto.randomUUID()
        const insertStart = (clip.startMs ?? 0) + Math.max(1, clip.durationMs ?? 1)
        const clipDuration = Math.max(1, clip.durationMs ?? 1)
        for (let nextIndex = 0; nextIndex < clips.length; nextIndex += 1) {
          const nextClip = clips[nextIndex]
          if (nextClip && nextClip.id !== clip.id && (nextClip.startMs ?? 0) >= insertStart) {
            clips[nextIndex] = { ...nextClip, startMs: (nextClip.startMs ?? 0) + clipDuration }
          }
        }
        clips.splice(index + 1, 0, {
          ...clip,
          id: createdId,
          startMs: insertStart,
          label: clip.label ? `${clip.label} copy` : undefined,
        })
        return { ...track, clips: sortClipsByStart(clips) }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    if (createdId) setSelectedClipId(createdId)
  }, [selectedClipId, updateProject])

  const deleteSelectedClip = React.useCallback(() => {
    if (!selectedClipId) return
    let nextSelection: string | null = null
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        const clips = (track.clips ?? []).filter((clip) => clip.id !== selectedClipId)
        if (!nextSelection) nextSelection = clips[0]?.id ?? null
        return { ...track, clips }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    setSelectedClipId(nextSelection)
  }, [selectedClipId, updateProject])

  const splitSelectedClip = React.useCallback(() => {
    if (!selectedClipId || !selectedClip) return
    const clipStart = selectedClip.startMs ?? 0
    const clipDuration = selectedClip.durationMs ?? 0
    const splitAt = Math.round(playheadMs)
    const clipEnd = clipStart + clipDuration
    if (splitAt <= clipStart || splitAt >= clipEnd) {
      toast.error('Playhead must be inside the selected clip.')
      return
    }
    let createdId: string | null = null
    updateProject((current) => {
      const tracks = (current.timeline?.tracks ?? []).map((track) => {
        const index = (track.clips ?? []).findIndex((clip) => clip.id === selectedClipId)
        if (index === -1) return track
        const clips = [...(track.clips ?? [])]
        const clip = clips[index]
        if (!clip) return track
        const firstDuration = splitAt - (clip.startMs ?? 0)
        const secondDuration = (clip.durationMs ?? 0) - firstDuration
        const sourceInMs = clip.sourceInMs ?? 0
        createdId = crypto.randomUUID()
        clips.splice(index, 1, {
          ...clip,
          durationMs: firstDuration,
          sourceOutMs: clip.sourceOutMs !== undefined ? sourceInMs + firstDuration : clip.sourceOutMs,
        }, {
          ...clip,
          id: createdId,
          startMs: splitAt,
          durationMs: secondDuration,
          sourceInMs: sourceInMs + firstDuration,
          label: clip.label ? `${clip.label} split` : undefined,
        })
        return { ...track, clips }
      })
      return {
        ...current,
        timeline: {
          ...current.timeline,
          durationMs: computeTimelineDuration(tracks),
          tracks,
        },
      }
    })
    if (createdId) setSelectedClipId(createdId)
  }, [playheadMs, selectedClip, selectedClipId, updateProject])

  const persistProject = async (summary = 'Edited in Video Studio') => {
    if (!projectAsset) return
    setSaving(true)
    try {
      const parsed = addUserEditVersion(JSON.parse(rawJson) as VideoProject, summary)
      await (window.electronAPI as VideoStudioElectronAPI).writeOutputAssetText?.(
        workspaceId,
        outputId,
        projectAsset.id,
        `${JSON.stringify(parsed, null, 2)}\n`,
      )
      setProject(parsed)
      setRawJson(JSON.stringify(parsed, null, 2))
      return parsed
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    await persistProject()
    toast.success('Video project saved.')
  }

  const importMedia = async (mode: 'files' | 'folder') => {
    setImporting(true)
    try {
      const result = await (window.electronAPI as VideoStudioElectronAPI).importVideoStudioMedia?.(workspaceId, outputId, { mode })
      if (!result || result.imported.length === 0) {
        toast.info('No supported media files found.')
        return
      }
      const skipped = result.skipped ? ` Skipped ${result.skipped}.` : ''
      toast.success(`Imported ${result.imported.length} media file${result.imported.length === 1 ? '' : 's'}.${skipped}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  const exportProject = async () => {
    setExporting(true)
    try {
      await persistProject('Saved before export')
      const result = await (window.electronAPI as VideoStudioElectronAPI).exportVideoStudio?.(workspaceId, outputId, 'simple-mp4')
      if (!result) throw new Error('Video Studio export bridge is unavailable.')
      toast.success('Video export rendered.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const runReport = async (command: 'inspect' | 'dry-run') => {
    setChecking(command)
    try {
      await persistProject(command === 'inspect' ? 'Saved before inspect' : 'Saved before dry run')
      const api = window.electronAPI as VideoStudioElectronAPI
      const result = command === 'inspect'
        ? await api.inspectVideoStudio?.(workspaceId, outputId)
        : await api.dryRunVideoStudio?.(workspaceId, outputId)
      if (!result) throw new Error('Video Studio report bridge is unavailable.')
      if (result.ok) toast.success(command === 'inspect' ? 'Inspect report passed.' : 'Dry run passed.')
      else toast.error(command === 'inspect' ? 'Inspect found issues. Report saved.' : 'Dry run failed. Report saved.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(null)
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
  const isBusy = saving || importing || checking !== null || exporting

  return (
    <div className="runneros-glass-route h-full overflow-hidden">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.08] px-5 py-3">
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
          <div className="grid w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2 [&>button]:min-w-0 [&>button]:w-full [&>button]:justify-center">
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
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={undo} disabled={isBusy || undoStack.length === 0}>
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Undo
            </Button>
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={redo} disabled={isBusy || redoStack.length === 0}>
              <Redo2 className="mr-1.5 h-3.5 w-3.5" />
              Redo
            </Button>
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => void importMedia('files')} disabled={isBusy}>
              {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
              Files
            </Button>
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => void importMedia('folder')} disabled={isBusy}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
              Folder
            </Button>
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => void runReport('inspect')} disabled={isBusy}>
              {checking === 'inspect' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />}
              Inspect
            </Button>
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={() => void runReport('dry-run')} disabled={isBusy}>
              {checking === 'dry-run' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
              Dry Run
            </Button>
            <Button size="sm" variant="outline" className="border-white/[0.08] bg-white/[0.045] text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={exportProject} disabled={isBusy}>
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Export
            </Button>
            <Button size="sm" onClick={save} disabled={isBusy}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? 'Saving' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-0 overflow-auto">
          <aside className="min-h-0 min-w-0 overflow-auto border-r border-white/[0.08] p-3">
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

          <main className="flex min-h-0 min-w-0 flex-col">
            <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))] gap-2 border-b border-white/[0.08] p-3">
              <Metric label="Duration" value={formatDuration(duration)} />
              <Metric label="Canvas" value={`${summary?.width ?? '-'} x ${summary?.height ?? '-'}`} />
              <Metric label="FPS" value={String(summary?.fps ?? '-')} />
              <Metric label="Versions" value={String(summary?.versionCount ?? 0)} />
            </div>
            <div className="shrink-0 border-b border-white/[0.08] bg-black/25 p-3">
              <PanelTitle title="Preview" value={previewUrl ? 'latest export' : 'not rendered'} />
              <div className="mt-2 flex aspect-video max-h-[280px] items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-black">
                {previewUrl ? (
                  <video src={previewUrl} controls className="h-full w-full object-contain" />
                ) : (
                  <div className="text-sm text-white/38">Export once to preview rendered video</div>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="flex items-center justify-between gap-3">
                <PanelTitle title="Timeline" value={`${summary?.clipCount ?? 0} clips`} />
                <div className="flex items-center gap-2">
                  <NumberField compact label="Playhead" value={playheadMs} onChange={(value) => setPlayheadMs(Math.max(0, value))} />
                  <Button size="sm" variant="outline" className="h-8 border-white/[0.08] bg-white/[0.045] px-2 text-white/72 hover:bg-white/[0.08] hover:text-white" onClick={packTimeline}>
                    <Magnet className="mr-1.5 h-3.5 w-3.5" />
                    Pack
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid gap-3">
                {tracks.map((track) => (
                  <div key={track.id} className="rounded-md border border-white/[0.08] bg-black/30">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-xs text-white/48">
                      <span>{track.label ?? track.id}</span>
                      <span>{track.type ?? 'track'}</span>
                    </div>
                    <div className="flex min-h-[58px] items-center gap-2 overflow-x-auto p-2">
                      {(track.clips ?? []).length === 0 ? <span className="text-xs text-white/35">No clips</span> : renderTimelineClips(track.clips ?? [], selectedClipId, (clip) => {
                        setSelectedClipId(clip.id)
                      }, (event, clip) => {
                        event.preventDefault()
                        setSelectedClipId(clip.id)
                        setTimelineDrag({ clipId: clip.id, startX: event.clientX, initialStartMs: clip.startMs ?? 0, active: false })
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>

          <aside className="min-h-0 min-w-0 overflow-auto border-l border-white/[0.08] p-3">
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
                    <IconButton label="Split at playhead" onClick={splitSelectedClip}><Scissors className="h-3.5 w-3.5" /></IconButton>
                    <IconButton label="Duplicate" onClick={duplicateSelectedClip}><Copy className="h-3.5 w-3.5" /></IconButton>
                    <IconButton label="Delete" onClick={deleteSelectedClip}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    <IconButton label="Pack timeline" onClick={packTimeline}><Magnet className="h-3.5 w-3.5" /></IconButton>
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

function sortClipsByStart(clips: VideoClip[]): VideoClip[] {
  return [...clips].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
}

function snapClipStart(clips: VideoClip[], clipId: string, proposedStartMs: number, thresholdMs = 250): number {
  const snapPoints = clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => (clip.startMs ?? 0) + Math.max(1, clip.durationMs ?? 1))
  let best = Math.max(0, Math.round(proposedStartMs))
  let bestDistance = thresholdMs + 1
  for (const point of snapPoints) {
    const distance = Math.abs(point - proposedStartMs)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  return Math.max(0, best)
}

function moveClipInProject(project: VideoProject, clipId: string, startMs: number, snap: boolean): VideoProject {
  const tracks = (project.timeline?.tracks ?? []).map((track) => {
    const hasClip = (track.clips ?? []).some((clip) => clip.id === clipId)
    if (!hasClip) return track
    const nextStartMs = snap ? snapClipStart(track.clips ?? [], clipId, startMs) : Math.max(0, Math.round(startMs))
    return {
      ...track,
      clips: sortClipsByStart((track.clips ?? []).map((clip) => clip.id === clipId ? { ...clip, startMs: nextStartMs } : clip)),
    }
  })
  return {
    ...project,
    timeline: {
      ...project.timeline,
      durationMs: computeTimelineDuration(tracks),
      tracks,
    },
  }
}

function timelinePixels(ms: number): number {
  return Math.max(12, Math.min(320, ms / 12))
}

function renderTimelineClips(
  clips: VideoClip[],
  selectedClipId: string | null,
  onSelectClip: (clip: VideoClip) => void,
  onStartDrag: (event: React.PointerEvent<HTMLButtonElement>, clip: VideoClip) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const clip of sortClipsByStart(clips)) {
    const startMs = clip.startMs ?? 0
    const durationMs = clip.durationMs ?? 1000
    const gapMs = Math.max(0, startMs - cursor)
    if (gapMs > 0) {
      nodes.push(
        <div
          key={`gap-${clip.id}`}
          className="flex h-10 shrink-0 items-center justify-center rounded-md border border-dashed border-white/[0.06] bg-black/25 px-2 text-[10px] uppercase tracking-wide text-white/28"
          style={{ width: `${timelinePixels(gapMs)}px` }}
        >
          Gap
        </div>,
      )
    }
    nodes.push(
      <button
        key={clip.id}
        type="button"
        onClick={() => onSelectClip(clip)}
        onPointerDown={(event) => onStartDrag(event, clip)}
        className={`h-10 min-w-[112px] cursor-grab rounded-md border px-2 text-left text-xs active:cursor-grabbing ${selectedClipId === clip.id ? 'border-[#f97316]/70 bg-[#f97316]/18 text-white' : 'border-white/[0.08] bg-white/[0.045] text-white/68'}`}
        style={{ width: `${Math.max(112, timelinePixels(durationMs))}px` }}
      >
        <span className="block truncate font-medium">{clip.label ?? clip.type ?? 'clip'}</span>
        <span className="block truncate text-white/42">{formatDuration(startMs)} · {formatDuration(durationMs)}</span>
      </button>,
    )
    cursor = Math.max(cursor, startMs + durationMs)
  }
  return nodes
}

function findLatestVideoRenderAsset(manifest: OutputManifestDTO): OutputAssetDTO | null {
  const primary = manifest.primary
  if (primary?.mimeType?.startsWith('video/')) return primary
  return [...manifest.assets].reverse().find((asset) =>
    asset.mimeType?.startsWith('video/')
    || /\.(mp4|mov|m4v|webm)$/i.test(asset.path)
  ) ?? null
}

function addUserEditVersion(project: VideoProject, summary: string): VideoProject {
  const now = new Date().toISOString()
  return {
    ...project,
    updatedAt: now,
    versions: [
      ...(project.versions ?? []),
      {
        id: crypto.randomUUID(),
        createdAt: now,
        summary,
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

function NumberField({ label, value, onChange, compact = false }: { label: string; value: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className={`${compact ? 'flex items-center gap-1' : 'grid gap-1'} text-xs text-white/42`}>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${compact ? 'w-24' : 'w-full'} h-8 rounded-md border border-white/[0.08] bg-black/35 px-2 text-sm text-white/72 outline-none focus:border-[#f97316]/50`} />
    </label>
  )
}
