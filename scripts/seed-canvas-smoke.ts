import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getActiveWorkspace, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { OutputService } from '@craft-agent/server-core/outputs'
import type { CreateOutputToolInput } from '@craft-agent/session-tools-core'

interface CliOptions {
  workspace?: string
  workspaceRoot?: string
  sessionId?: string
  agentSlug?: string
}

interface SmokeArtifact {
  filename: string
  body: string | Buffer
  output: Omit<CreateOutputToolInput, 'files' | 'showInCanvas'> & {
    fileLabel?: string
    fileRole?: 'primary' | 'supporting' | 'source' | 'thumbnail' | 'attachment'
  }
}

const args = parseArgs(process.argv.slice(2))

args.workspace ??= process.env.RUNNEROS_CANVAS_SMOKE_WORKSPACE
args.workspaceRoot ??= process.env.RUNNEROS_CANVAS_SMOKE_WORKSPACE_ROOT
args.sessionId ??= process.env.RUNNEROS_CANVAS_SMOKE_SESSION
args.agentSlug ??= process.env.RUNNEROS_CANVAS_SMOKE_AGENT

if (!args.sessionId) {
  fail('Missing --session <session-id>. Open or pick a Runner session and pass its id.')
}

const workspace = resolveWorkspace(args)
const workspaceRoot = workspace.rootPath
const workspaceId = workspace.id
const sessionId = args.sessionId
const smokeDir = join(workspaceRoot, '.runneros-canvas-smoke', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(smokeDir, { recursive: true })

const service = new OutputService({
  getWorkspaceRootPath: (id) => {
    if (id !== workspaceId) throw new Error(`Unknown workspace id: ${id}`)
    return workspaceRoot
  },
})

const artifacts = createArtifacts()
const results: Array<{ title: string; outputId?: string; path: string; shownInCanvas?: boolean; receipt?: string }> = []

for (const artifact of artifacts) {
  const filePath = join(smokeDir, artifact.filename)
  writeFileSync(filePath, artifact.body)
  const result = await service.createFromSessionTool({
    workspaceId,
    sessionId,
    agentSlug: args.agentSlug ?? 'canvas-smoke',
    agentName: 'Canvas Smoke Seeder',
    output: {
      ...artifact.output,
      files: [{
        path: filePath,
        label: artifact.output.fileLabel ?? artifact.filename,
        role: artifact.output.fileRole ?? 'primary',
      }],
      showInCanvas: true,
    },
  })
  results.push({
    title: artifact.output.title,
    outputId: result.outputId,
    path: filePath,
    shownInCanvas: result.shownInCanvas,
    receipt: result.canvasReceipt,
  })
}

console.log(JSON.stringify({
  ok: true,
  workspaceId,
  workspaceRoot,
  sessionId,
  smokeDir,
  outputs: results,
}, null, 2))

function parseArgs(raw: string[]): CliOptions {
  const parsed: CliOptions = {}
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i]
    const next = raw[i + 1]
    if (arg === '--workspace' || arg === '-w') {
      parsed.workspace = requireValue(arg, next)
      i += 1
    } else if (arg === '--workspace-root') {
      parsed.workspaceRoot = requireValue(arg, next)
      i += 1
    } else if (arg === '--session' || arg === '--session-id' || arg === '-s') {
      parsed.sessionId = requireValue(arg, next)
      i += 1
    } else if (arg === '--agent-slug') {
      parsed.agentSlug = requireValue(arg, next)
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      fail(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`)
  return value
}

function resolveWorkspace(options: CliOptions): { id: string; rootPath: string } {
  if (options.workspaceRoot) {
    return {
      id: options.workspace ?? 'canvas-smoke-workspace',
      rootPath: resolve(options.workspaceRoot),
    }
  }

  const workspace = options.workspace
    ? getWorkspaceByNameOrId(options.workspace)
    : getActiveWorkspace()
  if (!workspace) fail(`Workspace not found${options.workspace ? `: ${options.workspace}` : ''}`)
  if (workspace.remoteServer) fail('Canvas smoke seeding only supports local workspaces.')
  return { id: workspace.id, rootPath: workspace.rootPath }
}

function createArtifacts(): SmokeArtifact[] {
  return [
    {
      filename: 'canvas-html-smoke-test.html',
      body: '<!doctype html><html><head><meta charset="utf-8"><title>Canvas HTML Smoke Test</title><style>body{margin:0;background:#05070d;color:white;font-family:system-ui;display:grid;place-items:center;min-height:100vh}.card{border:1px solid #2563eb;border-radius:12px;padding:32px;background:#0b1020}button{background:#2563eb;color:white;border:0;border-radius:8px;padding:10px 16px;font-weight:700}</style></head><body><div class="card"><h1 id="title">Canvas HTML Smoke Test</h1><button onclick="document.getElementById(\'title\').textContent=\'Canvas HTML Click Passed\'">Click smoke</button></div></body></html>',
      output: {
        title: 'Canvas HTML Smoke Test',
        kind: 'code',
        summary: 'Generated HTML preview with one clickable smoke button.',
      },
    },
    {
      filename: 'canvas-markdown-smoke-test.md',
      body: [
        '# Canvas Markdown Smoke Test',
        '',
        '- [x] Markdown file exists',
        '- [x] Output is pinned',
        '- [x] Canvas renders markdown',
        '',
        '```json',
        JSON.stringify({ status: 'ready', items: 3 }, null, 2),
        '```',
        '',
      ].join('\n'),
      output: {
        title: 'Canvas Markdown Smoke Test',
        kind: 'document',
        summary: 'Markdown smoke test with checked checklist and JSON block.',
      },
    },
    {
      filename: 'canvas-chart-smoke-test.chart.json',
      body: JSON.stringify({
        type: 'bar',
        title: 'Canvas Chart Smoke Test',
        xLabel: 'Month',
        yLabel: 'Revenue',
        data: [
          { label: 'Jan', value: 12 },
          { label: 'Feb', value: 19 },
          { label: 'Mar', value: 27 },
        ],
      }, null, 2),
      output: {
        title: 'Canvas Chart Smoke Test',
        kind: 'dataset',
        summary: 'Bar chart smoke test for Canvas.',
      },
    },
    {
      filename: 'canvas-workflow-smoke-test.workflow.json',
      body: JSON.stringify({
        title: 'Canvas Workflow Smoke Test',
        state: '3 steps',
        nodes: [
          { id: 'brief', label: 'Brief', agent: 'planner', state: 'succeeded' },
          { id: 'draft', label: 'Draft', agent: 'maker', state: 'running' },
          { id: 'review', label: 'Review', agent: 'reviewer', state: 'queued' },
        ],
      }, null, 2),
      output: {
        title: 'Canvas Workflow Smoke Test',
        kind: 'other',
        summary: 'Workflow graph smoke test for Canvas.',
      },
    },
    {
      filename: 'canvas-table-smoke-test.csv',
      body: 'Month,Revenue\nJan,12\nFeb,19\nMar,27\nApr,33\n',
      output: {
        title: 'Canvas Table Smoke Test',
        kind: 'dataset',
        summary: 'CSV table smoke test with four data rows.',
      },
    },
    {
      filename: 'canvas-image-smoke-test.svg',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#05070d"/><rect x="170" y="145" width="620" height="250" rx="20" fill="#101827" stroke="#38bdf8" stroke-width="5"/><text x="480" y="290" text-anchor="middle" fill="#f8fafc" font-family="Inter,Arial,sans-serif" font-size="54" font-weight="700">Canvas Image Smoke</text></svg>',
      output: {
        title: 'Canvas Image Smoke Test',
        kind: 'image',
        summary: 'SVG image smoke test for Canvas.',
      },
    },
    {
      filename: 'canvas-excalidraw-smoke-test.excalidraw',
      body: JSON.stringify(excalidrawScene(), null, 2),
      output: {
        title: 'Canvas Excalidraw Smoke Test',
        kind: 'image',
        summary: 'Excalidraw JSON smoke test for Canvas.',
      },
    },
    {
      filename: 'canvas-pdf-smoke-test.pdf',
      body: minimalPdf(),
      output: {
        title: 'Canvas PDF Smoke Test',
        kind: 'document',
        summary: 'PDF smoke test for Canvas.',
      },
    },
  ]
}

