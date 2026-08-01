import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

export type ComfyWorkflowKind = 'image' | 'video' | 'audio' | 'unknown'
export type ComfyParameterKind = 'text' | 'number' | 'seed' | 'image' | 'model' | 'select'

export interface ComfyWorkflowParameter {
  id: string
  nodeId: string
  input: string
  label: string
  kind: ComfyParameterKind
  value: string | number
  options?: Array<string | number>
}

export interface ComfyWorkflowDefinition {
  id: string
  name: string
  path: string
  kind: ComfyWorkflowKind
  nodeClasses: string[]
  parameters: ComfyWorkflowParameter[]
  workflow: Record<string, ComfyWorkflowNode>
}

export interface ComfyWorkflowNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export class ComfyWorkflowError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message)
    this.name = 'ComfyWorkflowError'
  }
}

const SECRET_INPUTS = new Set(['api_key', 'token', 'password', 'secret'])
const TEXT_INPUTS = new Set(['prompt', 'positive', 'negative', 'negative_prompt', 'text'])
const NUMBER_INPUTS = new Set(['steps', 'cfg', 'width', 'height', 'duration', 'frame_rate', 'fps', 'num_frames', 'batch_size', 'denoise'])
const SELECT_INPUTS = new Set(['quality', 'aspect_ratio', 'mode', 'sampler_name', 'scheduler', 'format', 'codec'])
const IMAGE_INPUTS = new Set(['image', 'start_image', 'end_image'])
const MODEL_INPUTS = new Set(['ckpt_name', 'model_name', 'unet_name', 'vae_name', 'clip_name'])

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isNode(value: unknown): value is ComfyWorkflowNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  return typeof node.class_type === 'string' && !!node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs)
}

function unwrapWorkflow(value: unknown, path?: string): Record<string, ComfyWorkflowNode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ComfyWorkflowError('Workflow JSON must contain an object', path)
  }
  const object = value as Record<string, unknown>
  if (Array.isArray(object.nodes)) {
    throw new ComfyWorkflowError('Editor-format workflow detected; export it in API format before using it in Media Lab', path)
  }
  const candidate = object.prompt && typeof object.prompt === 'object' && !Array.isArray(object.prompt)
    ? object.prompt as Record<string, unknown>
    : object
  const entries = Object.entries(candidate)
  if (entries.length === 0 || entries.some(([, node]) => !isNode(node))) {
    throw new ComfyWorkflowError('Workflow is not valid ComfyUI API-format JSON', path)
  }
  return Object.fromEntries(entries) as Record<string, ComfyWorkflowNode>
}

function classify(nodeClasses: string[]): ComfyWorkflowKind {
  if (nodeClasses.some((name) => /video|movie|savevideo/i.test(name))) return 'video'
  if (nodeClasses.some((name) => /audio|music|saveaudio/i.test(name))) return 'audio'
  if (nodeClasses.some((name) => /image|ksampler|saveimage/i.test(name))) return 'image'
  return 'unknown'
}

function parameterKind(input: string, value: unknown): ComfyParameterKind | null {
  if (SECRET_INPUTS.has(input.toLowerCase())) return null
  if (input === 'seed' && typeof value === 'number') return 'seed'
  if (TEXT_INPUTS.has(input) && typeof value === 'string') return 'text'
  if (NUMBER_INPUTS.has(input) && typeof value === 'number') return 'number'
  if (SELECT_INPUTS.has(input) && (typeof value === 'string' || typeof value === 'number')) return 'select'
  if (MODEL_INPUTS.has(input) && typeof value === 'string') return 'model'
  if (IMAGE_INPUTS.has(input) && typeof value === 'string') return 'image'
  return null
}

export function parseComfyWorkflow(value: unknown, options: { path: string; id?: string; name?: string }): ComfyWorkflowDefinition {
  const workflow = unwrapWorkflow(value, options.path)
  const nodeClasses = [...new Set(Object.values(workflow).map((node) => node.class_type))]
  const parameters: ComfyWorkflowParameter[] = []
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      const kind = parameterKind(input, value)
      if (!kind || (typeof value !== 'string' && typeof value !== 'number')) continue
      parameters.push({
        id: `${nodeId}.${input}`,
        nodeId,
        input,
        label: humanize(input),
        kind,
        value,
      })
    }
  }
  const filename = options.path.split(/[\\/]/).pop() ?? options.path
  const basename = filename.replace(/\.json$/i, '')
  return {
    id: options.id ?? basename,
    name: options.name ?? humanize(basename),
    path: options.path,
    kind: classify(nodeClasses),
    nodeClasses,
    parameters,
    workflow,
  }
}

export function namespaceWorkflowOutputs(
  workflow: Record<string, ComfyWorkflowNode>,
  kind: ComfyWorkflowKind,
): Record<string, ComfyWorkflowNode> {
  const next = structuredClone(workflow)
  const folder = kind === 'video' ? 'videos' : kind === 'audio' ? 'audio' : 'images'
  for (const node of Object.values(next)) {
    if (!/^Save(Image|Video|Audio)$/i.test(node.class_type)) continue
    const current = typeof node.inputs.filename_prefix === 'string'
      ? node.inputs.filename_prefix.split(/[\\/]/).filter(Boolean).pop()
      : undefined
    node.inputs.filename_prefix = `ARCHstudio/${folder}/${current || 'generation'}`
  }
  return next
}

export function applyWorkflowParameters(
  definition: ComfyWorkflowDefinition,
  values: Record<string, string | number>,
): Record<string, ComfyWorkflowNode> {
  const workflow = structuredClone(definition.workflow)
  const known = new Map(definition.parameters.map((parameter) => [parameter.id, parameter]))
  for (const [id, value] of Object.entries(values)) {
    const parameter = known.get(id)
    if (!parameter) throw new ComfyWorkflowError(`Unknown workflow parameter: ${id}`, definition.path)
    const node = workflow[parameter.nodeId]
    if (!node) throw new ComfyWorkflowError(`Workflow node no longer exists: ${parameter.nodeId}`, definition.path)
    node.inputs[parameter.input] = value
  }
  return workflow
}

export async function discoverComfyWorkflows(rootPath: string): Promise<{
  workflows: ComfyWorkflowDefinition[]
  rejected: Array<{ path: string; error: string }>
}> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') files.push(path)
    }
  }
  await walk(rootPath)
  files.sort((a, b) => a.localeCompare(b))

  const workflows: ComfyWorkflowDefinition[] = []
  const rejected: Array<{ path: string; error: string }> = []
  for (const path of files) {
    try {
      const json = JSON.parse(await readFile(path, 'utf8')) as unknown
      const relativePath = relative(rootPath, path).replace(/\\/g, '/')
      workflows.push(parseComfyWorkflow(json, {
        path,
        id: relativePath.replace(/\.json$/i, ''),
      }))
    } catch (error) {
      rejected.push({ path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { workflows, rejected }
}
