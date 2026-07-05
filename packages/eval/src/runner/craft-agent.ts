import { setTimeout as delay } from 'node:timers/promises'
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
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

let skillsLinked = false

// .agents/skills 是指向 procurement-skills 的 SYMLINK —— procurement-skills 是唯一真源。
// 为什么要这步:agent 扫 .agents/skills/ 加载 skill、SKILL.md 里命令也写死走
// `.agents/skills/<…>`,但真源在 procurement-skills/,两个路径对不上。软链一次把它们对上:
// 零拷贝、永不过期(改 procurement-skills/ 立即生效,不会像拷贝那样漂移),而且全部 skill +
// 它们共享的工具(scrape-engine —— 平台/替代/差异 skill 调的 CLI 引擎)自动在位,跟生产一致。
// agent 的 skill 扫描只认 SKILL.md,非 skill 文件(AGENTS.md/knowledge-base/scrape-engine)
// 自动跳过。(生产那边 deploy 是 rsync 到远程机、不能软链;eval 本地可以。)skillSlugs 不再
// 决定文件,只喂 `[skill:X]` 提示。整进程做一次。
// eval 沙箱边界:可写业务系统的技能不进 eval workspace。
// runner 默认 allow-all + 真凭据,一个跑飞的 case 不允许有"写飞书表/发单据/批量写回"
// 这些武器可拿——回归池全是只读查询,摘掉写入型技能零损失。
const WRITE_CAPABLE_SKILLS = new Set([
  'procurement-feishu-table-fill',   // 写飞书表
  'procurement-doc-export',          // 生成单据 + 发消息
  'procurement-batch-orchestration', // 批量写回
])

function ensureProjectSkills(skillSlugs: string[] | undefined): void {
  if (!skillSlugs?.length || skillsLinked) return

  const sourceTree = join(REPO_ROOT, 'procurement-skills')
  const linkPath = join(REPO_ROOT, '.agents', 'skills')
  if (!existsSync(sourceTree)) return

  // 逐技能软链(排除写入型),非技能共享文件(AGENTS.md/knowledge-base 等)照链——
  // 真源仍是 procurement-skills/,改动即时生效,与整树软链同样零拷贝。
  rmSync(linkPath, { recursive: true, force: true }) // 去掉旧拷贝目录或旧软链
  mkdirSync(linkPath, { recursive: true })
  for (const entry of readdirSync(sourceTree)) {
    if (WRITE_CAPABLE_SKILLS.has(entry)) continue
    symlinkSync(join(sourceTree, entry), join(linkPath, entry))
  }
  skillsLinked = true
}

export interface CraftAgentRunnerOptions {
  workspaceId: string
  permissionMode: PermissionMode
  timeoutMs: number
  /** 串行跑时给每个 case 的 turn span 打 eval.case.* 标签(进程级 env,并发不安全)。 */
  tagTurnSpans?: boolean
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
  ensureProjectSkills(input.skillSlugs)

  // 串行跑时给每个 case 的 turn span 打标签(进程级 env,并发会互相踩)。
  // 并发跑靠 run 输出的 sessionId ↔ span 的 session.id 属性互相定位。
  if (options.tagTurnSpans) {
    process.env.CRAFT_OTEL_EXTRA_ATTRS = JSON.stringify({
      'eval.case.id': input.id,
      'eval.case.name': input.name,
    })
  } else {
    delete process.env.CRAFT_OTEL_EXTRA_ATTRS
  }

  // 无人值守:掐掉 ask_user 这类交互工具(经 spawn 链传给子进程)。
  // 否则 agent 以提问收尾,回合挂在 auth_request 上,finalAnswer 永远为空。
  process.env.CRAFT_HEADLESS_NO_INTERACTIVE_TOOLS = '1'

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
