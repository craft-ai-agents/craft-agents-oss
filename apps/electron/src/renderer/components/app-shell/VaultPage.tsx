import * as React from 'react'
import { FileArchive, FileText, FolderOpen, Image, Loader2, Music2, Upload, Video } from 'lucide-react'
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

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="mx-auto min-h-full max-w-[1180px] px-8 py-9">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/46">
              <FolderOpen className="h-3.5 w-3.5 text-orange-300/75" />
              Asset Library
            </div>
            <h1 className="text-4xl font-medium tracking-tight text-white/90">Vault</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Files workers can use: audio, artwork, photos, video, docs, references, and exports for {workspaceName || 'this workspace'}.
            </p>
          </div>
          <button
            type="button"
            onClick={openFolder}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/65 hover:bg-white/[0.06]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Folder
          </button>
        </header>

        {loading ? (
          <div className="flex h-72 items-center justify-center text-sm text-white/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading Vault...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {CATEGORIES.map((category) => {
              const categoryFiles = files.filter((file) => category.kinds.includes(file.kind))
              const Icon = category.icon
              return (
                <section key={category.id} className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3">
                  <div className="mb-3 flex items-center justify-between border-b border-white/[0.045] pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025]">
                        <Icon className="h-3.5 w-3.5 text-white/42" />
                      </span>
                      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">{category.label}</h2>
                    </div>
                    <span className="text-[10px] tabular-nums text-white/28">{categoryFiles.length}</span>
                  </div>

                  <div className="space-y-2">
                    {categoryFiles.slice(0, 8).map((file) => <VaultFile key={file.id} file={file} />)}
                    {categoryFiles.length === 0 ? (
                      <div className="rounded-[14px] border border-dashed border-white/[0.06] bg-white/[0.012] px-3 py-6 text-center text-xs text-white/30">
                        Empty
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void addFiles(category.hint, category.id)}
                    className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[12px] border border-white/[0.07] bg-white/[0.025] text-xs font-medium text-white/55 hover:bg-white/[0.055] disabled:cursor-wait disabled:opacity-50"
                  >
                    {busy === category.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Add
                  </button>
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
  return (
    <div className={cn(
      'rounded-[12px] border border-white/[0.045] bg-white/[0.018] px-3 py-2.5',
      file.status !== 'available' && 'opacity-55',
    )}>
      <p className="truncate text-xs font-medium text-white/74">{file.label}</p>
      <p className="mt-1 truncate text-[10px] uppercase tracking-[0.12em] text-white/28">{file.kind}</p>
    </div>
  )
}
