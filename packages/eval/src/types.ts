import type { SessionEvent } from '@craft-agent/shared/protocol'
import type { SubstitutesExpected } from './substitutes'

export type AssertionType = 'code' | 'manual' | 'llm'

export interface EvalAssertion {
  type: AssertionType
  criterion: string
}

/** 执行健康度断言(零工具名感知)。 */
export interface EvalExecutionExpected {
  /** 工具错误数上限;回归池默认 0("这条路径不再炸")。 */
  maxToolErrors?: number
}

/**
 * 真值对账断言:判分时 harness 现场查 larkdepot 得地面真值,对账答案。
 * 只写"查询词"这一个稳定标识——有没有货、哪些供应商、什么价,全部现场计算,
 * 活数据漂移不烂 case(判分快照与 agent 查询同一份缓存)。
 */
export interface EvalGroundTruthExpected {
  /** 查询词(可以是变体写法,record-search 内建 norm 归一)。 */
  part: string
  /** 答案至少报出几家真实供应商(默认 1;自动 min(要求, 真值供应商数))。 */
  minSupplierMentions?: number
  /** 要求答案报出至少一个真实价格数字(问价类 case 用)。 */
  requirePriceMention?: boolean
}

export interface EvalExpected {
  execution?: EvalExecutionExpected
  groundTruth?: EvalGroundTruthExpected
  /** 替代料 labeled 参考答案(closed 集);存进 Phoenix example 的 expected。 */
  substitutes?: SubstitutesExpected
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
