import { createHash } from 'crypto'
import { existsSync, statSync } from 'fs'
import { basename, isAbsolute, relative, resolve } from 'path'
import { RPC_CHANNELS, type LabelSkillBindingsGenerateParams, type LabelSkillBindingsGenerateResult, type LabelSkillBindingsSaveInput } from '@craft-agent/shared/protocol'
import { getDefaultLlmConnection, getLlmConnection, getMiniModel, getWorkspaceByNameOrId, type Workspace } from '@craft-agent/shared/config'
import { createBackendFromConnection } from '@craft-agent/shared/agent/backend'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { listLabelsFlat } from '@craft-agent/shared/labels/storage'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { listSkillSummaries, loadSkillBySlug, loadSkillSummaryBySlug, type SkillSummary } from '@craft-agent/shared/skills'
import {
  loadAndValidateLabelSkillBindingsConfig,
  saveLabelSkillBindingsConfig,
  validateLabelSkillBindingsConfig,
  type LabelSkillBindingsConfig,
  type RequiredSourceSnapshotEntry,
} from '@craft-agent/shared/label-skill-bindings'
import { buildBackendHostRuntimeContext } from '../utils'
import type { HandlerDeps } from '../handler-deps'

const AI_GENERATION_TIMEOUT_MS = 30_000
const MAX_SKILL_BODY_CHARS_FOR_GENERATION = 24_000
const MAX_GENERATED_COMPACT_INSTRUCTION_CHARS = 800
const MAX_GENERATED_COMPACT_INSTRUCTION_LINES = 12

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labelSkillBindings.GET,
  RPC_CHANNELS.labelSkillBindings.SAVE,
  RPC_CHANNELS.labelSkillBindings.LIST_BINDABLE_SKILLS,
  RPC_CHANNELS.labelSkillBindings.GENERATE_COMPACT_INSTRUCTION,
] as const

export function registerLabelSkillBindingsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.labelSkillBindings.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const effectiveWorkingDir = resolveWorkspaceWorkingDirectory(workspace.rootPath, workingDirectory)
    const skills = listSkillSummaries(workspace.rootPath, effectiveWorkingDir) as SkillSummary[]
    return loadAndValidateLabelSkillBindingsConfig(workspace.rootPath, {
      labels: listLabelsFlat(workspace.rootPath),
      skills,
      workspaceSlug: workspace.id,
    })
  })

  server.handle(RPC_CHANNELS.labelSkillBindings.LIST_BINDABLE_SKILLS, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const effectiveWorkingDir = resolveWorkspaceWorkingDirectory(workspace.rootPath, workingDirectory)
    return listSkillSummaries(workspace.rootPath, effectiveWorkingDir) as SkillSummary[]
  })

  server.handle(RPC_CHANNELS.labelSkillBindings.SAVE, async (_ctx, workspaceId: string, input: LabelSkillBindingsSaveInput | LabelSkillBindingsConfig, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const config = 'config' in input ? input.config : input
    const effectiveWorkingDir = ('workingDirectory' in input ? input.workingDirectory : workingDirectory)
    const usableWorkingDir = resolveWorkspaceWorkingDirectory(workspace.rootPath, effectiveWorkingDir)
    const skills = listSkillSummaries(workspace.rootPath, usableWorkingDir) as SkillSummary[]
    const context = {
      labels: listLabelsFlat(workspace.rootPath),
      skills,
      workspaceSlug: workspace.id,
    }

    // Validate before enrichment so malformed optional fields (for example an
    // object-valued requiredSourcesSnapshot) cannot throw inside the SAVE RPC or
    // round-trip unknown/path-like fields back to clients.
    const preliminary = validateLabelSkillBindingsConfig(config, context)
    if (!preliminary.valid) {
      const message = preliminary.errors.map(d => d.message).join('; ') || 'Invalid label-skill bindings config'
      throw new Error(message)
    }

    const enriched = enrichRequiredSourceSnapshots(preliminary.config, workspace.rootPath, skills)
    const result = saveLabelSkillBindingsConfig(workspace.rootPath, enriched, context)
    deps.sessionManager.notifyConfigFileChange(workspace.rootPath, 'label-skill-bindings.json')
    pushTyped(server, RPC_CHANNELS.labelSkillBindings.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return result
  })

  server.handle(RPC_CHANNELS.labelSkillBindings.GENERATE_COMPACT_INSTRUCTION, async (_ctx, workspaceId: string, params: LabelSkillBindingsGenerateParams): Promise<LabelSkillBindingsGenerateResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const workingDirectory = resolveWorkspaceWorkingDirectory(workspace.rootPath, params.workingDirectory)

    // Explicit user-triggered generation is the only label-binding path that reads
    // the selected SKILL.md body. Do not log the raw content or generated text.
    const skill = loadSkillBySlug(workspace.rootPath, params.skillSlug, workingDirectory)
    if (!skill) throw new Error(`Skill not found: ${params.skillSlug}`)
    const summary = loadSkillSummaryBySlug(workspace.rootPath, params.skillSlug, workingDirectory, { includeContentHash: true })

    const warnings: string[] = []
    let compactInstruction: string | null = null

    let generationFallbackWarning: string | undefined
    try {
      const generated = await generateCompactInstructionWithMiniCompletion({
        workspace,
        deps,
        skillName: skill.metadata.name,
        skillDescription: skill.metadata.description,
        skillContent: skill.content,
        requiredSources: skill.metadata.requiredSources ?? [],
      })
      compactInstruction = generated.compactInstruction
      generationFallbackWarning = generated.warning
      if (compactInstruction) {
        warnings.push('Generated with the configured mini model from the selected SKILL.md. Review and edit before saving.')
      }
    } catch {
      // Fall through to deterministic fallback. Avoid logging exception details here
      // because provider errors can echo prompt fragments in some SDKs.
      generationFallbackWarning = 'Mini-model generation failed, possibly because the default connection is unauthenticated or unavailable; used a deterministic local fallback anchor. Review and edit before saving.'
    }

    if (!compactInstruction) {
      compactInstruction = buildDeterministicFallbackCompactInstruction(skill.metadata.name, skill.metadata.description)
      warnings.push(generationFallbackWarning ?? 'AI compact-instruction generation was unavailable; used a deterministic local fallback anchor. Review and edit before saving.')
    }

    return {
      compactInstruction,
      generatedFrom: {
        skillSlug: skill.slug,
        skillName: skill.metadata.name,
        skillDescription: skill.metadata.description,
        skillSource: skill.source,
        metadataHash: summary?.metadataHash ?? hashJson(skill.metadata),
        contentHash: summary?.contentHash ?? hashString(skill.content),
        requiredSources: skill.metadata.requiredSources,
        workingDirectoryHint: workingDirectory ? basename(workingDirectory) : undefined,
        generatedAt: new Date().toISOString(),
      },
      warnings,
    }
  })
}