function excalidrawScene(): Record<string, unknown> {
  const base = {
    version: 141,
    versionNonce: 1,
    isDeleted: false,
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 1,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  }
  return {
    type: 'excalidraw',
    version: 2,
    source: 'runneros-canvas-smoke',
    elements: [
      { ...base, id: randomUUID(), type: 'rectangle', x: 80, y: 80, width: 170, height: 72, angle: 0, strokeColor: '#1971c2', backgroundColor: '#d0ebff' },
      { ...base, id: randomUUID(), type: 'text', x: 125, y: 105, width: 80, height: 25, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', text: 'Brief', fontSize: 24, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', baseline: 20, containerId: null, originalText: 'Brief', lineHeight: 1.25 },
      { ...base, id: randomUUID(), type: 'rectangle', x: 385, y: 80, width: 170, height: 72, angle: 0, strokeColor: '#2f9e44', backgroundColor: '#d3f9d8' },
      { ...base, id: randomUUID(), type: 'text', x: 430, y: 105, width: 70, height: 25, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', text: 'Draft', fontSize: 24, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', baseline: 20, containerId: null, originalText: 'Draft', lineHeight: 1.25 },
      { ...base, id: randomUUID(), type: 'rectangle', x: 690, y: 80, width: 170, height: 72, angle: 0, strokeColor: '#9c36b5', backgroundColor: '#f3d9fa' },
      { ...base, id: randomUUID(), type: 'text', x: 728, y: 105, width: 85, height: 25, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', text: 'Review', fontSize: 24, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', baseline: 20, containerId: null, originalText: 'Review', lineHeight: 1.25 },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }
}

function minimalPdf(): Buffer {
  const stream = 'BT /F1 24 Tf 72 700 Td (Canvas PDF Smoke Test) Tj /F1 12 Tf 0 -36 Td (PDF preview rendered in Canvas.) Tj ET'
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body))
    body += `${object}\n`
  }
  const xrefOffset = Buffer.byteLength(body)
  body += [
    'xref',
    '0 6',
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    `trailer << /Root 1 0 R /Size 6 >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n')
  return Buffer.from(body)
}

function printHelp(): void {
  console.log([
    'Usage: bun run canvas:smoke:seed -- --session <session-id> [--workspace <name-or-id>]',
    '',
    'Options:',
    '  --session, -s          Existing Runner session id to attach outputs to.',
    '  --workspace, -w        Workspace name or id. Defaults to active workspace.',
    '  --workspace-root       Local workspace root for isolated/manual testing.',
    '  --agent-slug           Origin agent slug to stamp on outputs.',
    '',
    'Env fallbacks:',
    '  RUNNEROS_CANVAS_SMOKE_SESSION, RUNNEROS_CANVAS_SMOKE_WORKSPACE,',
    '  RUNNEROS_CANVAS_SMOKE_WORKSPACE_ROOT, RUNNEROS_CANVAS_SMOKE_AGENT',
  ].join('\n'))
}

function fail(message: string): never {
  console.error(`Canvas smoke seed failed: ${message}`)
  printHelp()
  process.exit(1)
}
