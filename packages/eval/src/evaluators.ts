import { asExperimentEvaluator } from '@arizeai/phoenix-client/experiments'
import type { EvaluatorParams } from '@arizeai/phoenix-client/types/experiments'
import type { CraftEvalOutput, EvalTaskExpected, ToolEventSummary } from './types'
import { extractSubstitutesPayload, scoreSubstitutes } from './substitutes'

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

/**
 * 工具"意图"文本:name + input,不含 result。
 * 铁律:行为判定只看 agent 决定做什么(intent),不看世界回了什么(observation)。
 * 拿 result 判分的历史后果:读一篇提到 scrape-engine 的文档 = 被判"用了平台搜索";
 * larkdepot schema 输出列出所有表名 = 被判"查过每张表"。假通过/假失败双向漏。
 */
function toolIntentText(tool: ToolEventSummary): string {
  return [
    tool.toolName,
    tool.input ? JSON.stringify(tool.input) : undefined,
  ].filter(Boolean).join('\n').toLowerCase()
}

function allToolIntentText(tools: ToolEventSummary[]): string {
  return tools.filter((tool) => tool.type === 'tool_start').map(toolIntentText).join('\n')
}

/** 全量文本(含 result)——只许显式解析产出的判分器用(平台覆盖率解析 engine payload)。 */
function toolText(tool: ToolEventSummary): string {
  return [
    tool.toolName,
    tool.input ? JSON.stringify(tool.input) : undefined,
    tool.result,
  ].filter(Boolean).join('\n').toLowerCase()
}

function engineToolStartTexts(tools: ToolEventSummary[]): string[] {
  return tools
    .filter(isEngineToolStart)
    .map(toolIntentText)
}

function hasExplicitSourceArg(text: string): boolean {
  return /--source(?:=|\s+)/.test(text)
}

