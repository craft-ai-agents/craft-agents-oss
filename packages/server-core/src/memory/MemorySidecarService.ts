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
    return { queued: true, itemId: item.id }
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

    if (isDuplicate(decision, input.existingMemoryIndex ?? [])) return null

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

function containsSecret(value: string | undefined): boolean {
  if (!value) return false
  return SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

function isDuplicate(
  decision: Exclude<MemorySidecarDecision, { decision: 'none' }>,
  existing: NonNullable<MemorySidecarTurnInput['existingMemoryIndex']>,
): boolean {
  if (decision.decision === 'forget') return false
  const content = decision.content?.trim().toLowerCase()
  return existing.some((entry) => {
    if (entry.scope !== decision.scope) return false
    if (entry.scope === 'agent' && entry.agentSlug !== decision.agentSlug) return false
    return entry.name.trim().toLowerCase() === decision.name.trim().toLowerCase() ||
      (Boolean(content) && entry.body.trim().toLowerCase() === content)
  })
}
