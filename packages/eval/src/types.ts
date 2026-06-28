import type { SessionEvent } from '@craft-agent/shared/protocol'
import type { SubstitutesExpected } from './substitutes'

export type AssertionType = 'code' | 'manual' | 'llm'

export interface EvalAssertion {
  type: AssertionType
  criterion: string
}

export interface EvalTraceExpected {
  inventoryFirst?: boolean
  forbidPlatformBeforeInventory?: boolean
  requiresPlatformSearch?: boolean
  requiresSupplierShortlist?: boolean
  maxToolCalls?: number
  maxBashCalls?: number
}

export interface EvalToolCallsExpected {
  requiredSkills?: string[]
  requiredTableIds?: string[]
  requiredTableNames?: string[]
  requiredSearchFields?: string[]
  requiredSearchTerms?: string[]
  forbiddenTools?: string[]
}

export interface EvalAnswerExpected {
  requiredTerms?: string[]
  forbiddenTerms?: string[]
  mustMentionInternalSource?: boolean
}

export interface EvalEvidenceExpected {
  preserveFields?: string[]
  missingFields?: string[]
  missingFieldPolicy?: 'explicit_unknown'
  missingFieldTerms?: string[]
}

export interface EvalPlatformExpected {
  sourceIds?: string[]
  requireAllSources?: boolean
  allowImplicitAllSources?: boolean
  minCoverageRatio?: number
  requireAvailabilityReport?: boolean
  requiredStatusTerms?: string[]
  requiredReportFields?: string[]
  requiredStructuredFields?: string[]
  precisionSampleSize?: number
}

export interface EvalExpected {
  trace?: EvalTraceExpected
  toolCalls?: EvalToolCallsExpected
  answer?: EvalAnswerExpected
  evidence?: EvalEvidenceExpected
  platform?: EvalPlatformExpected
  /** 替代料 labeled 参考答案(closed 集);存进 Phoenix example 的 expected。 */
  substitutes?: SubstitutesExpected

  /**
   * Legacy flat fields kept so older case files remain runnable.
   */
  localInventoryFirst?: boolean
  forbidPlatformSearch?: boolean
  requiresPlatformSearch?: boolean
  requiresSupplierShortlist?: boolean
  finalAnswerIncludes?: string[]
}

export interface EvalCase {
  id: string
  name: string
  category?: string
  input: string
  context?: string
  skillSlugs?: string[]
  metadata?: Record<string, unknown>
  expected?: EvalExpected
  assertions: EvalAssertion[]
}

export interface EvalTaskInput {
  id: string
  name: string
  message: string
  context?: string
  skillSlugs?: string[]
}

export interface EvalTaskExpected extends EvalExpected {
  assertions: EvalAssertion[]
}

export interface ToolEventSummary {
  type: 'tool_start' | 'tool_result'
  toolName?: string
  toolUseId: string
  isError?: boolean
  input?: Record<string, unknown>
  result?: string
}

export interface CraftEvalOutput {
  finalAnswer: string
  sessionId: string | null
  userMessageId: string | null
  traceId?: string | null
  outcome: 'complete' | 'error' | 'interrupted' | 'timeout'
  error?: string
  toolEvents: ToolEventSummary[]
  eventTypes: SessionEvent['type'][]
}
