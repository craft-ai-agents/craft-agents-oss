import { describe, it, expect } from 'bun:test'
import { TASK_FORMS, isFormComplete, getTaskForm } from '../task-forms'

describe('task-forms registry', () => {
  it('恰好 5 个工作流任务且 id 唯一', () => {
    expect(TASK_FORMS.length).toBe(5)
    const ids = TASK_FORMS.map((f) => f.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('批量找料 → batch 触发语含清单 + 批量关键词', () => {
    const msg = getTaskForm('batch')!.toMessage({ parts: 'TPS92550TZX\nTLP350\nNE555' })
    expect(msg).toContain('批量找料')
    expect(msg).toContain('TPS92550TZX')
    expect(msg).toContain('TLP350')
  })

  it('找料 → inventory-first 触发语', () => {
    const msg = getTaskForm('find')!.toMessage({ mpn: 'TPS92550TZX' })
    expect(msg).toContain('帮我找一下 TPS92550TZX')
    expect(msg).toContain('本地库存')
  })

  it('找替代料 → alternative-search 触发语', () => {
    const msg = getTaskForm('alt')!.toMessage({ mpn: 'TLP350' })
    expect(msg).toContain('帮我找 TLP350 的替代料')
  })

  it('替代料判断 → 含两个型号 + 替代触发词', () => {
    const msg = getTaskForm('compare')!.toMessage({ need: 'A', quote: 'B' })
    expect(msg).toContain('需求型号 A')
    expect(msg).toContain('报价型号 B')
    expect(msg).toContain('能不能替代')
  })

  it('生成单据 → doc-export 触发语', () => {
    expect(getTaskForm('doc')!.toMessage({ source: '飞书订单123', template: '美金请款发票 PI' }))
      .toBe('把 飞书订单123 这单按 美金请款发票 PI 生成请款单（PI）')
  })

  it('toMessage 去空白、缺值不产出 undefined', () => {
    expect(getTaskForm('find')!.toMessage({ mpn: '  X  ' })).toContain('帮我找一下 X')
    expect(getTaskForm('find')!.toMessage({})).not.toContain('undefined')
  })

  it('isFormComplete 要求所有必填字段非空', () => {
    const find = getTaskForm('find')!
    expect(isFormComplete(find, {})).toBe(false)
    expect(isFormComplete(find, { mpn: '  ' })).toBe(false)
    expect(isFormComplete(find, { mpn: 'X' })).toBe(true)
  })

  it('isFormComplete 对 select 字段:空则不完整,选中则完整', () => {
    const doc = getTaskForm('doc')!
    expect(isFormComplete(doc, { source: 'X' })).toBe(false) // template 未选
    expect(isFormComplete(doc, { source: 'X', template: '美金请款发票 PI' })).toBe(true)
  })
})
