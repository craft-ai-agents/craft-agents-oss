/**
 * 判分器(2026-07-06 全部重建):
 *
 * 铁律:判"agent 说的话与库存事实是否一致"(真值对账),不判"agent 走了哪条路"
 * (轨迹关键词税则已整体处决——每换一次工具就要改一次谓词,一个下午改了四次,
 *  那不是判分器,是特例工厂;git 历史里有尸体可考)。
 *
 * 三个判分器,零工具名感知:
 *  - execution_health      回合完成 + 工具错误数达标(错误由工具自己 throw,天然零税则)
 *  - ground_truth          harness 现场查 larkdepot 得地面真值,对账答案:
 *                          有货说成没货 = fail;编造名录里的供应商 = fail;
 *                          该报的型号/供应商/价格没报 = fail
 *  - substitutes_contract  替代料闭集(人工标注参考答案,方法论一直是对的,保留)
 *
 * LLM judge(SOP 语义类:认料结果是否被当货源证据等)留位未上:需先积累
 * 人工标注校准集验一致率(>80% 才可信),当前日会话量不足以喂。
 */
import { asExperimentEvaluator } from '@arizeai/phoenix-client/experiments'
import type { EvaluatorParams } from '@arizeai/phoenix-client/types/experiments'
import type { CraftEvalOutput, EvalTaskExpected } from './types'
import { extractSubstitutesPayload, scoreSubstitutes } from './substitutes'
import { fetchPartFacts, fetchSupplierDirectory } from './ground-truth'

// ============================================================
// 公共小件
// ============================================================

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

function finalAnswerText(params: EvaluatorParams): string {
  return outputFrom(params).finalAnswer
}

// ============================================================
// 执行健康度:回合完成 + 工具零(或限额)错误
// ============================================================

export const executionHealthEvaluator = asExperimentEvaluator({
  name: 'execution_health',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const output = outputFrom(params)
    const expected = expectedFrom(params)
    const maxToolErrors = expected.execution?.maxToolErrors ?? 0
    const toolErrorCount = output.toolEvents
      .filter((t) => t.type === 'tool_result' && t.isError).length
    const failures: string[] = []
    if (output.outcome !== 'complete' || output.finalAnswer.trim().length === 0) {
      failures.push(`outcome=${output.outcome}; answer ${output.finalAnswer.trim() ? 'present' : 'EMPTY'}`)
    }
    if (toolErrorCount > maxToolErrors) {
      const errs = output.toolEvents
        .filter((t) => t.type === 'tool_result' && t.isError)
        .map((t) => t.toolName ?? '?')
      failures.push(`tool errors ${toolErrorCount} > ${maxToolErrors} (${errs.join(', ')})`)
    }
    const passed = failures.length === 0
    return result(
      passed,
      passed ? `completed; ${toolErrorCount} tool errors (≤${maxToolErrors})` : failures.join('; '),
      { toolErrorCount, sessionId: output.sessionId },
    )
  },
})

// 兼容 substitutes 场景沿用的 outcome 判分器
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

// ============================================================
// 真值对账:答案 vs larkdepot 地面真值
// ============================================================

/** 答案里的"查无/没货"语汇——判可得性极性用。针对答案语言,不针对工具,跨工具升级稳定。 */
const NEGATIVE_MARKERS = ['没有找到', '未找到', '没找到', '查无', '无库存', '没有库存', '没货', '无货', '没有现货', '无现货', '没有相关记录', '无记录']

function hasNegativeAvailabilityClaim(answer: string): boolean {
  return NEGATIVE_MARKERS.some((m) => answer.includes(m))
}

