/**
 * 幂等创建「测试专用 workspace」(craft-eval),供 eval real runner 用。
 *
 * 为什么要它:real runner 会真开一个 agent session,session 必须挂在 workspace 上
 * (决定用哪个 LLM 连接/模型、权限模式、工作目录)。eval 不该借用个人 workspace——
 * 要隔离、可复现。本脚本在当前 CONFIG_DIR(CRAFT_CONFIG_DIR || ~/.craft-agent)里:
 *   - 复用现有 defaultLlmConnection(本地 chatgpt-plus / 服务器 DeepSeek,自动跟随,不写死)
 *   - permissionMode=allow-all(headless 不卡权限确认)
 *   - 注册进顶层 config.json 的 workspaces[](createSession 按 id/name 解析)
 *
 * 跑:bun run src/scripts/ensure-eval-workspace.ts
 * 产出:打印 workspace id,直接喂给 `bun run eval --workspace <id>`。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const EVAL_ID = 'craft-eval'
const EVAL_NAME = 'Craft Eval'

const CONFIG_DIR = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const WS_DIR = join(CONFIG_DIR, 'workspaces', EVAL_ID)
const WS_CONFIG_PATH = join(WS_DIR, 'config.json')

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main(): void {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`未找到 ${CONFIG_PATH} —— 先用桌面端/webui 初始化一个 workspace 和 LLM 连接`)
  }
  const config = readJson(CONFIG_PATH)
  const connection: string | undefined =
    config.defaultLlmConnection ?? config.llmConnections?.[0]?.slug
  if (!connection) {
    throw new Error('config.json 里没有任何 LLM 连接,先在桌面端配一个(本地)或用服务器的 DeepSeek')
  }
  const connObj = (config.llmConnections ?? []).find((c: any) => c.slug === connection)
  const model: string | undefined = connObj?.defaultModel ?? connObj?.models?.[0]?.id

  const now = Date.now()

  // 1) 写 workspace 自身 config(模型/连接/权限隔离)
  mkdirSync(WS_DIR, { recursive: true })
  const wsConfig = {
    id: EVAL_ID,
    name: EVAL_NAME,
    slug: EVAL_ID,
    defaults: {
      ...(model ? { model } : {}),
      defaultLlmConnection: connection,
      // 开高推理:DeepSeek 是推理模型,thinkingLevel 决定它出不出 reasoning_content。
      // 不开则 trace 里没有"思考"那层(只有工具+答案)。
      thinkingLevel: 'high',
      permissionMode: 'allow-all',
      cyclablePermissionModes: ['allow-all'],
      enabledSourceSlugs: [],
    },
    localMcpServers: { enabled: true },
    createdAt: now,
    updatedAt: now,
  }
  writeFileSync(WS_CONFIG_PATH, JSON.stringify(wsConfig, null, 2) + '\n')

  // 2) 注册进顶层 config.json(幂等:已存在则只更新 rootPath/name)
  config.workspaces = Array.isArray(config.workspaces) ? config.workspaces : []
  const existing = config.workspaces.find((w: any) => w.id === EVAL_ID)
  const entry = {
    rootPath: `~/.craft-agent/workspaces/${EVAL_ID}`,
    name: EVAL_NAME,
    slug: EVAL_ID,
    id: EVAL_ID,
    createdAt: existing?.createdAt ?? now,
  }
  if (existing) Object.assign(existing, entry)
  else config.workspaces.push(entry)
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')

  console.log(JSON.stringify({
    workspaceId: EVAL_ID,
    connection,
    model: model ?? '(workspace default)',
    configDir: CONFIG_DIR,
  }, null, 2))
  console.error(`\n✅ 测试 workspace 就绪。跑:\n  cd packages/eval && bun run eval --workspace ${EVAL_ID} --cases cases/procurement-substitutes.yaml --filter erzv05d331 --limit 1\n`)
}

main()
