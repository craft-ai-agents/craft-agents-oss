import { describe, it, expect } from 'bun:test'
import { getDefaultLabelConfig } from '../storage.ts'
import { evaluateAutoLabels } from '../auto/index.ts'

// The default procurement labels carry autoRules that must classify each
// task-launcher message (apps/webui .../input/task-forms.ts `toMessage`) to
// exactly one task type — patterns must not cross-match between the five.
const LABELS = getDefaultLabelConfig().labels

function hitIds(message: string): string[] {
  return [...new Set(evaluateAutoLabels(message, LABELS).map((m) => m.labelId))].sort()
}

describe('default procurement auto-label rules', () => {
  // [expected labelId, exact launcher message from task-forms toMessage()]
  const CASES: Array<[string, string]> = [
    ['find', '帮我找一下 TPS92550TZX'],
    ['alternative', '帮我找 TLP350 的替代料'],
    ['compare', '需求型号 A，报价型号 B，这俩能不能替代、有没有区别？'],
    ['supplier', '帮我按 Omron 补几个供应商候选'],
    ['doc', '把 飞书订单123 这单按 美金请款发票 PI 生成请款单（PI）'],
  ]

  for (const [expectedId, message] of CASES) {
    it(`「${message}」只命中 ${expectedId}`, () => {
      expect(hitIds(message)).toEqual([expectedId])
    })
  }

  it('无关消息不命中任何任务标签', () => {
    expect(hitIds('你好，今天天气怎么样')).toEqual([])
  })
})
