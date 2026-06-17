import { setTimeout as delay } from 'node:timers/promises'
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { setImageProcessor, setSearchPlatform } from '@craft-agent/server-core/services'
import { ensureConfigDir } from '@craft-agent/shared/config'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import type { EventSink } from '@craft-agent/server-core/transport'
import type { CraftEvalOutput, EvalTaskInput, ToolEventSummary } from '../types'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

let headlessPlatformReady = false

function ensureHeadlessPlatform(): void {
  if (headlessPlatformReady) return

  process.env.CRAFT_APP_ROOT ??= REPO_ROOT
  process.env.CRAFT_RESOURCES_PATH ??= join(REPO_ROOT, 'resources')
  process.env.CRAFT_IS_PACKAGED ??= 'false'

  const platform = createHeadlessPlatform()
  setSessionPlatform(platform)
  setFetcherPlatform(platform)
  setSearchPlatform(platform)
  setImageProcessor(platform.imageProcessor)
  headlessPlatformReady = true
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function ensureProjectSkillLinks(skillSlugs: string[] | undefined): void {
  if (!skillSlugs?.length) return

  const projectSkillsDir = join(REPO_ROOT, '.agents', 'skills')
  for (const slug of new Set(skillSlugs)) {
    const sourceDir = join(REPO_ROOT, 'procurement-skills', slug)
    const skillFile = join(sourceDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue

    mkdirSync(projectSkillsDir, { recursive: true })
    const linkPath = join(projectSkillsDir, slug)
    if (pathExists(linkPath)) continue
    symlinkSync(sourceDir, linkPath, 'dir')
  }
}

export interface CraftAgentRunnerOptions {
  workspaceId: string
  permissionMode: PermissionMode
  timeoutMs: number
}

function collectToolEvent(event: SessionEvent): ToolEventSummary | null {
  if (event.type === 'tool_start') {
    return {
      type: 'tool_start',
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      input: event.toolInput,
    }
  }
  if (event.type === 'tool_result') {
    return {
      type: 'tool_result',
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      isError: event.isError,
      result: event.result,
    }
  }
  return null
}

function buildMessage(input: EvalTaskInput): string {
  const skillMentions = input.skillSlugs?.length
    ? input.skillSlugs.map((slug) => `[skill:${slug}]`).join(' ')
    : undefined
  return [skillMentions, input.context?.trim(), input.message]
    .filter(Boolean)
    .join('\n\n')
}

function createTimeoutError(timeoutMs: number): Error {
  return new Error(`Eval case timed out after ${timeoutMs}ms`)
}

async function withDeadline<T>(promise: Promise<T>, deadline: number, timeoutMs: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw createTimeoutError(timeoutMs)

  return Promise.race([
    promise,
    delay(remaining).then(() => {
      throw createTimeoutError(timeoutMs)
    }),
  ])
}

async function waitForSessionIdle(
  manager: SessionManager,
  sessionId: string,
  deadline: number,
  timeoutMs: number,
): Promise<void> {
  const idleSettleMs = 1_500
  let idleSince: number | null = null

  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw createTimeoutError(timeoutMs)

    const session = await manager.getSession(sessionId)
    if (!session?.isProcessing) {
      idleSince ??= Date.now()
      if (Date.now() - idleSince >= idleSettleMs) return
    } else {
      idleSince = null
    }

    await delay(Math.min(250, remaining))
  }
}

export async function runCraftAgentCase(
  input: EvalTaskInput,
  options: CraftAgentRunnerOptions,
): Promise<CraftEvalOutput> {
  ensureConfigDir()
  ensureHeadlessPlatform()
  ensureProjectSkillLinks(input.skillSlugs)

  const events: SessionEvent[] = []
  const toolEvents: ToolEventSummary[] = []
  const manager = new SessionManager()
  const sink: EventSink = (_channel, _target, event) => {
    const sessionEvent = event as SessionEvent
    events.push(sessionEvent)
    const toolEvent = collectToolEvent(sessionEvent)
    if (toolEvent) toolEvents.push(toolEvent)
  }
  manager.setEventSink(sink)

  let sessionId: string | null = null
  let userMessageId: string | null = null

  try {
    await manager.initialize()
    const session = await manager.createSession(options.workspaceId, {
      permissionMode: options.permissionMode,
      workingDirectory: REPO_ROOT,
    })
    sessionId = session.id

    const send = manager.sendMessage(
      session.id,
      buildMessage(input),
      undefined,
      undefined,
      {
        skillSlugs: input.skillSlugs,
      },
      undefined,
      undefined,
      (messageId) => {
        userMessageId = messageId
      },
    )

    const deadline = Date.now() + options.timeoutMs
    await withDeadline(send, deadline, options.timeoutMs)
    await waitForSessionIdle(manager, session.id, deadline, options.timeoutMs)

    const refreshed = await manager.getSession(session.id)
    const finalAnswer = refreshed?.messages
      ?.filter((message) => message.role === 'assistant' && !message.isIntermediate)
      .at(-1)
      ?.content ?? ''

    const hasError = events.some((event) => event.type === 'error' || event.type === 'typed_error')
    return {
      finalAnswer,
      sessionId,
      userMessageId,
      outcome: hasError ? 'error' : 'complete',
      toolEvents,
      eventTypes: events.map((event) => event.type),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (sessionId && message.includes('timed out')) {
      await manager.cancelProcessing(sessionId, true).catch(() => {})
    }
    return {
      finalAnswer: '',
      sessionId,
      userMessageId,
      outcome: message.includes('timed out') ? 'timeout' : 'error',
      error: message,
      toolEvents,
      eventTypes: events.map((event) => event.type),
    }
  } finally {
    if (sessionId) {
      await manager.deleteSession(sessionId).catch(() => {})
    }
    manager.cleanup()
  }
}
