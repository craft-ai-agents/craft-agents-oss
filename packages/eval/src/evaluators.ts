import { asExperimentEvaluator } from '@arizeai/phoenix-client/experiments'
import type { EvaluatorParams } from '@arizeai/phoenix-client/types/experiments'
import type { CraftEvalOutput, EvalTaskExpected, ToolEventSummary } from './types'

const INTERNAL_SOURCE_TERMS = ['内部库存', '本地库存', '供应商库存', '自家库存', '动态库存', '库存表', '供应商档案']
const DEFAULT_MISSING_FIELD_TERMS = ['未填写', '待确认', '缺失', '为空', '未提供', '暂无', '没有提供']
const FIELD_LABELS: Record<string, string[]> = {
  brand: ['品牌'],
  quantity: ['数量', '库存数量', '库存'],
  price: ['价格', '单价', '目标价', '成本'],
  supplierName: ['供应商', '供应商名称'],
  supplierGrade: ['等级', '供应商等级'],
  updatedAt: ['发布时间', '更新时间', '时间'],
  shelf: ['货架', '货架位置'],
  stockType: ['类型'],
  productCategory: ['优势产品', '主营产品', '品类'],
  supplierType: ['供应商类型', '类型'],
}

function toolNameMatches(tool: ToolEventSummary, expected: string): boolean {
  const name = tool.toolName?.toLowerCase() ?? ''
  return name.includes(expected.toLowerCase())
}

function toolText(tool: ToolEventSummary): string {
  return [
    tool.toolName,
    tool.input ? JSON.stringify(tool.input) : undefined,
    tool.result,
  ].filter(Boolean).join('\n').toLowerCase()
}

function allToolText(tools: ToolEventSummary[]): string {
  return tools.map(toolText).join('\n')
}

function isInventoryLookupTool(tool: ToolEventSummary): boolean {
  const text = toolText(tool)
  return toolNameMatches(tool, 'procurement-local-inventory-lookup')
    || (
      tool.type === 'tool_start'
      && toolNameMatches(tool, 'Bash')
      && text.includes('lark-cli')
      && text.includes('base')
      && (text.includes('+record-search') || text.includes('+record-list') || text.includes('+record-get'))
    )
}

function isPlatformSearchTool(tool: ToolEventSummary): boolean {
  const text = toolText(tool)
  return toolNameMatches(tool, 'procurement-platform-search')
    || text.includes('procurement-platform-search')
    || toolNameMatches(tool, 'WebSearch')
    || toolNameMatches(tool, 'WebFetch')
}

function isSupplierShortlistTool(tool: ToolEventSummary): boolean {
  const text = toolText(tool)
  return toolNameMatches(tool, 'procurement-supplier-shortlist')
    || text.includes('procurement-supplier-shortlist')
    || text.includes('tblbtumhfior6oss')
    || text.includes('供应商档案')
}

function firstMatchingToolIndex(tools: ToolEventSummary[], predicate: (tool: ToolEventSummary) => boolean): number {
  return tools.findIndex(predicate)
}

function countToolStarts(tools: ToolEventSummary[], predicate?: (tool: ToolEventSummary) => boolean): number {
  return tools.filter((tool) => tool.type === 'tool_start' && (!predicate || predicate(tool))).length
}

function includesTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase())
}

function includesAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => includesTerm(text, term))
}

function expectedToolPredicate(expected: string): (tool: ToolEventSummary) => boolean {
  return (tool) => {
    const normalized = expected.toLowerCase()
    const text = toolText(tool)
    if (normalized === 'procurement-local-inventory-lookup') return isInventoryLookupTool(tool)
    if (normalized === 'procurement-platform-search') return isPlatformSearchTool(tool)
    if (normalized === 'procurement-supplier-shortlist') return isSupplierShortlistTool(tool)
    return toolNameMatches(tool, expected) || text.includes(normalized)
  }
}

function result(passed: boolean, explanation: string, metadata?: Record<string, unknown>) {
  return {
    score: passed ? 1 : 0,
    label: passed ? 'pass' : 'fail',
    explanation,
    metadata,
  }
}

