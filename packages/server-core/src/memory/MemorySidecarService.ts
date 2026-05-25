import {
  enqueueMemoryReviewItem,
  listAgentMemoryEntries,
  saveMemoryEntry,
  type EnqueueMemoryReviewInput,
  type MemoryEntryType,
  type MemoryMutationEventMetadata,
  type MemoryScope,
  type MemoryStorageOptions,
  type SaveMemoryInput,
} from '@craft-agent/shared/memory'

export interface MemorySidecarTurnInput {
  userMessage: string
  assistantResponse: string
  activeAgentSlug?: string
  runId?: string
  existingMemoryIndex?: Array<{
    scope: MemoryScope
    agentSlug?: string
    name: string
    type: MemoryEntryType
    body: string
  }>
}

export type MemorySidecarDecision =
  | { decision: 'none'; confidence: number; reason: string }
  | {
      decision: 'save' | 'update' | 'forget'
      scope: MemoryScope
      agentSlug?: string
      name: string
      type?: MemoryEntryType
      content?: string
      expires?: string | null
      confidence: number
      evidence: string
    }

export interface MemorySidecarReviewer {
  review(input: MemorySidecarTurnInput): Promise<MemorySidecarDecision>
}

export interface MemorySidecarServiceOptions {
  reviewer: MemorySidecarReviewer
  minConfidence?: number
  autoApplyAgentConfidence?: number
  storage?: MemoryStorageOptions
  applyMemory?: (proposal: EnqueueMemoryReviewInput) => Promise<MemorySidecarApplyResult>
}

export interface MemorySidecarResult {
  queued: boolean
  applied?: boolean
  reason?: string
  itemId?: string
  scope?: MemoryScope
  agentSlug?: string
  name?: string
}

export interface MemorySidecarApplyResult {
  ok: boolean
  name?: string
  error?: string
}

export interface AgentMemorySidecarApplyOptions {
  activeAgentSlug?: string
  runId?: string
  storage?: MemoryStorageOptions
}

const DEFAULT_MIN_CONFIDENCE = 0.85
const DEFAULT_AUTO_APPLY_AGENT_CONFIDENCE = 0.9
const agentMemoryAutoApplyLocks = new Map<string, Promise<void>>()
const SECRET_PATTERNS = [
  /\b(api[_-]?key|secret|token|password|private[_-]?key)\b/i,
  /\b(sk-[a-z0-9_-]{12,})\b/i,
  /\b(bearer|authorization)\s+[a-z0-9._~+/=-]{16,}/i,
  /\b(ghp|gho|ghu|ghs|ghr)_[a-z0-9_]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{20,}\b/i,
  /\bnpm_[a-z0-9]{20,}\b/i,
  /\bxox[baprs]-[a-z0-9-]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}\b/,
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/i,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
]
const TRANSIENT_TASK_PATTERNS = [
  /\b(?:branch|worktree|commit|sha|pr|pull request)\b.*\b[a-f0-9]{7,40}\b/i,
  /\b(?:current|active)\s+(?:branch|worktree|cwd|repo|repository)\b/i,
  /\b(?:cwd|repo|repository|worktree)\s*(?:is|=|:)\s*\/[^\s]+/i,
  /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/i,
  /\b(?:tests?|typechecks?|lint|build)\s+(?:passed|failed|is passing|is failing)\b/i,
  /\b(?:server|runner|electron|dev server)\s+(?:is\s+)?(?:running|open|launched|frozen|stopped)\b/i,
]

export class MemorySidecarService {
  private readonly reviewer: MemorySidecarReviewer
  private readonly minConfidence: number
  private readonly autoApplyAgentConfidence: number
  private readonly storage: MemoryStorageOptions | undefined
  private readonly applyMemory: MemorySidecarServiceOptions['applyMemory']

  constructor(options: MemorySidecarServiceOptions) {
    this.reviewer = options.reviewer
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE
    this.autoApplyAgentConfidence = options.autoApplyAgentConfidence ?? DEFAULT_AUTO_APPLY_AGENT_CONFIDENCE
    this.storage = options.storage
    this.applyMemory = options.applyMemory
  }

  async reviewTurn(input: MemorySidecarTurnInput): Promise<MemorySidecarResult> {
    const decision = await this.reviewer.review(input)
    const proposal = this.normalizeDecision(decision, input)
    if (!proposal) {
      return {
        queued: false,
        reason: decision.decision === 'none' ? decision.reason : 'proposal rejected by validation',
      }
    }

    if (this.applyMemory && shouldAutoApplyAgentSave(proposal, this.autoApplyAgentConfidence)) {
      const applied = await this.tryApplyMemory(proposal)
      if (applied.ok) {
        return {
          queued: false,
          applied: true,
          scope: proposal.scope,
          agentSlug: proposal.agentSlug,
          name: applied.name ?? proposal.name,
        }
      }
    }

    const item = enqueueMemoryReviewItem(proposal, this.storage)
    return { queued: true, itemId: item.id, scope: item.scope, agentSlug: item.agentSlug }
  }