function hasPartArg(text: string): boolean {
  return /--parts?(?:=|\s+)/.test(text)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(asRecord).filter((record): record is Record<string, unknown> => Boolean(record))
    : []
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const candidates = [text.trim()]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))

  for (const candidate of candidates) {
    try {
      return asRecord(JSON.parse(candidate))
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function isEngineToolStart(tool: ToolEventSummary): boolean {
  if (tool.type !== 'tool_start') return false
  const text = toolIntentText(tool)
  if (toolNameMatches(tool, 'procurement-platform-search') || toolNameMatches(tool, 'scrape-engine')) {
    return true
  }
  return toolNameMatches(tool, 'Bash')
    && (text.includes('engine.py') || text.includes('procurement-platform-search'))
}

function isEngineOutputLogRead(tool: ToolEventSummary): boolean {
  if (tool.type !== 'tool_start' || !toolNameMatches(tool, 'Read')) return false
  const filePath = tool.input?.file_path
  return typeof filePath === 'string' && /\/tmp\/pi-bash-[a-z0-9_-]+\.log$/i.test(filePath)
}

interface EnginePayload {
  rows: Array<Record<string, unknown>>
  errors: Array<Record<string, unknown>>
}

function enginePayloads(tools: ToolEventSummary[]): EnginePayload[] {
  const payloads: EnginePayload[] = []
  const engineResultIds = new Set(
    tools
      .filter((tool) => isEngineToolStart(tool) || isEngineOutputLogRead(tool))
      .map((tool) => tool.toolUseId),
  )

  for (const tool of tools) {
    if (tool.type !== 'tool_result' || !tool.result) continue
    if (!engineResultIds.has(tool.toolUseId)) continue
    const parsed = parseJsonObject(tool.result)
    if (!parsed) continue
    const rows = recordArray(parsed.rows)
    const errors = recordArray(parsed.errors)
    if (rows.length > 0 || errors.length > 0) {
      payloads.push({ rows, errors })
    }
  }
  return payloads
}

function platformIdFrom(record: Record<string, unknown>): string | undefined {
  const value = record.platform
  return typeof value === 'string' && value.trim().length > 0 ? value.toLowerCase() : undefined
}

function platformCoverage(
  tools: ToolEventSummary[],
  sourceIds: string[],
  allowImplicitAllSources: boolean,
): { covered: string[], implicitAll: boolean, engineCallCount: number } {
  const expected = sourceIds.map((source) => source.toLowerCase())
  const covered = new Set<string>()
  let implicitAll = false
  const startTexts = engineToolStartTexts(tools)

  for (const text of startTexts) {
    if (!hasExplicitSourceArg(text) && hasPartArg(text) && allowImplicitAllSources) {
      implicitAll = true
    }
    for (const source of expected) {
      if (includesTerm(text, source)) covered.add(source)
    }
  }

  for (const payload of enginePayloads(tools)) {
    for (const row of payload.rows) {
      const platform = platformIdFrom(row)
      if (platform && expected.includes(platform)) covered.add(platform)
    }
    for (const error of payload.errors) {
      const platform = platformIdFrom(error)
      if (platform && expected.includes(platform)) covered.add(platform)
    }
  }

  return {
    covered: implicitAll ? expected : [...covered],
    implicitAll,
    engineCallCount: startTexts.length,
  }
}

function fieldValues(row: Record<string, unknown>, fields: string[]): string[] {
  const values: string[] = []
  for (const field of fields) {
    const value = row[field]
    if (value === undefined || value === null || value === '') continue
    if (field === 'price_breaks' && Array.isArray(value)) {
      for (const item of value) {
        const record = asRecord(item)
        if (!record) continue
        for (const key of ['qty', 'rmb', 'usd']) {
          const priceValue = record[key]
          if (typeof priceValue === 'string' || typeof priceValue === 'number') {
            values.push(String(priceValue))
          }
        }
      }
      continue
    }
    if (typeof value === 'string' || typeof value === 'number') {
      values.push(String(value))
    }
  }
  return [...new Set(values)].filter((value) => value.trim().length > 0)
}

function isInventoryLookupTool(tool: ToolEventSummary): boolean {
  if (tool.type !== 'tool_start') return false
  const text = toolIntentText(tool)
  return toolNameMatches(tool, 'procurement-local-inventory-lookup')
    // larkdepot(本地缓存,现行首选):base +record-search/+record-list 或 query sql
    || (
      tool.type === 'tool_start'
      && toolNameMatches(tool, 'Bash')
      && text.includes('larkdepot')
      && (text.includes('+record-search') || text.includes('+record-list') || text.includes('query'))
    )
    // lark-cli 直查飞书(降级路径)
    || (
      tool.type === 'tool_start'
      && toolNameMatches(tool, 'Bash')
      && text.includes('lark-cli')
      && text.includes('base')
      && (text.includes('+record-search') || text.includes('+record-list') || text.includes('+record-get'))
    )
}

// 平台 = 真货源渠道。注意:WebSearch/WebFetch 不算平台——业务 SOP 第 0 步
// 明确要求先上网"认料"(型号背景,≤3 次,不作货源证据),再查内部库存。
// 把认料计入平台曾造成大面积假违规(回归池 2/3 假红 + 产线 50+ 虚高)。
function isPlatformSearchTool(tool: ToolEventSummary): boolean {
  if (tool.type !== 'tool_start') return false
  const text = toolIntentText(tool)
  // 文本分支必须限定 Bash:Read 平台技能文件时 file_path 含关键词,
  // "读了关于平台的文档"不等于"上了平台"(产线 greeting 会话曾被误判违规)。
  return toolNameMatches(tool, 'procurement-platform-search')
    || (
      toolNameMatches(tool, 'Bash')
      && (text.includes('procurement-platform-search') || text.includes('browserdepot')
        || text.includes('scrape-engine') || text.includes('engine.py'))
    )
}

/** 认料工具:联网查型号背景。SOP 允许在库存前用,但限量(maxWebCalls)。 */
function isWebCognitionTool(tool: ToolEventSummary): boolean {
  return tool.type === 'tool_start'
    && (toolNameMatches(tool, 'WebSearch') || toolNameMatches(tool, 'WebFetch'))
}

function isSupplierShortlistTool(tool: ToolEventSummary): boolean {
  if (tool.type !== 'tool_start') return false
  const text = toolIntentText(tool)
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
    const text = toolIntentText(tool)
    if (normalized === 'websearch' || normalized === 'webfetch') return toolNameMatches(tool, expected)
    if (normalized === 'procurement-local-inventory-lookup') return isInventoryLookupTool(tool)
    if (normalized === 'procurement-platform-search' || normalized === 'scrape-engine') return isPlatformSearchTool(tool)
    if (normalized === 'procurement-supplier-shortlist') return isSupplierShortlistTool(tool)
    return toolNameMatches(tool, expected) || (tool.type === 'tool_start' && text.includes(normalized))
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
    const toolErrorCount = tools.filter((tool) => tool.type === 'tool_result' && tool.isError).length
    if (typeof trace.maxToolErrors === 'number' && toolErrorCount > trace.maxToolErrors) {
      failures.push(`too many tool errors: ${toolErrorCount} > ${trace.maxToolErrors}`)
    }
    const webCallCount = countToolStarts(tools, isWebCognitionTool)
    if (typeof trace.maxWebCalls === 'number' && webCallCount > trace.maxWebCalls) {
      failures.push(`too many web cognition calls: ${webCallCount} > ${trace.maxWebCalls}`)
    }

    const passed = failures.length === 0

    return result(
      passed,
      passed
        ? 'trace contract satisfied'
        : failures.join('; '),
      { inventoryIndex, platformIndex, supplierIndex, toolCallCount, bashCallCount, toolErrorCount, webCallCount },
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
    const text = allToolIntentText(tools)
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
    for (const command of contract.forbiddenCommands ?? []) {
      if (includesTerm(text, command)) forbiddenHits.push(`cmd:${command}`)
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

export const platformCoverageEvaluator = asExperimentEvaluator({
  name: 'platform_coverage',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const platform = expected.platform
    if (!platform) {
      return result(true, 'case does not define a platform contract')
    }

    const sourceIds = platform.sourceIds ?? []
    if (sourceIds.length === 0) {
      return result(true, 'platform contract does not define source ids')
    }

    const coverage = platformCoverage(
      outputFrom(params).toolEvents,
      sourceIds,
      platform.allowImplicitAllSources ?? true,
    )
    const ratio = coverage.covered.length / sourceIds.length
    const missing = sourceIds
      .map((source) => source.toLowerCase())
      .filter((source) => !coverage.covered.includes(source))
    const minCoverageRatio = platform.minCoverageRatio ?? (platform.requireAllSources ? 1 : 0)
    const passed = coverage.engineCallCount > 0
      && ratio >= minCoverageRatio
      && (!platform.requireAllSources || missing.length === 0)

    return result(
      passed,
      passed
        ? `platform coverage satisfied: ${coverage.covered.length}/${sourceIds.length}`
        : `platform coverage ${coverage.covered.length}/${sourceIds.length}; missing: ${missing.join(', ') || 'none'}`,
      {
        covered: coverage.covered,
        missing,
        ratio,
        implicitAll: coverage.implicitAll,
        engineCallCount: coverage.engineCallCount,
      },
    )
  },
})

export const platformAvailabilityReportEvaluator = asExperimentEvaluator({
  name: 'platform_availability_report',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const platform = expected.platform
    if (!platform?.requireAvailabilityReport) {
      return result(true, 'case does not require a platform availability report')
    }

    const answer = finalAnswerText(params)
    const sourceIds = platform.sourceIds ?? []
    const coverage = sourceIds.length > 0
      ? platformCoverage(outputFrom(params).toolEvents, sourceIds, platform.allowImplicitAllSources ?? true)
      : { covered: [], implicitAll: false, engineCallCount: 0 }
    const coverageTerms = sourceIds.length > 0
      ? [`${coverage.covered.length}/${sourceIds.length}`, `${Math.round((coverage.covered.length / sourceIds.length) * 100)}%`]
      : []
    const requiredTerms = [
      ...(platform.requiredStatusTerms ?? []),
      ...(platform.requiredReportFields ?? []),
    ]
    const missing = requiredTerms.filter((term) => !answer.includes(term))
    const mentionsCoverage = coverageTerms.length === 0
      || coverageTerms.some((term) => answer.includes(term))
      || answer.includes('全平台')
      || answer.includes('全部平台')
      || answer.includes('覆盖率')
    const failures: string[] = []

    if (missing.length > 0) failures.push(`missing availability/report terms: ${missing.join(', ')}`)
    if (!mentionsCoverage) failures.push(`missing coverage wording: expected one of ${coverageTerms.join(', ')}`)

    return result(
      failures.length === 0,
      failures.length === 0 ? 'platform availability report satisfied' : failures.join('; '),
      { missing, coverageTerms, coveredCount: coverage.covered.length, sourceCount: sourceIds.length },
    )
  },
})

export const platformDataPrecisionEvaluator = asExperimentEvaluator({
  name: 'platform_data_precision',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const platform = expected.platform
    const fields = platform?.requiredStructuredFields ?? []
    if (!platform || fields.length === 0) {
      return result(true, 'case does not define platform structured fields')
    }

    const answer = finalAnswerText(params)
    const sampleSize = platform.precisionSampleSize ?? 5
    const rows = enginePayloads(outputFrom(params).toolEvents).flatMap((payload) => payload.rows)
    const terms = rows
      .flatMap((row) => fieldValues(row, fields))
      .filter((term) => term.length >= 2)
      .slice(0, sampleSize)

    if (terms.length === 0) {
      return result(true, 'no structured platform values were available to precision-check', { checkedTerms: [] })
    }

    const missing = terms.filter((term) => !answer.includes(term))
    return result(
      missing.length === 0,
      missing.length === 0
        ? 'platform structured values preserved'
        : `missing structured platform values: ${missing.join(', ')}`,
      { checkedTerms: terms, missing },
    )
  },
})

export const substitutesContractEvaluator = asExperimentEvaluator({
  name: 'substitutes_contract',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    if (!expected.substitutes) {
      return result(true, 'case does not define a substitutes contract')
    }
    const answer = finalAnswerText(params)
    const payload = extractSubstitutesPayload(answer)
    const score = scoreSubstitutes(payload, expected.substitutes)
    return result(score.pass, score.reason, {
      recall: score.recall,
      precision: score.precision,
      recommended: score.recommended,
      hit: score.hit,
      missedMustFind: score.missedMustFind,
      forbiddenHit: score.forbiddenHit,
    })
  },
})

/** 按场景选 evaluator,不要全家桶空跑 */
export const EVALUATOR_SETS: Record<string, ReturnType<typeof asExperimentEvaluator>[]> = {
  substitutes: [outcomeEvaluator, substitutesContractEvaluator],
  inventory: [outcomeEvaluator, traceContractEvaluator, toolCallContractEvaluator, answerContractEvaluator, evidenceContractEvaluator],
  platform: [
    outcomeEvaluator,
    traceContractEvaluator,
    toolCallContractEvaluator,
    answerContractEvaluator,
    platformCoverageEvaluator,
    platformAvailabilityReportEvaluator,
    platformDataPrecisionEvaluator,
  ],
}

export function getEvaluators(scenario: string): ReturnType<typeof asExperimentEvaluator>[] {
  const set = EVALUATOR_SETS[scenario]
  if (!set) throw new Error(`Unknown evaluator scenario: ${scenario}. Available: ${Object.keys(EVALUATOR_SETS).join(', ')}`)
  return set
}
