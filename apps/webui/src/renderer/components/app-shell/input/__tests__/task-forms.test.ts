import { describe, it, expect } from 'bun:test'
import {
  TASK_FORMS,
  WORKFLOW_TASK_FORMS,
  DOC_TASK_FORMS,
  isFormComplete,
  getTaskForm,
  getDocFieldsForTemplate,
  docToMessage,
  DOC_TEMPLATE_NAMES,
} from '../task-forms'

describe('task-forms registry', () => {
  it('工作流 4 + 单据 13 = 17，id 唯一', () => {
    expect(WORKFLOW_TASK_FORMS.length).toBe(4)
    expect(DOC_TASK_FORMS.length).toBe(13)
    expect(TASK_FORMS.length).toBe(17)
    expect(new Set(TASK_FORMS.map((f) => f.id)).size).toBe(17)
  })

  it('无总入口 doc；每模板独立且无 template select', () => {
    expect(getTaskForm('doc')).toBeUndefined()
    for (const form of DOC_TASK_FORMS) {
      expect(form.group).toBe('doc')
      expect(form.fields.some((f) => f.key === 'template')).toBe(false)
    }
  })

  it('DOC_TEMPLATE_NAMES 13 个', () => {
    expect(DOC_TEMPLATE_NAMES.length).toBe(13)
  })

  it('見積書 字段对齐 sample 级：日期/TO/币种/明细列说明', () => {
    const keys = getDocFieldsForTemplate('見積書').map((f) => f.key)
    expect(keys).toContain('date')
    expect(keys).toContain('to')
    expect(keys).toContain('currency')
    expect(keys).toContain('lines')
    expect(keys).toContain('from_block')
    const lines = getDocFieldsForTemplate('見積書').find((f) => f.key === 'lines')!
    expect(lines.placeholder).toContain('DC')
    expect(lines.placeholder).toContain('货期')
  })

  it('日本請求書 含汇率与三币种明细约定', () => {
    const keys = getDocFieldsForTemplate('日本請求書（イノ間）').map((f) => f.key)
    for (const k of ['invoice_no', 'invoice_date', 'fx_rmb', 'fx_usd', 'lines', 'import_tax_jpy']) {
      expect(keys).toContain(k)
    }
    const msg = getTaskForm('doc-jp-invoice')!.toMessage({
      invoice_no: 'OD-1',
      invoice_date: '2026-07-09',
      fx_rmb: '22.5',
      fx_usd: '160',
      lines: 'MPN,5,USD,50',
    })
    expect(msg).toContain('日本請求書')
    expect(msg).toContain('```doc-export-json')
    expect(msg).toContain('"fx_rmb": 22.5')
    expect(msg).toContain('"unit_price_usd": 50')
  })

  it('竹菱 PI 含 Bill/Ship/Tracking 等 sample 字段', () => {
    const keys = getDocFieldsForTemplate('竹菱 PI').map((f) => f.key)
    for (const k of [
      'invoice_no',
      'invoice_date',
      'po_number',
      'terms',
      'ship_via',
      'tracking_no',
      'bill_to',
      'ship_to',
      'lines',
    ]) {
      expect(keys).toContain(k)
    }
  })

  it('取扱手数料 要求番号日期与手续费明细', () => {
    const fee = getTaskForm('doc-takebishi-fee')!
    expect(isFormComplete(fee, {})).toBe(false)
    expect(
      isFormComplete(fee, {
        invoice_no: 'F1',
        invoice_date: '2026年7月7日',
        lines: '手数料,1,5661,一式',
      }),
    ).toBe(true)
    const msg = fee.toMessage({
      invoice_no: 'F1',
      invoice_date: '2026年7月7日',
      lines: 'CB01 取扱手数料,1,5661,一式',
    })
    expect(msg).toContain('取扱手数料')
    expect(msg).toContain('5661')
  })

  it('FAR / 中文合同 / 英文合同 完整字段', () => {
    const far = getDocFieldsForTemplate('FAR 采购订单').map((f) => f.key)
    expect(far).toContain('po_number')
    expect(far).toContain('po_date')
    expect(far).toContain('supplier_name')
    expect(far).toContain('supplier_address')

    const sz = getDocFieldsForTemplate('深圳印诺采购合同（中文）').map((f) => f.key)
    expect(sz).toContain('tax_mode')

    const en = getDocFieldsForTemplate('印诺英文采购合同').map((f) => f.key)
    for (const k of ['ship_to_mode', 'ship_to', 'bill_to', 'terms', 'ship_via', 'contact']) {
      expect(en).toContain(k)
    }
  })

  it('不报关 / 出口 / 进口 / 送货 / 对冲 字段覆盖 render 已支持 key', () => {
    const nd = getDocFieldsForTemplate('不报关出口资料').map((f) => f.key)
    for (const k of ['po_number', 'sold_to_company', 'sold_to_address', 'hs_code', 'cartons']) {
      expect(nd).toContain(k)
    }

    const ex = getDocFieldsForTemplate('出口报关').map((f) => f.key)
    for (const k of ['currency_set', 'transport', 'trade_country', 'hs_code', 'sold_to_company']) {
      expect(ex).toContain(k)
    }
    // 币种套与脚本一致
    const cs = getDocFieldsForTemplate('出口报关').find((f) => f.key === 'currency_set')!
    expect(cs.options).toEqual(['cny', 'usd', 'jpy1039'])

    const imp = getDocFieldsForTemplate('进口报关').map((f) => f.key)
    expect(imp).toContain('contract_no')
    expect(imp).toContain('seller_company')

    const dom = getDocFieldsForTemplate('国内送货单').map((f) => f.key)
    expect(dom).toContain('receiver_company')
    expect(dom).toContain('receiver_address')

    const hedge = getDocFieldsForTemplate('对冲结算书').map((f) => f.key)
    for (const k of ['order_no', 'party_b', 'lines', 'sales_lines', 'receivable_cn', 'net_cn']) {
      expect(hedge).toContain(k)
    }
  })

  it('美金 PI 短触发语 + feishu_order payload', () => {
    const msg = getTaskForm('doc-pi')!.toMessage({ source: '飞书订单123' })
    expect(msg).toContain('把 飞书订单123 这单按 美金请款发票 PI 生成请款单（PI）')
    expect(msg).toContain('"mode": "feishu_order"')
    expect(msg).toContain('render_from_form.py')
  })

  it('見積 toMessage 含 sample 级 JSON payload', () => {
    const msg = docToMessage('見積書', {
      date: '2025.6.12',
      to: 'ACME KK',
      currency: 'USD',
      lines: '5CB1G97586,3,26,PCS,NA,2週間',
    })
    expect(msg).toContain('見積書')
    expect(msg).toContain('"date": "2025.6.12"')
    expect(msg).toContain('"to": "ACME KK"')
    expect(msg).toContain('"currency": "USD"')
    expect(msg).toContain('5CB1G97586')
    expect(msg).toContain('### 预览')
    expect(msg).toContain('render_from_form.py')
  })

  it('国内送货 isFormComplete', () => {
    const form = getTaskForm('doc-domestic')!
    expect(isFormComplete(form, { receiver_company: 'A' })).toBe(false)
    expect(
      isFormComplete(form, {
        receiver_company: 'A',
        receiver_address: '深圳…',
        lines: 'P,1,PCS',
      }),
    ).toBe(true)
  })

  it('工作流触发语不回归', () => {
    expect(getTaskForm('find')!.toMessage({ mpn: 'X' })).toContain('帮我找一下 X')
    expect(getTaskForm('batch')!.toMessage({ parts: 'A\nB' })).toContain('批量找料')
    expect(getTaskForm('alt')!.toMessage({ mpn: 'Y' })).toContain('替代料')
    expect(getTaskForm('compare')!.toMessage({ need: 'A', quote: 'B' })).toContain('能不能替代')
  })
})
