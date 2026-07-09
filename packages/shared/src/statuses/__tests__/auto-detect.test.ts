import { describe, it, expect } from 'bun:test'
import { detectTaskStatus, TASK_STATUS_IDS } from '../auto-detect.ts'

// Each task-launcher message (apps/webui .../input/task-forms.ts `toMessage`) must
// map to exactly one procurement task-type status — patterns must not cross-match.
describe('detectTaskStatus', () => {
  // [exact launcher message, expected status id]
  const CASES: Array<[string, string]> = [
    ['帮我找一下 TPS92550TZX', 'find'],
    // 完整真实文案(含"能否替代的结论"),曾经因 compare 正则排在前面被误判成 compare
    [
      '帮我找 TLP350 的替代料：给 pin-to-pin 和功能替代候选，逐项说明关键参数差异（封装 / 电压 / 电流 / 精度 / 温度等）和能否替代的结论，并标注品牌、货源和大致价格。',
      'alternative',
    ],
    ['需求型号 A，报价型号 B，这俩能不能替代、有没有区别？', 'compare'],
    ['帮我按 Omron 补几个供应商候选', 'supplier'],
    ['把 飞书订单123 这单按 美金请款发票 PI 生成请款单（PI）', 'doc'],
  ]

  for (const [message, expected] of CASES) {
    it(`「${message}」→ ${expected}`, () => {
      expect(detectTaskStatus(message)).toBe(expected)
    })
  }

  it('无关消息 → null', () => {
    expect(detectTaskStatus('你好，今天天气怎么样')).toBeNull()
  })

  it('每个返回值都是合法状态 id', () => {
    for (const [message] of CASES) {
      expect(TASK_STATUS_IDS).toContain(detectTaskStatus(message)!)
    }
  })
})