function enrichRequiredSourceSnapshots(
  config: LabelSkillBindingsConfig,
  workspaceRootPath: string,
  skills: SkillSummary[],
): LabelSkillBindingsConfig {
  const skillsBySlug = new Map(skills.map(skill => [skill.slug, skill] as const))
  const sourcesBySlug = new Map(loadWorkspaceSources(workspaceRootPath).map(source => [source.config.slug, source] as const))
  return {
    version: config.version,
    bindings: config.bindings.map(binding => {
      const skill = skillsBySlug.get(binding.skillSlug)
      const slugs = skill?.requiredSources ?? binding.generatedFrom?.requiredSources ?? []
      if (!slugs.length) return { ...binding, requiredSourcesSnapshot: binding.requiredSourcesSnapshot ?? [] }
      const snapshot: RequiredSourceSnapshotEntry[] = Array.from(new Set(slugs)).sort().map(slug => {
        const source = sourcesBySlug.get(slug)
        return {
          slug,
          name: source?.config.name,
          type: source?.config.type,
          metadataHash: source ? hashJson({ slug: source.config.slug, name: source.config.name, type: source.config.type, provider: source.config.provider }) : undefined,
        }
      })
      return { ...binding, requiredSourcesSnapshot: snapshot }
    }),
  }
}

async function generateCompactInstructionWithMiniCompletion(args: {
  workspace: Workspace
  deps: HandlerDeps
  skillName: string
  skillDescription: string
  skillContent: string
  requiredSources: string[]
}): Promise<{ compactInstruction: string | null; warning?: string }> {
  const connectionSlug = getDefaultLlmConnection()
  if (!connectionSlug) {
    return {
      compactInstruction: null,
      warning: 'No default LLM connection is configured; used a deterministic local fallback anchor. Review and edit before saving.',
    }
  }
  const connection = getLlmConnection(connectionSlug)
  if (!connection) {
    return {
      compactInstruction: null,
      warning: `Default LLM connection "${connectionSlug}" was not found; used a deterministic local fallback anchor. Review and edit before saving.`,
    }
  }

  const miniModel = getMiniModel(connection) ?? connection.defaultModel
  const now = Date.now()
  const agent = createBackendFromConnection(connectionSlug, {
    workspace: args.workspace,
    miniModel,
    session: {
      id: `label-skill-generation-${now}`,
      name: 'Label skill compact instruction generation',
      workspaceRootPath: args.workspace.rootPath,
      createdAt: now,
      lastUsedAt: now,
    },
    isHeadless: true,
    skipConfigWatcher: true,
  }, buildBackendHostRuntimeContext(args.deps.platform))

  try {
    await agent.postInit()
    const raw = await withTimeout(
      agent.runMiniCompletion(buildCompactInstructionPrompt(args)),
      AI_GENERATION_TIMEOUT_MS,
    )
    const compactInstruction = sanitizeGeneratedCompactInstruction(raw)
    if (!compactInstruction) {
      return {
        compactInstruction: null,
        warning: 'Mini-model generation timed out or returned no text; used a deterministic local fallback anchor. Review and edit before saving.',
      }
    }
    return { compactInstruction }
  } finally {
    agent.destroy()
  }
}

