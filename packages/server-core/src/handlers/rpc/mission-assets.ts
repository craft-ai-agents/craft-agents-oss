import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  getMissionAssetsRoot,
  ensureMissionAssetsFolders,
  importMissionAssets,
  loadMissionAssetManifest,
  missionAssetContextMetadata,
  missionAssetContextSlug,
  planMissionAssetImports,
  serializeMissionAssetContext,
  type MissionAssetImportCandidate,
  type MissionAssetImportOptions,
  type MissionAssetImportResult,
  type MissionAssetKindHint,
  type MissionAssetManifest,
} from '@craft-agent/shared/mission-assets'
import {
  loadAllContextDocs,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  requestClientOpenFileDialog,
  requestClientOpenPath,
} from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.missionAssets.GET,
  RPC_CHANNELS.missionAssets.PLAN_IMPORT,
  RPC_CHANNELS.missionAssets.CHOOSE_FILES,
  RPC_CHANNELS.missionAssets.IMPORT,
  RPC_CHANNELS.missionAssets.OPEN_FOLDER,
] as const

const workspaceMutexes = new Map<string, Promise<void>>()

function withWorkspaceMutex<T>(workspaceRootPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = workspaceMutexes.get(workspaceRootPath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  workspaceMutexes.set(workspaceRootPath, next.then(() => {}, () => {}))
  return next
}

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function broadcastContextChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

function mirrorManifestToContext(workspaceRootPath: string, workspaceId: string, manifest: MissionAssetManifest, deps: HandlerDeps): void {
  upsertContextDoc(workspaceRootPath, {
    slug: missionAssetContextSlug(),
    metadata: missionAssetContextMetadata(),
    body: serializeMissionAssetContext(manifest),
  })
  broadcastContextChanged(deps, workspaceId, loadAllContextDocs(workspaceRootPath))
}

export function registerMissionAssetsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.missionAssets.GET, async (_ctx, workspaceId: string): Promise<MissionAssetManifest> => {
    const rootPath = resolveRootPath(workspaceId)
    return loadMissionAssetManifest(rootPath, workspaceId)
  })

  server.handle(
    RPC_CHANNELS.missionAssets.PLAN_IMPORT,
    async (_ctx, workspaceId: string, filePaths: string[], options?: MissionAssetImportOptions): Promise<{
      candidates: MissionAssetImportCandidate[]
      skipped: Array<{ path: string; reason: string }>
    }> => {
      const rootPath = resolveRootPath(workspaceId)
      return planMissionAssetImports(rootPath, filePaths, options ?? {})
    },
  )

  server.handle(
    RPC_CHANNELS.missionAssets.CHOOSE_FILES,
    async (ctx, workspaceId: string, kindHint: MissionAssetKindHint = 'any'): Promise<string[]> => {
      resolveRootPath(workspaceId)
      const result = await requestClientOpenFileDialog(server, ctx.clientId, {
        title: dialogTitle(kindHint),
        properties: ['openFile', 'multiSelections'],
        filters: dialogFilters(kindHint),
      })
      return result.canceled ? [] : result.filePaths
    },
  )

  server.handle(
    RPC_CHANNELS.missionAssets.IMPORT,
    async (_ctx, workspaceId: string, filePaths: string[], options?: MissionAssetImportOptions): Promise<MissionAssetImportResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceMutex(rootPath, async () => {
        const result = importMissionAssets(rootPath, workspaceId, filePaths, options ?? {})
        mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
        return result
      })
    },
  )

  server.handle(RPC_CHANNELS.missionAssets.OPEN_FOLDER, async (ctx, workspaceId: string): Promise<boolean> => {
    const rootPath = resolveRootPath(workspaceId)
    const assetsRoot = getMissionAssetsRoot(rootPath)
    ensureMissionAssetsFolders(rootPath)
    const result = await requestClientOpenPath(server, ctx.clientId, assetsRoot)
    return !result.error
  })
}

function dialogTitle(kindHint: MissionAssetKindHint): string {
  if (kindHint === 'master') return 'Add Master'
  if (kindHint === 'lyrics') return 'Add Lyrics'
  if (kindHint === 'cover-art') return 'Add Cover Art'
  return 'Add Mission Assets'
}

function dialogFilters(kindHint: MissionAssetKindHint): Array<{ name: string; extensions: string[] }> {
  if (kindHint === 'master') {
    return [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a'] }]
  }
  if (kindHint === 'lyrics') {
    return [{ name: 'Lyrics/Documents', extensions: ['txt', 'md', 'docx', 'pdf', 'rtf'] }]
  }
  if (kindHint === 'cover-art') {
    return [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'psd', 'ai', 'tif', 'tiff'] }]
  }
  return [
    { name: 'Mission Assets', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a', 'mov', 'mp4', 'm4v', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'psd', 'ai', 'txt', 'md', 'docx', 'pdf', 'rtf'] },
    { name: 'All Files', extensions: ['*'] },
  ]
}
