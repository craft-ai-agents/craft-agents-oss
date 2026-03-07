import { appendFile, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

// History file name — matches AUTOMATIONS_HISTORY_FILE from @craft-agent/shared/automations/constants
const HISTORY_FILE = 'automations-history.jsonl'
interface HistoryEntry { id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string }

// Per-workspace config mutex: serializes read-modify-write cycles on automations.json
// to prevent concurrent IPC calls from clobbering each other's changes.
const configMutexes = new Map<string, Promise<void>>()
function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run fn regardless of previous result
  configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
  return next
}

// Shared helper: resolve workspace, read automations.json, validate matcher, mutate, write back
interface AutomationsConfigJson { automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
async function withAutomationMatcher(workspaceId: string, eventName: string, matcherIndex: number, mutate: (matchers: Record<string, unknown>[], index: number, config: AutomationsConfigJson, genId: () => string) => void) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('Workspace not found')

  await withConfigMutex(workspace.rootPath, async () => {
    const { resolveAutomationsConfigPath, generateShortId } = await import('@craft-agent/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)

    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)

    const eventMap = config.automations ?? {}
    const matchers = eventMap[eventName]
    if (!Array.isArray(matchers) || matcherIndex < 0 || matcherIndex >= matchers.length) {
      throw new Error(`Invalid automation reference: ${eventName}[${matcherIndex}]`)
    }

    mutate(matchers, matcherIndex, config, generateShortId)

    // Backfill missing IDs on all matchers before writing
    for (const eventMatchers of Object.values(eventMap)) {
      if (!Array.isArray(eventMatchers)) continue
      for (const m of eventMatchers as Record<string, unknown>[]) {
        if (!m.id) m.id = generateShortId()
      }
    }

    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  })
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.automations.TEST,
  RPC_CHANNELS.automations.SET_ENABLED,
  RPC_CHANNELS.automations.DUPLICATE,
  RPC_CHANNELS.automations.DELETE,
  RPC_CHANNELS.automations.GET_HISTORY,
  RPC_CHANNELS.automations.GET_LAST_EXECUTED,
] as const

export function registerAutomationsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.automations.TEST, async (_ctx, payload: import('@craft-agent/shared/protocol').TestAutomationPayload) => {
    const workspace = getWorkspaceByNameOrId(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const results: import('@craft-agent/shared/protocol').TestAutomationActionResult[] = []
    const { parsePromptReferences } = await import('@craft-agent/shared/automations')

    for (const action of payload.actions) {
      const start = Date.now()

      // Parse @mentions from the prompt to resolve source/skill references
      const references = parsePromptReferences(action.prompt)

      try {
        const { sessionId } = await deps.sessionManager.executePromptAutomation(
          payload.workspaceId,
          workspace.rootPath,
          action.prompt,
          payload.labels,
          payload.permissionMode,
          references.mentions,
          action.llmConnection,
          action.model,
          payload.automationName,
        )
        results.push({
          type: 'prompt',
          success: true,
          sessionId,
          duration: Date.now() - start,
        })

        // Write history entry for test runs
        if (payload.automationId) {
          const entry = { id: payload.automationId, ts: Date.now(), ok: true, sessionId, prompt: action.prompt.slice(0, 200) }
          appendFile(join(workspace.rootPath, HISTORY_FILE), JSON.stringify(entry) + '\n', 'utf-8').catch(e => log.warn('[Automations] Failed to write history:', e))
        }
      } catch (err: unknown) {
        results.push({
          type: 'prompt',
          success: false,
          stderr: (err as Error).message,
          duration: Date.now() - start,
        })

        // Write failed history entry
        if (payload.automationId) {
          const entry = { id: payload.automationId, ts: Date.now(), ok: false, error: ((err as Error).message ?? '').slice(0, 200), prompt: action.prompt.slice(0, 200) }
          appendFile(join(workspace.rootPath, HISTORY_FILE), JSON.stringify(entry) + '\n', 'utf-8').catch(e => log.warn('[Automations] Failed to write history:', e))
        }
      }
    }

    return { actions: results } satisfies import('@craft-agent/shared/protocol').TestAutomationResult
  })

  // Automation enabled state management (toggle enabled/disabled in automations.json)
  server.handle(RPC_CHANNELS.automations.SET_ENABLED, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx) => {
      if (enabled) {
        delete matchers[idx].enabled
      } else {
        matchers[idx].enabled = false
      }
    })
  })

  // Duplicate an automation matcher
  server.handle(RPC_CHANNELS.automations.DUPLICATE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, _config, genId) => {
      const clone = JSON.parse(JSON.stringify(matchers[idx]))
      clone.id = genId()
      clone.name = clone.name ? `${clone.name} Copy` : 'Untitled Copy'
      matchers.splice(idx + 1, 0, clone)
    })
  })

  // Delete an automation matcher
  server.handle(RPC_CHANNELS.automations.DELETE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config) => {
      matchers.splice(idx, 1)
      if (matchers.length === 0) {
        const eventMap = config.automations
        if (eventMap) delete eventMap[eventName]
      }
    })
  })

  // Read execution history for a specific automation
  server.handle(RPC_CHANNELS.automations.GET_HISTORY, async (_ctx, workspaceId: string, automationId: string, limit = 20) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      return lines
        .map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter((e): e is HistoryEntry => e?.id === automationId)
        .slice(-limit)
        .reverse()
    } catch {
      return [] // File doesn't exist yet
    }
  })

  // Return last execution timestamp for all automations
  server.handle(RPC_CHANNELS.automations.GET_LAST_EXECUTED, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const result: Record<string, number> = {}
      for (const line of content.trim().split('\n')) {
        try {
          const entry = JSON.parse(line)
          if (entry.id && entry.ts) result[entry.id] = entry.ts
        } catch { /* skip malformed lines */ }
      }
      return result
    } catch {
      return {}
    }
  })
}
