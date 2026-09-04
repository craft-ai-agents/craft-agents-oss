import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const workspaceRoot = 'C:/Users/xiz09/.craft-agent/workspaces/my-workspace'
const fixturePrefix = 'jw14-'
const now = Date.now()

const modules = [
  ['01', '产品调研', '用户洞察', 'jonwork-user-insight', '报告'],
  ['02', '产品调研', '竞品洞察', 'jonwork-competitor-insight', '报告'],
  ['03', '产品调研', '设计提案', 'jonwork-design-proposal', '报告'],
  ['04', '造型工作台', '自定义模式', 'jonwork-custom-fusion', '图片'],
  ['05', '造型工作台', '草图渲染', 'jonwork-sketch-render', '图片'],
  ['06', '造型工作台', '整图编辑', 'jonwork-scene-edit', '图片'],
  ['07', '造型工作台', '造型融合', 'jonwork-form-fusion', '图片'],
  ['08', '造型工作台', '局部改型', 'jonwork-local-remodel', '图片'],
  ['09', '造型工作台', '智能设计解构', 'jonwork-design-decomposition', '报告'],
  ['10', '设计实验室', 'CMF发散', 'jonwork-cmf-divergence', '图片'],
  ['11', '设计实验室', '图片转3D', 'jonwork-image-to-3d', '3D模型'],
  ['12', '设计实验室', 'PI系列化', 'jonwork-pi-series', '图片'],
  ['13', '设计诊断', '方案评估', 'jonwork-design-health-check', '报告'],
  ['14', '设计诊断', '对标诊断', 'jonwork-benchmark-diagnosis', '报告'],
] as const

const sourceSession = join(workspaceRoot, 'sessions', '260828-deep-bloom', 'data', '00-测试输入')
const sourceSketch = join(sourceSession, 'concept-sketch.png')
const sourceRender = join(sourceSession, 'concept-render-reference.png')

function ensure(path: string) {
  mkdirSync(path, { recursive: true })
}

function write(path: string, content: string) {
  ensure(join(path, '..'))
  writeFileSync(path, content, 'utf8')
}

function yamlString(value: string) {
  return JSON.stringify(value)
}