export const groundTruthEvaluator = asExperimentEvaluator({
  name: 'ground_truth',
  kind: 'CODE',
  evaluate: (params: EvaluatorParams) => {
    const expected = expectedFrom(params)
    const spec = expected.groundTruth
    if (!spec?.part) {
      return result(true, 'case does not define ground truth')
    }
    const answer = finalAnswerText(params)

    let facts
    let directory: string[]
    try {
      facts = fetchPartFacts(spec.part)
      directory = fetchSupplierDirectory()
    } catch (e) {
      return result(false,
        `真值不可用(larkdepot 查询失败,只能在生产环境跑): ${e instanceof Error ? e.message : e}`)
    }

    const failures: string[] = []
    const negative = hasNegativeAvailabilityClaim(answer)

    if (facts.available) {
      // 库存里真实有货:
      // 1) 极性——不许说没货(除非答案同时给出了真实供应商,说明"没货"指别的层面)
      const mentionedTrueSuppliers = facts.suppliers.filter((s) => s.length >= 3 && answer.includes(s))
      if (negative && mentionedTrueSuppliers.length === 0) {
        failures.push(`库存实有 ${facts.rowCount} 行(${Object.keys(facts.tables).join('/')}),答案却称查无`)
      }
      // 2) 型号召回——答案必须出现至少一个缓存里的规范型号写法
      const mpnHit = facts.canonicalMpns.some((m) => m.length >= 4 && answer.toUpperCase().includes(m.toUpperCase()))
      if (!mpnHit) {
        failures.push(`答案未出现任何规范型号写法(真值: ${facts.canonicalMpns.slice(0, 3).join(', ')})`)
      }
      // 3) 供应商召回——至少报出 min(要求数, 真值供应商数) 家真实供应商
      const need = Math.min(spec.minSupplierMentions ?? 1, facts.suppliers.length)
      if (mentionedTrueSuppliers.length < need) {
        failures.push(`真实供应商 ${facts.suppliers.length} 家,答案只报出 ${mentionedTrueSuppliers.length} 家(要求 ≥${need};真值样例: ${facts.suppliers.slice(0, 3).join(', ')})`)
      }
      // 4) 价格召回(可选)——答案至少含一个真实价格数字
      if (spec.requirePriceMention) {
        const priceHit = facts.priceTokens.some((p) => answer.includes(p))
        if (!priceHit && facts.priceTokens.length > 0) {
          failures.push(`答案未报出任何真实价格(真值样例: ${facts.priceTokens.slice(0, 3).join(', ')})`)
        }
      }
    } else {
      // 库存里确实没有:答案必须如实说没有——空结果是权威答案,编出货源是重罪
      if (!negative) {
        failures.push('库存查无此料,答案却没有明确说"没有找到"')
      }
    }

    // 5) 编造检测(两种可得性都查):答案里出现"在供应商名录里、却不在本型号真值集"的名字
    const trueSet = new Set(facts.suppliers)
    const confabulated = directory.filter((name) => !trueSet.has(name) && answer.includes(name))
    if (confabulated.length > 0) {
      failures.push(`答案提到名录供应商但该料真值里没有(疑似编造): ${confabulated.slice(0, 3).join(', ')}`)
    }

    const passed = failures.length === 0
    return result(
      passed,
      passed
        ? `与库存事实一致(${facts.available ? `${facts.rowCount} 行 / ${facts.suppliers.length} 家供应商` : '查无,如实报告'})`
        : failures.join('; '),
      {
        available: facts.available,
        rowCount: facts.rowCount,
        tables: facts.tables,
        trueSupplierCount: facts.suppliers.length,
        confabulated,
      },
    )
  },
})

// ============================================================
// 替代料闭集(人工标注参考答案)
// ============================================================

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
  regression: [executionHealthEvaluator, groundTruthEvaluator],
  substitutes: [outcomeEvaluator, substitutesContractEvaluator],
}

export function getEvaluators(scenario: string): ReturnType<typeof asExperimentEvaluator>[] {
  const set = EVALUATOR_SETS[scenario]
  if (!set) throw new Error(`Unknown evaluator scenario: ${scenario}. Available: ${Object.keys(EVALUATOR_SETS).join(', ')}`)
  return set
}