function outputFrom(params: EvaluatorParams): CraftEvalOutput {
  return params.output as CraftEvalOutput
}

function expectedFrom(params: EvaluatorParams): EvalTaskExpected {
  return (params.expected ?? {}) as unknown as EvalTaskExpected
}

function metadataFrom(params: EvaluatorParams): Record<string, unknown> {
  return (params.metadata ?? {}) as Record<string, unknown>
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function metadataString(params: EvaluatorParams, group: string, field: string): string | undefined {
  const value = nestedRecord(metadataFrom(params), group)[field]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function finalAnswerText(params: EvaluatorParams): string {
  return outputFrom(params).finalAnswer
}

export const outcomeEvaluator = asExperimentEvaluator({
  name: 'outcome_complete',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const output = outputFrom(params)
    const passed = output.outcome === 'complete' && output.finalAnswer.trim().length > 0
    return result(
      passed,
      passed ? 'agent turn completed with a final answer' : `agent outcome=${output.outcome}; error=${output.error ?? 'none'}`,
      { sessionId: output.sessionId, traceId: params.traceId ?? null },
    )
  },
})

export const traceContractEvaluator = asExperimentEvaluator({
  name: 'trace_contract',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const output = outputFrom(params)
    const trace = expected.trace ?? {}
    const inventoryFirst = trace.inventoryFirst ?? expected.localInventoryFirst
    const forbidPlatformBeforeInventory = trace.forbidPlatformBeforeInventory ?? expected.forbidPlatformSearch
    const requiresPlatformSearch = trace.requiresPlatformSearch ?? expected.requiresPlatformSearch
    const requiresSupplierShortlist = trace.requiresSupplierShortlist ?? expected.requiresSupplierShortlist
    const tools = output.toolEvents
    const inventoryIndex = firstMatchingToolIndex(tools, isInventoryLookupTool)
    const platformIndex = firstMatchingToolIndex(tools, isPlatformSearchTool)
    const supplierIndex = firstMatchingToolIndex(tools, isSupplierShortlistTool)
    const toolCallCount = countToolStarts(tools)
    const bashCallCount = countToolStarts(tools, (tool) => toolNameMatches(tool, 'Bash'))
    const failures: string[] = []

    if (inventoryFirst && inventoryIndex < 0) failures.push('missing inventory lookup')
    if (forbidPlatformBeforeInventory && platformIndex >= 0 && (inventoryIndex < 0 || platformIndex < inventoryIndex)) {
      failures.push(`platform before inventory: inventoryIndex=${inventoryIndex}; platformIndex=${platformIndex}`)
    }
    if (requiresPlatformSearch && platformIndex < 0) failures.push('missing platform search')
    if (requiresSupplierShortlist && supplierIndex < 0) failures.push('missing supplier shortlist')
    if (typeof trace.maxToolCalls === 'number' && toolCallCount > trace.maxToolCalls) {
      failures.push(`too many tool calls: ${toolCallCount} > ${trace.maxToolCalls}`)
    }
    if (typeof trace.maxBashCalls === 'number' && bashCallCount > trace.maxBashCalls) {
      failures.push(`too many Bash calls: ${bashCallCount} > ${trace.maxBashCalls}`)
    }

    const passed = failures.length === 0

    return result(
      passed,
      passed
        ? 'trace contract satisfied'
        : failures.join('; '),
      { inventoryIndex, platformIndex, supplierIndex, toolCallCount, bashCallCount },
    )
  },
})

