import {
  enqueueMemoryReviewItem,
  type EnqueueMemoryReviewInput,
  type MemoryEntryType,
  type MemoryScope,
  type MemoryStorageOptions,
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
  storage?: MemoryStorageOptions
}

export interface MemorySidecarResult {
  queued: boolean
  reason?: string
  itemId?: string
  scope?: MemoryScope
  agentSlug?: string
}

const DEFAULT_MIN_CONFIDENCE = 0.85
const SECRET_PATTERNS = [
  /\b(api[_-]?key|secret|token|password|private[_-]?key)\b/i,
  /\b(sk-[a-z0-9_-]{12,})\b/i,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
]

export class MemorySidecarService {
  private readonly reviewer: MemorySidecarReviewer
  private readonly minConfidence: number
  private readonly storage: MemoryStorageOptions | undefined

  constructor(options: MemorySidecarServiceOptions) {
    this.reviewer = options.reviewer
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE
    this.storage = options.storage
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

    const item = enqueueMemoryReviewItem(proposal, this.storage)
    return { queued: true, itemId: item.id, scope: item.scope, agentSlug: item.agentSlug }
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

export function buildMemorySidecarPrompt(input: MemorySidecarTurnInput): string {
  const existing = (input.existingMemoryIndex ?? [])
    .slice(0, 80)
    .map((entry) => `- ${entry.scope}${entry.agentSlug ? `:${entry.agentSlug}` : ''} | ${entry.type} | ${entry.name}: ${entry.body}`)
    .join('\n') || '(none)'

  return `You are RunnerOS Memory Sidecar. Decide whether the latest turn contains one durable memory worth proposing.

Save only stable preferences, corrections, project facts, agent instructions, or reusable working context.
Do not save secrets, credentials, one-off task details, temporary emotions, generic praise, or anything already present.
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
