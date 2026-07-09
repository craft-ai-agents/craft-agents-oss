import { describe, it, expect } from 'bun:test'
import { buildDocPayload, splitCsvLines, payloadPreviewMarkdown } from '../doc-form-payload'
import { docToMessage, getTaskForm } from '../task-forms'

describe('doc-form-payload E2E mapping', () => {
  it('splitCsvLines 支持中英文逗号', () => {
    expect(splitCsvLines('A,1,2\nB，3，4')).toEqual([
      ['A', '1', '2'],
      ['B', '3', '4'],
    ])
  })

  it('見積書 → context.items 含 unit/dc/lead_time', () => {
    const p = buildDocPayload('見積書', {
      date: '2025.6.12',
      to: 'ACME',
      currency: 'USD',
      lines: '5CB1G97586,3,26,PCS,NA,2週間',
    })
    expect(p.mode).toBe('render')
    expect(p.template).toBe('見積書')
    expect(p.context.to).toBe('ACME')
    expect(p.context.currency).toBe('USD')
    const items = p.context.items as Record<string, unknown>[]
    expect(items[0].part).toBe('5CB1G97586')
    expect(items[0].qty).toBe(3)
    expect(items[0].price).toBe(26)
    expect(items[0].unit).toBe('PCS')
    expect(items[0].dc).toBe('NA')
    expect(items[0].lead_time).toBe('2週間')
  })

  it('日本請求書 → 三币种单价', () => {
    const p = buildDocPayload('日本請求書（イノ間）', {
      invoice_no: 'OD-1',
      invoice_date: '2026-07-09',
      fx_rmb: '22.5',
      fx_usd: '160',
      lines: 'MPN,5,USD,50',
    })
    const items = p.context.items as Record<string, unknown>[]
    expect(items[0].unit_price_usd).toBe(50)
    expect(p.context.fx_rmb).toBe(22.5)
  })

  it('中文合同 tax_mode 映射', () => {
    const p = buildDocPayload('深圳印诺采购合同（中文）', {
      po_number: 'PO-1',
      po_date: '2026-07-09',
      supplier_name: '供方A',
      tax_mode: '未税',
      lines: 'ST,STM32,100,3.2,PCS',
    })
    expect(p.context.tax_mode).toBe('exclusive')
    const items = p.context.items as Record<string, unknown>[]
    expect(items[0].brand).toBe('ST')
    expect(items[0].part).toBe('STM32')
  })

  it('美金 PI 仅 source → feishu_order', () => {
    const p = buildDocPayload('美金请款发票 PI', { source: 'ORD-99' })
    expect(p.mode).toBe('feishu_order')
    expect(p.context.order).toBe('ORD-99')
  })

  it('对冲 purchase_lines + sales_lines', () => {
    const p = buildDocPayload('对冲结算书', {
      order_no: 'INSZ-1',
      party_b: '乙方',
      lines: 'P-BUY,1,10,12',
      sales_lines: 'P-SELL,2,20',
    })
    const pl = p.context.purchase_lines as Record<string, unknown>[]
    expect(pl[0].sales_price).toBe(12)
    const sl = p.context.sales_lines as Record<string, unknown>[]
    expect(sl[0].part).toBe('P-SELL')
  })

  it('docToMessage 含 doc-export-json 代码块', () => {
    const msg = docToMessage('見積書', {
      date: '2026-07-09',
      to: 'TO-CO',
      currency: 'JPY',
      lines: 'A,1,2,PCS',
    })
    expect(msg).toContain('```doc-export-json')
    expect(msg).toContain('render_from_form.py')
    expect(msg).toContain('"template": "見積書"')
    expect(msg).toContain('"part": "A"')
  })

  it('TaskBar 見積提交消息可 JSON 解析', () => {
    const msg = getTaskForm('doc-quotation')!.toMessage({
      date: '2026-07-09',
      to: 'X',
      currency: 'JPY',
      lines: 'P,2,3,PCS,NA,1w',
    })
    const m = msg.match(/```doc-export-json\n([\s\S]*?)\n```/)
    expect(m).toBeTruthy()
    const payload = JSON.parse(m![1])
    expect(payload.template).toBe('見積書')
    expect(payload.context.items[0].qty).toBe(2)
  })

  it('preview markdown 含表格', () => {
    const p = buildDocPayload('国内送货单', {
      receiver_company: 'A',
      receiver_address: 'B',
      lines: 'DOM,10,PCS',
    })
    const md = payloadPreviewMarkdown(p)
    expect(md).toContain('DOM')
    expect(md).toContain('|')
  })
})