for (const [index, group, menu, skill, outputType] of modules) {
  const slug = `${fixturePrefix}${index}`
  const projectId = `proj_jw14_${index}`
  const projectName = `[验收${index}] ${menu}`
  const taskTitle = `[验收${index}] ${menu}流程验证`
  const sessionId = `260828-jw14-${index}`
  const timestamp = now - (14 - Number(index)) * 60_000
  const projectDir = join(workspaceRoot, 'projects', slug)
  const taskDir = join(workspaceRoot, 'tasks', slug)
  const sessionDir = join(workspaceRoot, 'sessions', sessionId)

  // Idempotent replacement is limited to this script's own stable fixture ids.
  for (const dir of [projectDir, taskDir, sessionDir]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }

  ensure(join(projectDir, 'assets'))
  write(join(projectDir, 'config.json'), JSON.stringify({
    id: projectId,
    slug,
    name: projectName,
    description: `${group} / ${menu}：14 模块独立界面与关联关系验收项目`,
    details: `测试对象：家用电热水壶。绑定 Skill：${skill}。此项目仅用于验证项目、任务、会话、材料和成果在 Craft 界面中的完整闭环。`,
    color: '#7c3aed',
    createdAt: timestamp,
    updatedAt: timestamp,
  }, null, 2))
  write(join(projectDir, 'MEMORY.md'), `# ${projectName}\n\n- 产品：家用电热水壶\n- 市场：中国大陆，中端 100–300 元\n- 目标：验证 ${menu} 的独立业务闭环和界面数据关联。\n- Skill：\`${skill}\`\n`)
  write(join(projectDir, 'assets', '模块测试材料.md'), `# ${menu}测试材料\n\n- 模块分组：${group}\n- 验收菜单：${menu}\n- 目标产物：${outputType}\n- 测试参数：家庭用户、安全、易清洁、轻量握持\n- 数据性质：界面与流程验收数据，不代表最终生产结论。\n`)
  if (existsSync(sourceSketch)) copyFileSync(sourceSketch, join(projectDir, 'assets', '概念草图-测试输入.png'))
  if (existsSync(sourceRender)) copyFileSync(sourceRender, join(projectDir, 'assets', '产品渲染-测试输入.png'))

  ensure(taskDir)
  write(join(taskDir, 'task.yaml'), [
    `id: ${slug}`,
    `title: ${yamlString(taskTitle)}`,
    `goal: ${yamlString(`调用 ${skill} 完成 ${menu} 的需求询问、材料检查、生成、校验和成果展示验证`)}`,
    `acceptance_criteria: ${yamlString('项目、任务、会话关联正确；需求确认单和材料清单存在；右侧成果可见；状态不虚报。')}`,
    `project: ${projectId}`,
    'runner: conduct',
    `skills: [${skill}]`,
    'defaults:',
    '  model: pi/deepseek-v4-pro',
    '  llmConnection: pi-api-key',
    '  permissionMode: allow-all',
    'nodes:',
    '  - id: main',
    `    title: ${yamlString(`${menu}主流程`)}`,
    '    kind: session',
    `    prompt: ${yamlString(`读取项目材料，自动匹配 ${skill}，先询问缺失参数，再生成 ${outputType}并按验收标准校验。`)}`,
    `    labels: [${yamlString('validation::14-modules')}, ${yamlString(`skill::${skill}`)}]`,
    'outputs:',
    '  result: "${nodes.main.output}"',
    '',
  ].join('\n'))

  ensure(join(sessionDir, 'attachments'))
  ensure(join(sessionDir, 'data'))
  ensure(join(sessionDir, 'downloads'))
  ensure(join(sessionDir, 'plans'))

  const header = {
    id: sessionId,
    workspaceRootPath: '~\\.craft-agent\\workspaces\\my-workspace',
    sdkCwd: `~/.craft-agent\\workspaces\\my-workspace\\sessions\\${sessionId}`,
    createdAt: timestamp,
    lastUsedAt: timestamp + 2_000,
    lastMessageAt: timestamp + 2_000,
    name: projectName,
    isFlagged: false,
    labels: ['validation::14-modules', `skill::${skill}`, `group::${group}`],
    hasUnread: false,
    enabledSourceSlugs: [],
    permissionMode: 'allow-all',
    model: 'pi/deepseek-v4-pro',
    llmConnection: 'pi-api-key',
    connectionLocked: true,
    thinkingLevel: 'medium',
    messageCount: 2,
    lastMessageRole: 'assistant',
    preview: `${menu}独立验收会话：项目、任务、材料、需求确认和成果显示数据已经建立。`,
    projectId,
    taskSlug: slug,
    sessionStatus: 'todo',
  }
  const userMessage = {
    id: `msg-${sessionId}-user`,
    content: `请完成“${menu}”模块验收。自动匹配 @${menu}（${skill}），先检查材料并询问缺失参数，再生成${outputType}，最后按验收标准检查。`,
    timestamp: timestamp + 1_000,
    type: 'user',
  }
  const assistantMessage = {
    id: `msg-${sessionId}-assistant`,
    content: `已建立 ${menu} 独立验收闭环：\n\n1. 已关联项目：${projectName}\n2. 已关联任务：${taskTitle}\n3. 已匹配 Skill：${skill}\n4. 已读取测试材料并形成需求确认单\n5. 已写入成果栏可展示的验收文件\n\n当前为“测试数据已准备”状态，不把界面样例冒充真实生产成果。下一步可在本会话继续回答参数并检验 ${outputType} 质量。`,
    timestamp: timestamp + 2_000,
    type: 'assistant',
  }
  write(join(sessionDir, 'session.jsonl'), [header, userMessage, assistantMessage].map((v) => JSON.stringify(v)).join('\n') + '\n')

  write(join(sessionDir, 'data', '需求确认单.md'), `# ${menu}需求确认单\n\n- 项目：${projectName}\n- 任务：${taskTitle}\n- 会话：${sessionId}\n- 自动匹配 Skill：\`${skill}\`\n- 产品：家用电热水壶\n- 输出类型：${outputType}\n- 状态：测试数据已准备，等待在会话中补问和质量实测\n`)
  write(join(sessionDir, 'data', '材料完整性检查.md'), `# 材料完整性检查\n\n| 检查项 | 状态 |\n| --- | --- |\n| 模块测试说明 | 已提供 |\n| 概念草图 | 已提供测试输入 |\n| 产品渲染参考 | 已提供测试输入 |\n| 用户最终参数确认 | 待会话补问 |\n| 生产级证据 | 待真实执行 |\n`)
  write(join(sessionDir, 'data', `${index}-${menu}-界面验收结果.md`), `# ${menu}界面验收结果\n\n这是用于验证 Craft 界面数据关联的真实文件。\n\n- 项目存在并关联：待界面复核\n- 任务存在并关联：待界面复核\n- 会话存在并关联：待界面复核\n- Skill 路由目标：\`${skill}\`\n- 右侧成果文件：本文件、需求确认单、材料完整性检查\n- 业务成果质量：尚未判定，必须在该会话中真实运行后验收\n`)
  write(join(sessionDir, 'data', 'deliverable-brief.md'), `# Deliverable Brief\n\n模块：${group} / ${menu}\n\n目标：验证从自然语言、Skill 匹配、参数补问、材料检查到${outputType}生成与校验的完整链路。\n`)
  write(join(sessionDir, 'data', 'deliverable-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    status: 'draft',
    purpose: 'ui_validation_fixture',
    projectId,
    taskSlug: slug,
    sessionId,
    skillRouting: { status: 'matched', skills: [skill], reason: `菜单 ${menu} 的专属 Skill` },
    requirements: { confirmed: false, missing: ['用户在会话中的最终参数确认'] },
    deliverables: [
      { path: '需求确认单.md', kind: 'brief', version: 1, status: 'draft' },
      { path: '材料完整性检查.md', kind: 'material-check', version: 1, status: 'draft' },
      { path: `${index}-${menu}-界面验收结果.md`, kind: 'validation-report', version: 1, status: 'draft' },
    ],
    validation: { passed: false, checks: ['entity-linkage-pending-ui-check', 'quality-run-pending'] },
    approval: { approved: false },
    updatedAt: new Date(timestamp).toISOString(),
  }, null, 2))
}

console.log(JSON.stringify({
  projects: modules.length,
  tasks: modules.length,
  sessions: modules.length,
  prefix: fixturePrefix,
  workspaceRoot,
}, null, 2))
