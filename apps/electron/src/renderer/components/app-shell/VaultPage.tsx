import * as React from 'react'
import { FileArchive, FileText, FolderOpen, Image, Loader2, Music2, RefreshCw, Upload, Video, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { MissionAssetKind, MissionAssetKindHint, MissionAssetManifest, MissionAssetRecord } from '@craft-agent/shared/mission-assets'

interface VaultPageProps {
  workspaceId: string
  workspaceName?: string
}

const CATEGORIES: Array<{
  id: string
  label: string
  icon: React.ElementType
  kinds: MissionAssetKind[]
  hint: MissionAssetKindHint
}> = [
  { id: 'audio', label: 'Audio', icon: Music2, kinds: ['master', 'demo', 'stem', 'audio-reference'], hint: 'master' },
  { id: 'images', label: 'Images', icon: Image, kinds: ['cover-art', 'press-photo', 'moodboard-image'], hint: 'cover-art' },
  { id: 'video', label: 'Video', icon: Video, kinds: ['raw-video', 'edited-video', 'final-video'], hint: 'any' },
  { id: 'docs', label: 'Docs', icon: FileText, kinds: ['lyrics', 'press-doc', 'note'], hint: 'lyrics' },
  { id: 'exports', label: 'Exports', icon: FileArchive, kinds: ['export', 'other'], hint: 'any' },
]

export function VaultPage({ workspaceId, workspaceName }: VaultPageProps) {
  const [manifest, setManifest] = React.useState<MissionAssetManifest | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      setManifest(await window.electronAPI.getMissionAssetManifest(workspaceId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const files = manifest?.files ?? []
  const addFiles = React.useCallback(async (kindHint: MissionAssetKindHint, key: string) => {
    if (!workspaceId) return
    setBusy(key)
    try {
      const paths = await window.electronAPI.chooseMissionAssetFiles(workspaceId, kindHint)
      if (!paths.length) return
      const result = await window.electronAPI.importMissionAssets(workspaceId, paths, { kindHint })
      setManifest(result.manifest)
      toast.success(`Added ${result.imported.length} vault file${result.imported.length === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [workspaceId])

  const openFolder = React.useCallback(async () => {
    if (!workspaceId) return
    const opened = await window.electronAPI.openMissionAssetsFolder(workspaceId)
    if (!opened) toast.error('Could not open Vault folder')
  }, [workspaceId])

  const scanFolder = React.useCallback(async () => {
    if (!workspaceId) return
    setBusy('scan')
    try {
      const result = await window.electronAPI.scanMissionAssets(workspaceId)
      setManifest(result.manifest)
      toast.success(result.added.length
        ? `Indexed ${result.added.length} vault file${result.added.length === 1 ? '' : 's'}`
        : 'Vault is already indexed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [workspaceId])

  return (
    <div className="h-full overflow-y-auto bg-[#050505] text-foreground">
      <div className="mx-auto min-h-full max-w-[1400px] px-5 py-4 xl:px-8 xl:py-5">
        <header className="relative mb-6 overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0A0A0A] p-6 lg:p-8">
          <div className="absolute -left-[18%] -top-[50%] h-[520px] w-[520px] rounded-full bg-indigo-600/10 blur-[110px]" />
          <div className="absolute -bottom-[50%] -right-[12%] h-[520px] w-[520px] rounded-full bg-indigo-500/5 blur-[120px]" />
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1.5">
                <FolderOpen className="h-3.5 w-3.5 text-indigo-300/80" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/65">Asset Library</span>
              </div>
              <div className="max-w-3xl">
                <h1 className="text-4xl font-medium tracking-tighter text-white/90 sm:text-5xl lg:text-[56px] lg:leading-[0.96]">
                  Vault
                </h1>
                <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-white/50">
                  Files workers can use: audio, artwork, photos, video, docs, references, and exports.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void scanFolder()}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/65 hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-50 transition-colors"
              >
                {busy === 'scan' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Scan Folder
              </button>
              <button
                type="button"
                onClick={openFolder}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-4 text-xs font-medium text-black hover:bg-white transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Open Folder
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-white/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading Vault...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {CATEGORIES.map((category) => {
              const categoryFiles = files.filter((file) => category.kinds.includes(file.kind))
              const Icon = category.icon
              return (
                <section key={category.id} className="group relative flex flex-col rounded-[16px] border border-white/[0.05] bg-[#0c0c0c]/80 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  
                  <div className="relative z-10 flex flex-col flex-1 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-white/40" />
                        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">{category.label}</h2>
                      </div>
                      <span className="rounded-full bg-white/[0.03] px-2 py-0.5 text-[10px] tabular-nums text-white/30">{categoryFiles.length}</span>
                    </div>

                    <div className="flex-1 space-y-1.5 overflow-y-auto">
                      {categoryFiles.slice(0, 10).map((file) => <VaultFile key={file.id} file={file} />)}
                      {categoryFiles.length === 0 ? (
                        <div className="flex h-24 flex-col items-center justify-center rounded-[10px] border border-dashed border-white/[0.05] bg-white/[0.01] text-center">
                          <Icon className="mb-2 h-5 w-5 text-white/10" />
                          <span className="text-[11px] font-medium text-white/20">Empty</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex justify-center">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void addFiles(category.hint, category.id)}
                        title={`Add ${category.label}`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.02] text-white/50 hover:bg-white/[0.06] hover:text-white/90 disabled:cursor-wait disabled:opacity-50 transition-all"
                      >
                        {busy === category.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function VaultFile({ file }: { file: MissionAssetRecord }) {
  const Icon = file.kind.includes('audio') || file.kind === 'stem' || file.kind === 'demo' ? Music2 :
               file.kind.includes('video') ? Video :
               file.kind.includes('image') || file.kind === 'cover-art' || file.kind === 'press-photo' ? Image :
               file.kind === 'export' ? FileArchive : FileText;

  return (
    <div className={cn(
      'group/file flex items-start gap-2.5 rounded-[10px] border border-white/[0.03] bg-white/[0.015] p-2 transition-colors hover:bg-white/[0.03] hover:border-white/[0.06]',
      file.status !== 'available' && 'opacity-55',
    )}>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.04]">
        <Icon className="h-3 w-3 text-white/40 group-hover/file:text-white/60 transition-colors" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-white/70 group-hover/file:text-white/90 transition-colors">{file.label}</p>
        <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.1em] text-white/30">{file.kind}</p>
      </div>
    </div>
  )
}
