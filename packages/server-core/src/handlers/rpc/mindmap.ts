/**
 * Mind map RPC:
 * - enrich: one-shot outline improve via SessionManager.runDistillOneShot
 * - pin load/save/clear: workspace-local files under <root>/mindmaps/
 */
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import {
  applyEnrichedOutline,
  buildEnrichPrompt,
  heuristicEnrichOutline,
  loadPinnedMap,
  parseEnrichedOutlineJson,
  pinFilename,
  savePinnedMap,
  type EnrichedOutlineNode,
  type MindMapEntityRef,
  type MindMapGraph,
  type PinnedMap,
} from '@craft-agent/core/mindmap'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.mindmap.ENRICH,
  RPC_CHANNELS.mindmap.PIN_LOAD,
  RPC_CHANNELS.mindmap.PIN_SAVE,
  RPC_CHANNELS.mindmap.PIN_CLEAR,
] as const

const SOURCE_EXCERPT_CAP = 8_000
export const MINDMAP_PIN_DIRNAME = 'mindmaps'

export type MindmapEnrichRequest = {
  workspaceId: string
  entity: MindMapEntityRef
  graph: MindMapGraph
  sourceExcerpt?: string
  heuristicOnly?: boolean
}

export type MindmapEnrichResponse =
  | { ok: true; graph: MindMapGraph; mode: 'llm' | 'heuristic' }
  | { ok: false; error: string; graph: MindMapGraph; mode: 'passthrough' }

export type MindmapPinLoadRequest = { workspaceId: string; entity: MindMapEntityRef }
export type MindmapPinSaveRequest = { workspaceId: string; pin: PinnedMap }
export type MindmapPinClearRequest = { workspaceId: string; entity: MindMapEntityRef }

function resolveMindmapDir(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace?.rootPath) throw new Error(`Workspace not found: ${workspaceId}`)
  return join(resolve(workspace.rootPath), MINDMAP_PIN_DIRNAME)
}

function assertSafePinPath(dir: string, entity: MindMapEntityRef): string {
  const full = resolve(dir, pinFilename(entity))
  const dirResolved = resolve(dir)
  const prefix = dirResolved.endsWith('/') || dirResolved.endsWith('\\') ? dirResolved : dirResolved + '/'
  if (!full.startsWith(prefix) && full !== dirResolved) throw new Error('Invalid mindmap pin path')
  return full
}

export function registerMindmapHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.mindmap.ENRICH, async (_ctx, input: MindmapEnrichRequest): Promise<MindmapEnrichResponse> => {
    const original = input?.graph
    if (!original || typeof original !== 'object' || !original.nodes || !original.rootId) {
      return {
        ok: false,
        error: 'Invalid mindmap enrich request: graph required',
        graph: original ?? ({} as MindMapGraph),
        mode: 'passthrough',
      }
    }

    const applyOutline = (
      outline: EnrichedOutlineNode[],
      mode: 'llm' | 'heuristic',
    ): MindmapEnrichResponse => {
      const { graph } = applyEnrichedOutline({ graph: original, outline })
      return { ok: true, graph, mode }
    }

    const heuristic = (): MindmapEnrichResponse => {
      try {
        return applyOutline(heuristicEnrichOutline(original), 'heuristic')
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          graph: original,
          mode: 'passthrough',
        }
      }
    }

    if (input.heuristicOnly) return heuristic()
    if (!input.workspaceId || typeof input.workspaceId !== 'string') return heuristic()

    try {
      const run = deps.sessionManager?.runDistillOneShot
      if (typeof run !== 'function') return heuristic()

      let prompt = buildEnrichPrompt(original)
      if (typeof input.sourceExcerpt === 'string' && input.sourceExcerpt.trim()) {
        prompt += `\n\nSource excerpt (truncated):\n${input.sourceExcerpt.trim().slice(0, SOURCE_EXCERPT_CAP)}`
      }

      const text = await run.call(deps.sessionManager, input.workspaceId, prompt)
      let outline: EnrichedOutlineNode[]
      try {
        outline = parseEnrichedOutlineJson(typeof text === 'string' ? text : '')
      } catch {
        return heuristic()
      }
      if (!Array.isArray(outline) || outline.length === 0) return heuristic()
      return applyOutline(outline, 'llm')
    } catch (err) {
      deps.platform.logger?.warn?.('mindmap:enrich failed, heuristic fallback', err)
      return heuristic()
    }
  })

  server.handle(RPC_CHANNELS.mindmap.PIN_LOAD, async (_ctx, input: MindmapPinLoadRequest) => {
    if (!input?.workspaceId || !input.entity) return null
    try {
      const dir = resolveMindmapDir(input.workspaceId)
      return await loadPinnedMap(
        {
          async read(path) {
            try {
              return await readFile(path, 'utf-8')
            } catch {
              return null
            }
          },
        },
        dir,
        input.entity,
      )
    } catch (err) {
      deps.platform.logger?.warn?.('mindmap:pinLoad failed', err)
      return null
    }
  })

  server.handle(RPC_CHANNELS.mindmap.PIN_SAVE, async (_ctx, input: MindmapPinSaveRequest) => {
    if (!input?.workspaceId || !input.pin?.entity || !input.pin?.graph) {
      return { ok: false as const, error: 'workspaceId and pin required' }
    }
    try {
      const dir = resolveMindmapDir(input.workspaceId)
      await mkdir(dir, { recursive: true })
      assertSafePinPath(dir, input.pin.entity)
      await savePinnedMap(
        {
          async write(path, data) {
            await writeFile(path, data, 'utf-8')
          },
        },
        dir,
        input.pin,
      )
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.platform.logger?.warn?.('mindmap:pinSave failed', err)
      return { ok: false as const, error: message }
    }
  })

  server.handle(RPC_CHANNELS.mindmap.PIN_CLEAR, async (_ctx, input: MindmapPinClearRequest) => {
    if (!input?.workspaceId || !input.entity) {
      return { ok: false as const, error: 'workspaceId and entity required' }
    }
    try {
      const dir = resolveMindmapDir(input.workspaceId)
      const path = assertSafePinPath(dir, input.entity)
      try {
        await unlink(path)
      } catch {
        /* missing ok */
      }
      return { ok: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.platform.logger?.warn?.('mindmap:pinClear failed', err)
      return { ok: false as const, error: message }
    }
  })
}