function buildCompactInstructionPrompt(args: {
  skillName: string
  skillDescription: string
  skillContent: string
  requiredSources: string[]
}): string {
  const clippedContent = args.skillContent.length > MAX_SKILL_BODY_CHARS_FOR_GENERATION
    ? `${args.skillContent.slice(0, MAX_SKILL_BODY_CHARS_FOR_GENERATION)}\n\n[SKILL.md clipped for compact-instruction generation]`
    : args.skillContent
  const requiredSources = args.requiredSources.length ? args.requiredSources.join(', ') : 'none'
  return [
    'You generate tiny runtime anchors for Craft Agent label-to-skill role bindings.',
    'Return only the anchor text. Do not use markdown fences, XML tags, JSON, or explanations.',
    `Limit the result to ${MAX_GENERATED_COMPACT_INSTRUCTION_CHARS} characters and ${MAX_GENERATED_COMPACT_INSTRUCTION_LINES} non-empty lines.`,
    'This anchor is not a summary of the full skill. It only reminds the model which label-bound role is active and where the full behavior comes from.',
    'Do not include local file paths, quote chunks of the source skill, or copy long hard-rule lists.',
    'The anchor must include: active skill name, one-line role purpose, higher-priority-instructions caveat, and reread guidance.',
    'Use this compact shape:',
    `Active label-bound skill: ${args.skillName}.`,
    'Role anchor: <one concise operational responsibility> while this label is active.',
    'Full behavior source: bound SKILL.md via the standard skill bootstrap/read flow; this anchor is not the full skill.',
    'If behavior seems incomplete, stale, or forgotten after compaction/context loss, re-read the bound SKILL.md before continuing.',
    'Higher-priority system, developer, tool, permission, and direct user instructions override this anchor.',
    '',
    `Skill name: ${args.skillName}`,
    `Skill description: ${args.skillDescription}`,
    `Required source slugs: ${requiredSources}`,
    '',
    'SKILL.md content:',
    clippedContent,
  ].join('\n')
}

function sanitizeGeneratedCompactInstruction(value: string | null): string | null {
  if (!value) return null
  let text = value.trim()
  text = text.replace(/^```(?:\w+)?\s*/u, '').replace(/\s*```$/u, '').trim()
  if (!text) return null
  const lines = text
    .split(/\r?\n/u)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
  if (lines.length > MAX_GENERATED_COMPACT_INSTRUCTION_LINES) {
    text = lines.slice(0, MAX_GENERATED_COMPACT_INSTRUCTION_LINES).join('\n')
  } else {
    text = lines.join('\n')
  }
  if (text.length > MAX_GENERATED_COMPACT_INSTRUCTION_CHARS) {
    text = `${text.slice(0, MAX_GENERATED_COMPACT_INSTRUCTION_CHARS - 1).trim()}…`
  }
  return text
}

function buildDeterministicFallbackCompactInstruction(name: string, description: string): string {
  const instruction = [
    `Active label-bound skill: ${name}.`,
    `Role anchor: ${description}`,
    'Full behavior source: bound SKILL.md via the standard skill bootstrap/read flow; this anchor is not the full skill.',
    'If behavior seems incomplete, stale, or forgotten after compaction/context loss, re-read the bound SKILL.md before continuing.',
    'Higher-priority system, developer, tool, permission, and direct user instructions override this anchor.',
  ].join('\n').trim()
  return instruction.length > MAX_GENERATED_COMPACT_INSTRUCTION_CHARS
    ? `${instruction.slice(0, MAX_GENERATED_COMPACT_INSTRUCTION_CHARS - 1).trim()}…`
    : instruction
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>(resolve => {
        timeout = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function resolveWorkspaceWorkingDirectory(workspaceRootPath: string, workingDirectory?: string): string | undefined {
  if (!workingDirectory) return undefined
  const resolvedRoot = resolve(workspaceRootPath)
  const resolvedWorkingDirectory = resolve(workingDirectory)
  if (!existsSync(resolvedWorkingDirectory) || !statSync(resolvedWorkingDirectory).isDirectory()) return undefined
  const rel = relative(resolvedRoot, resolvedWorkingDirectory)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedWorkingDirectory
  }
  return undefined
}

function hashJson(value: unknown): string {
  return hashString(stableJsonStringify(value))
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${stableJsonStringify(obj[key])}`).join(',')}}`
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