export const toolCallContractEvaluator = asExperimentEvaluator({
  name: 'tool_call_contract',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const output = outputFrom(params)
    const contract = expected.toolCalls
    if (!contract) {
      return result(true, 'case does not define a tool-call contract')
    }

    const tools = output.toolEvents
    const text = allToolText(tools)
    const failures: string[] = []
    const forbiddenHits: string[] = []

    for (const skill of contract.requiredSkills ?? []) {
      if (!tools.some(expectedToolPredicate(skill))) failures.push(`missing skill/tool: ${skill}`)
    }
    for (const tableId of contract.requiredTableIds ?? []) {
      if (!includesTerm(text, tableId)) failures.push(`missing table id: ${tableId}`)
    }
    for (const tableName of contract.requiredTableNames ?? []) {
      if (!includesTerm(text, tableName)) failures.push(`missing table name: ${tableName}`)
    }
    for (const field of contract.requiredSearchFields ?? []) {
      if (!includesTerm(text, field)) failures.push(`missing search field: ${field}`)
    }
    for (const term of contract.requiredSearchTerms ?? []) {
      if (!includesTerm(text, term)) failures.push(`missing search term: ${term}`)
    }
    for (const forbiddenTool of contract.forbiddenTools ?? []) {
      if (tools.some(expectedToolPredicate(forbiddenTool))) forbiddenHits.push(forbiddenTool)
    }
    if (forbiddenHits.length > 0) failures.push(`forbidden tools observed: ${forbiddenHits.join(', ')}`)

    return result(
      failures.length === 0,
      failures.length === 0 ? 'tool-call contract satisfied' : failures.join('; '),
      { forbiddenHits },
    )
  },
})

export const answerContractEvaluator = asExperimentEvaluator({
  name: 'answer_contract',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const answer = finalAnswerText(params)
    const requiredTerms = expected.answer?.requiredTerms ?? expected.finalAnswerIncludes ?? []
    const forbiddenTerms = expected.answer?.forbiddenTerms ?? []
    const missing = requiredTerms.filter((term) => !answer.includes(term))
    const forbiddenHits = forbiddenTerms.filter((term) => includesTerm(answer, term))
    const failures: string[] = []

    if (missing.length > 0) failures.push(`missing required answer terms: ${missing.join(', ')}`)
    if (forbiddenHits.length > 0) failures.push(`forbidden answer terms: ${forbiddenHits.join(', ')}`)
    if (expected.answer?.mustMentionInternalSource && !includesAnyTerm(answer, INTERNAL_SOURCE_TERMS)) {
      failures.push('missing internal source wording')
    }

    return result(
      failures.length === 0,
      failures.length === 0 ? 'answer contract satisfied' : failures.join('; '),
      { missing, forbiddenHits },
    )
  },
})

export const evidenceContractEvaluator = asExperimentEvaluator({
  name: 'evidence_contract',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const evidence = expected.evidence
    if (!evidence) {
      return result(true, 'case does not define an evidence contract')
    }

    const answer = finalAnswerText(params)
    const failures: string[] = []
    const missingPreservedFields: string[] = []
    const missingUnknownFields: string[] = []
    const unknownTerms = evidence.missingFieldTerms?.length ? evidence.missingFieldTerms : DEFAULT_MISSING_FIELD_TERMS

    for (const field of evidence.preserveFields ?? []) {
      const value = metadataString(params, 'seed', field)
      if (value && !answer.includes(value)) {
        missingPreservedFields.push(`${field}=${value}`)
      }
    }

    if (evidence.missingFieldPolicy === 'explicit_unknown') {
      for (const field of evidence.missingFields ?? []) {
        const value = metadataString(params, 'seed', field)
        if (value) continue
        const labels = FIELD_LABELS[field] ?? [field]
        const mentionsField = includesAnyTerm(answer, labels)
        const mentionsUnknown = includesAnyTerm(answer, unknownTerms)
        if (!mentionsField || !mentionsUnknown) {
          missingUnknownFields.push(field)
        }
      }
    }

    if (missingPreservedFields.length > 0) {
      failures.push(`missing preserved field values: ${missingPreservedFields.join(', ')}`)
    }
    if (missingUnknownFields.length > 0) {
      failures.push(`missing explicit unknown wording for fields: ${missingUnknownFields.join(', ')}`)
    }

    return result(
      failures.length === 0,
      failures.length === 0 ? 'evidence contract satisfied' : failures.join('; '),
      { missingPreservedFields, missingUnknownFields },
    )
  },
})

export const defaultEvaluators = [
  outcomeEvaluator,
  traceContractEvaluator,
  toolCallContractEvaluator,
  answerContractEvaluator,
  evidenceContractEvaluator,
]