  private async tryApplyMemory(proposal: EnqueueMemoryReviewInput): Promise<MemorySidecarApplyResult> {
    try {
      return await this.applyMemory!(proposal)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private normalizeDecision(
    decision: MemorySidecarDecision,
    input: MemorySidecarTurnInput,
  ): EnqueueMemoryReviewInput | null {
    if (decision.decision === 'none') return null
    if (decision.confidence < this.minConfidence) return null
    if (!decision.name.trim()) return null
    if (containsSecret(decision.name) || containsSecret(decision.evidence)) return null

    const scope = decision.scope
    const agentSlug = scope === 'agent'
      ? decision.agentSlug ?? input.activeAgentSlug
      : undefined
    if (scope === 'agent' && !agentSlug) return null

    if (decision.decision !== 'forget') {
      if (!decision.type) return null
      if (!decision.content?.trim()) return null
      if (containsSecret(decision.content)) return null
      if (containsTransientTaskFact(decision.name) || containsTransientTaskFact(decision.content)) return null
    }

    if (isDuplicate({
      scope,
      agentSlug,
      name: decision.name,
      content: decision.content,
      decision: decision.decision,
    }, input.existingMemoryIndex ?? [])) return null

    return {
      action: decision.decision,
      scope,
      agentSlug,
      name: decision.name.trim(),
      type: decision.type,
      body: decision.content?.trim(),
      expires: decision.expires,
      confidence: decision.confidence,
      evidence: decision.evidence.trim(),
      sourceRunId: input.runId,
      source: 'sidecar',
    }
  }
}

function shouldAutoApplyAgentSave(
  proposal: EnqueueMemoryReviewInput,
  minConfidence: number,
): boolean {
  return proposal.action === 'save' &&
    proposal.scope === 'agent' &&
    proposal.confidence >= minConfidence &&
    Boolean(proposal.agentSlug) &&
    Boolean(proposal.type) &&
    Boolean(proposal.body?.trim())
}

export function createMemorySidecarReviewer(
  runMiniCompletion: (prompt: string) => Promise<string | null>,
): MemorySidecarReviewer {
  return {
    async review(input) {
      const response = await runMiniCompletion(buildMemorySidecarPrompt(input))
      if (!response) {
        return { decision: 'none', confidence: 0, reason: 'empty reviewer response' }
      }
      return parseMemorySidecarDecision(response)
    },
  }
}

export function createAgentMemorySidecarApplyMemory(
  options: AgentMemorySidecarApplyOptions,
): MemorySidecarServiceOptions['applyMemory'] {
  return async (proposal) => {
    if (proposal.action !== 'save') return { ok: false, error: 'only save proposals can auto-apply' }
    if (proposal.scope !== 'agent') return { ok: false, error: 'only agent memory can auto-apply' }
    const agentSlug = proposal.agentSlug ?? options.activeAgentSlug
    if (!agentSlug) return { ok: false, error: 'agentSlug is required' }
    if (!proposal.type || !proposal.body?.trim()) return { ok: false, error: 'type and body are required' }
    const type = proposal.type
    const body = proposal.body

    return withAgentMemoryAutoApplyLock(agentSlug, async () => {
      const existing = listAgentMemoryEntries(agentSlug, options.storage)
      const duplicate = existing.find((entry) => isSameMemorySave(entry.name, entry.body, proposal.name, body))
      if (duplicate) return { ok: true, name: duplicate.name }

      const event: MemoryMutationEventMetadata = {
        source: 'sidecar',
        runId: options.runId,
        actor: agentSlug,
        evidence: proposal.evidence,
      }
      const saved = await saveMemoryEntry({
        scope: 'agent',
        agentSlug,
        name: proposal.name,
        type,
        body,
        expires: typeof proposal.expires === 'string' ? proposal.expires : undefined,
        event,
      } satisfies SaveMemoryInput, options.storage)

      return { ok: true, name: saved.name }
    })
  }
}

async function withAgentMemoryAutoApplyLock<T>(agentSlug: string, work: () => Promise<T>): Promise<T> {
  const previous = agentMemoryAutoApplyLocks.get(agentSlug) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => current, () => current)
  agentMemoryAutoApplyLocks.set(agentSlug, chained)

  await previous
  try {
    return await work()
  } finally {
    release()
    if (agentMemoryAutoApplyLocks.get(agentSlug) === chained) {
      agentMemoryAutoApplyLocks.delete(agentSlug)
    }
  }
}

function isSameMemorySave(
  existingName: string,
  existingBody: string,
  proposalName: string,
  proposalBody: string | undefined,
): boolean {
  const body = proposalBody?.trim().toLowerCase()
  if (!body) return false
  return existingName.trim().toLowerCase() === proposalName.trim().toLowerCase() ||
    existingBody.trim().toLowerCase() === body
}

export function buildMemorySidecarPrompt(input: MemorySidecarTurnInput): string {
  const existing = (input.existingMemoryIndex ?? [])
    .slice(0, 80)
    .map((entry) => `- ${entry.scope}${entry.agentSlug ? `:${entry.agentSlug}` : ''} | ${entry.type} | ${entry.name}: ${entry.body}`)
    .join('\n') || '(none)'

  return `You are RunnerOS Memory Sidecar. Decide whether the latest turn contains one durable memory worth proposing.

Save only stable user preferences, direct corrections, agent instructions, or reusable working context that should follow the user or active agent across sessions.
Do not save secrets, credentials, workspace-specific project facts, one-off task details, temporary emotions, generic praise, or anything already present.
Workspace-specific project facts belong in workspace context, not user or agent memory.
Prefer "update" when the user changes or clarifies an existing memory. Use "forget" only when the user asks to remove a known memory.
If uncertain, choose "none". Confidence must be at least 0.85 for save/update/forget.

Active agent slug: ${input.activeAgentSlug ?? '(none)'}
Run id: ${input.runId ?? '(none)'}

Existing memory index:
${existing}

Latest user message:
${input.userMessage}

Latest assistant response:
${input.assistantResponse}

Reply with one JSON object only. No markdown.

For no memory:
{"decision":"none","confidence":0.0,"reason":"short reason"}

For a proposal:
{"decision":"save","scope":"user","name":"short lowercase title","type":"feedback","content":"durable memory text","expires":null,"confidence":0.9,"evidence":"short quote or paraphrase"}

Allowed decisions: none, save, update, forget.
Allowed scopes: user, agent.
Allowed types: user, feedback, project, reference.
For agent scope, include "agentSlug" when known.`
}

export function parseMemorySidecarDecision(text: string): MemorySidecarDecision {
  try {
    const parsed = JSON.parse(extractJsonObjectText(text)) as Record<string, unknown>
    const decision = typeof parsed.decision === 'string' ? parsed.decision : 'none'
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : 0

    if (decision === 'none') {
      return {
        decision: 'none',
        confidence,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'no durable memory',
      }
    }

    if (decision !== 'save' && decision !== 'update' && decision !== 'forget') {
      return { decision: 'none', confidence: 0, reason: 'invalid decision' }
    }

    const scope = parsed.scope === 'agent' ? 'agent' : parsed.scope === 'user' ? 'user' : undefined
    if (!scope) return { decision: 'none', confidence: 0, reason: 'invalid scope' }

    const type = typeof parsed.type === 'string' ? parsed.type : undefined
    const normalizedType = type === 'user' || type === 'feedback' || type === 'project' || type === 'reference'
      ? type
      : undefined

    return {
      decision,
      scope,
      agentSlug: typeof parsed.agentSlug === 'string' ? parsed.agentSlug : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      type: normalizedType,
      content: typeof parsed.content === 'string' ? parsed.content : undefined,
      expires: parsed.expires === null || typeof parsed.expires === 'string' ? parsed.expires : undefined,
      confidence,
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
    }
  } catch {
    return { decision: 'none', confidence: 0, reason: 'invalid json' }
  }
}

function containsSecret(value: string | undefined): boolean {
  if (!value) return false
  return SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

function containsTransientTaskFact(value: string | undefined): boolean {
  if (!value) return false
  return TRANSIENT_TASK_PATTERNS.some((pattern) => pattern.test(value))
}

function isDuplicate(
  decision: {
    decision: 'save' | 'update' | 'forget'
    scope: MemoryScope
    agentSlug?: string
    name: string
    content?: string
  },
  existing: NonNullable<MemorySidecarTurnInput['existingMemoryIndex']>,
): boolean {
  if (decision.decision !== 'save') return false
  const content = decision.content?.trim().toLowerCase()
  return existing.some((entry) => {
    if (entry.scope !== decision.scope) return false
    if (entry.scope === 'agent' && entry.agentSlug !== decision.agentSlug) return false
    return entry.name.trim().toLowerCase() === decision.name.trim().toLowerCase() ||
      (Boolean(content) && entry.body.trim().toLowerCase() === content)
  })
}

function extractJsonObjectText(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate
  const objectMatch = candidate.match(/\{[\s\S]*\}/)
  if (!objectMatch) throw new Error('No JSON object found')
  return objectMatch[0]
}
