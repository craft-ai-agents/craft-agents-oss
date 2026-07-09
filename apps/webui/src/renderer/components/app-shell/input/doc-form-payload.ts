/**
 * TaskBar 表单值 → procurement-doc-export render context JSON。
 * 与 scripts/render_from_form.py 的 payload 形状一致。
 *
 * 注意：本文件不 import task-forms，避免循环依赖；template 用 string 联合字面量。
 */

export type DocPayloadTemplate =
  | '美金请款发票 PI'
  | '日本請求書（イノ間）'
  | '見積書'
  | '竹菱 PI'
  | '取扱手数料'
  | 'FAR 采购订单'
  | '深圳印诺采购合同（中文）'
  | '印诺英文采购合同'
  | '不报关出口资料'
  | '出口报关'
  | '进口报关'
  | '国内送货单'
  | '对冲结算书'

export interface DocExportPayload {
  /** skill/catalog 正式模板名 */
  template: DocPayloadTemplate
  /** 直接喂给对应 render_*.py 的 context */
  context: Record<string, unknown>
  /** 美金 PI 仅订单号时：需要飞书拉单 */
  mode?: 'render' | 'feishu_order'
}

function v(values: Record<string, string>, key: string): string {
  return (values[key] ?? '').trim()
}

function numOrRaw(s: string): number | string {
  const t = s.trim()
  if (t === '') return ''
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : t
}

/** 按行拆 CSV（支持中英文逗号、tab） */
export function splitCsvLines(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,，\t]/).map((c) => c.trim()))
}

function firstLineNameAddress(block: string): { name: string; address: string } {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return { name: '', address: '' }
  return { name: lines[0], address: lines.slice(1).join('\n') }
}

/** 通用货品行：型号,数量,单价[,描述…] */
function itemsSimple(lines: string, extraKeys: string[] = []): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, price, ...rest] = cols
    const it: Record<string, unknown> = {
      part: part || '',
      qty: qty !== undefined && qty !== '' ? numOrRaw(qty) : undefined,
      price: price !== undefined && price !== '' ? numOrRaw(price) : undefined,
    }
    if (rest[0]) it.desc = rest[0]
    for (let i = 0; i < extraKeys.length && i + 1 < rest.length; i++) {
      // rest[0] already desc if present; extra from rest[1+]
      if (rest[i + 1] !== undefined && rest[i + 1] !== '') it[extraKeys[i]] = rest[i + 1]
    }
    return it
  })
}

/** 見積：型号,数量,单价,单位,DC,货期 */
function itemsQuotation(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, price, unit, dc, lead] = cols
    return {
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
      price: price ? numOrRaw(price) : undefined,
      unit: unit || 'PCS',
      dc: dc || '',
      lead_time: lead || '',
    }
  })
}

/** 日本請求書：型号,数量,币种,单价 */
function itemsJp(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, ccy, price] = cols
    const it: Record<string, unknown> = {
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
    }
    const cur = (ccy || 'JPY').toUpperCase()
    const p = price ? numOrRaw(price) : undefined
    if (cur === 'RMB' || cur === 'CNY') it.unit_price_rmb = p
    else if (cur === 'USD' || cur === 'US') it.unit_price_usd = p
    else it.unit_price_jpy = p
    return it
  })
}

/** FAR/中文 PO：品牌,型号,数量,单价,单位,批次,交货期[,备注]；也兼容 型号,数量,单价 */
function itemsPoZh(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    // 型号,数量,单价
    if (cols.length === 3) {
      const [part, qty, price] = cols
      return {
        part: part || '',
        qty: qty ? numOrRaw(qty) : undefined,
        price: price ? numOrRaw(price) : undefined,
        unit: 'PCS',
      }
    }
    const [brand, part, qty, price, unit, batch, delivery, note] = cols
    return {
      brand: brand || '',
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
      price: price ? numOrRaw(price) : undefined,
      unit: unit || 'PCS',
      batch: batch || '',
      delivery: delivery || '',
      note: note || '',
    }
  })
}

/** 英文 PO：型号,数量,单价,描述,DC */
function itemsPoEn(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, price, desc, dc] = cols
    return {
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
      price: price ? numOrRaw(price) : undefined,
      desc: desc || '',
      dc: dc || '',
    }
  })
}

/** 国内送货：型号,数量,单位,备注 */
function itemsDomestic(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, unit, note] = cols
    return {
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
      unit: unit || 'PCS',
      note: note || '',
    }
  })
}

/** 对冲采购：型号,数量,采购价[,销售价] */
function purchaseLines(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, price, sales] = cols
    const it: Record<string, unknown> = {
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
      price: price ? numOrRaw(price) : undefined,
    }
    if (sales) it.sales_price = numOrRaw(sales)
    return it
  })
}

function salesLines(lines: string): Record<string, unknown>[] {
  return splitCsvLines(lines).map((cols) => {
    const [part, qty, price] = cols
    return {
      part: part || '',
      qty: qty ? numOrRaw(qty) : undefined,
      price: price ? numOrRaw(price) : undefined,
    }
  })
}

function setIf(ctx: Record<string, unknown>, key: string, value: string) {
  if (value) ctx[key] = value
}

/**
 * 表单扁平字段 → 对应 render 脚本的 context。
 */
export function buildDocPayload(
  template: DocPayloadTemplate,
  values: Record<string, string>,
): DocExportPayload {
  const g = (k: string) => v(values, k)
  const ctx: Record<string, unknown> = {}

  // 美金 PI：仅订单号 → 飞书拉单路径
  if (template === '美金请款发票 PI' && !g('lines')) {
    return {
      template,
      context: { order: g('source'), source: g('source') },
      mode: 'feishu_order',
    }
  }

  switch (template) {
    case '美金请款发票 PI': {
      setIf(ctx, 'invoice_no', g('source'))
      setIf(ctx, 'po_number', g('source'))
      if (g('lines')) ctx.items = itemsSimple(g('lines'))
      break
    }
    case '日本請求書（イノ間）': {
      setIf(ctx, 'invoice_no', g('invoice_no'))
      setIf(ctx, 'invoice_date', g('invoice_date'))
      setIf(ctx, 'subject', g('subject'))
      if (g('fx_rmb')) ctx.fx_rmb = numOrRaw(g('fx_rmb'))
      if (g('fx_usd')) ctx.fx_usd = numOrRaw(g('fx_usd'))
      if (g('lines')) ctx.items = itemsJp(g('lines'))
      if (g('shipping_qty') || g('shipping_price')) {
        ctx.shipping = {
          qty: g('shipping_qty') ? numOrRaw(g('shipping_qty')) : 0,
          unit_price_jpy: g('shipping_price') ? numOrRaw(g('shipping_price')) : 0,
        }
      }
      if (g('import_tax_jpy')) ctx.import_tax_jpy = numOrRaw(g('import_tax_jpy'))
      setIf(ctx, 'customer', g('customer'))
      setIf(ctx, 'source', g('source'))
      break
    }
    case '見積書': {
      setIf(ctx, 'date', g('date'))
      setIf(ctx, 'to', g('to'))
      setIf(ctx, 'from_block', g('from_block'))
      setIf(ctx, 'currency', g('currency') || 'JPY')
      if (g('lines')) ctx.items = itemsQuotation(g('lines'))
      setIf(ctx, 'source', g('source'))
      break
    }
    case '竹菱 PI': {
      setIf(ctx, 'invoice_no', g('invoice_no'))
      setIf(ctx, 'invoice_date', g('invoice_date'))
      setIf(ctx, 'po_number', g('po_number'))
      setIf(ctx, 'terms', g('terms') || 'DDU')
      setIf(ctx, 'ship_date', g('ship_date') || g('invoice_date'))
      setIf(ctx, 'ship_via', g('ship_via'))
      setIf(ctx, 'tracking_no', g('tracking_no'))
      if (g('bill_to')) {
        const b = firstLineNameAddress(g('bill_to'))
        ctx.bill_to = { name: b.name, address: b.address }
      }
      if (g('ship_to')) {
        const s = firstLineNameAddress(g('ship_to'))
        ctx.ship_to = { name: s.name, address: s.address }
      }
      if (g('lines')) ctx.items = itemsSimple(g('lines'))
      setIf(ctx, 'source', g('source'))
      break
    }
    case '取扱手数料': {
      setIf(ctx, 'invoice_no', g('invoice_no'))
      setIf(ctx, 'invoice_date', g('invoice_date'))
      setIf(ctx, 'subject', g('subject'))
      if (g('lines')) {
        ctx.items = splitCsvLines(g('lines')).map((cols) => {
          const [part, qty, price, unit] = cols
          return {
            part: part || '',
            qty: qty ? numOrRaw(qty) : 1,
            price: price ? numOrRaw(price) : undefined,
            unit: unit || '式',
          }
        })
      }
      setIf(ctx, 'source', g('source'))
      break
    }
    case 'FAR 采购订单': {
      setIf(ctx, 'po_number', g('po_number'))
      setIf(ctx, 'po_date', g('po_date'))
      setIf(ctx, 'supplier_name', g('supplier_name'))
      setIf(ctx, 'supplier_contact', g('supplier_contact'))
      setIf(ctx, 'supplier_phone', g('supplier_phone'))
      setIf(ctx, 'supplier_address', g('supplier_address'))
      setIf(ctx, 'ship_address', g('ship_address'))
      if (g('lines')) ctx.items = itemsPoZh(g('lines'))
      break
    }
    case '深圳印诺采购合同（中文）': {
      setIf(ctx, 'po_number', g('po_number'))
      setIf(ctx, 'po_date', g('po_date'))
      setIf(ctx, 'supplier_name', g('supplier_name'))
      setIf(ctx, 'supplier_contact', g('supplier_contact'))
      setIf(ctx, 'supplier_phone', g('supplier_phone'))
      setIf(ctx, 'supplier_address', g('supplier_address'))
      const tax = g('tax_mode')
      ctx.tax_mode = tax === '未税' ? 'exclusive' : 'inclusive'
      if (g('lines')) ctx.items = itemsPoZh(g('lines'))
      break
    }
    case '印诺英文采购合同': {
      setIf(ctx, 'po_number', g('po_number'))
      const mode = g('ship_to_mode')
      ctx.ship_to_mode = mode === '日本仓' ? 'japan' : 'shenzhen'
      setIf(ctx, 'currency', g('currency') || 'USD')
      setIf(ctx, 'po_sent_by', g('po_sent_by'))
      setIf(ctx, 'ship_via', g('ship_via'))
      setIf(ctx, 'terms', g('terms'))
      setIf(ctx, 'delivery_date', g('delivery_date'))
      setIf(ctx, 'supplier_name', g('supplier_name'))
      setIf(ctx, 'supplier_address', g('supplier_address'))
      setIf(ctx, 'ship_to', g('ship_to'))
      setIf(ctx, 'bill_to', g('bill_to'))
      setIf(ctx, 'contact', g('contact'))
      setIf(ctx, 'tel', g('tel'))
      setIf(ctx, 'email', g('email'))
      if (g('lines')) ctx.items = itemsPoEn(g('lines'))
      break
    }
    case '不报关出口资料': {
      setIf(ctx, 'po_number', g('po_number'))
      if (g('sold_to_company') || g('sold_to_address')) {
        ctx.sold_to = { company: g('sold_to_company'), address: g('sold_to_address') }
      }
      if (g('seller_company') || g('seller_address')) {
        ctx.seller = { company: g('seller_company'), address: g('seller_address') }
      }
      if (g('ship_to_name') || g('ship_to_phone')) {
        ctx.ship_to = { name: g('ship_to_name'), phone: g('ship_to_phone') }
      }
      if (g('bill_to_block')) ctx.bill_to = { block: g('bill_to_block') }
      setIf(ctx, 'date_y', g('date_y'))
      setIf(ctx, 'date_m', g('date_m'))
      setIf(ctx, 'date_d', g('date_d'))
      setIf(ctx, 'brand', g('brand'))
      setIf(ctx, 'description_en', g('description_en'))
      setIf(ctx, 'material_en', g('material_en'))
      setIf(ctx, 'hs_code', g('hs_code'))
      setIf(ctx, 'cartons', g('cartons'))
      if (g('lines')) {
        ctx.items = itemsSimple(g('lines'))
        const it0 = (ctx.items as Record<string, unknown>[])[0]
        if (it0?.part) ctx.part = it0.part
        if (it0?.desc) ctx.description_en = ctx.description_en || it0.desc
      }
      setIf(ctx, 'source', g('source'))
      break
    }
    case '出口报关': {
      setIf(ctx, 'currency_set', g('currency_set') || 'cny')
      setIf(ctx, 'transport', g('transport'))
      if (g('freight')) ctx.freight = numOrRaw(g('freight'))
      setIf(ctx, 'ship_date', g('ship_date'))
      setIf(ctx, 'trade_country', g('trade_country'))
      setIf(ctx, 'trade_country_en', g('trade_country_en'))
      setIf(ctx, 'description_en', g('description_en'))
      setIf(ctx, 'description_cn', g('description_cn'))
      setIf(ctx, 'unit', g('unit'))
      setIf(ctx, 'currency', g('currency'))
      setIf(ctx, 'origin', g('origin'))
      setIf(ctx, 'hs_code', g('hs_code'))
      if (g('sold_to_company') || g('sold_to_address')) {
        ctx.sold_to = { company: g('sold_to_company'), address: g('sold_to_address') }
      }
      if (g('seller_company') || g('seller_address')) {
        ctx.seller = { company: g('seller_company'), address: g('seller_address') }
      }
      if (g('lines')) {
        ctx.items = splitCsvLines(g('lines')).map((cols) => {
          const [part, qty, price, brand] = cols
          return {
            part: part || '',
            qty: qty ? numOrRaw(qty) : undefined,
            price: price ? numOrRaw(price) : undefined,
            brand: brand || '',
            hs_code: g('hs_code') || undefined,
          }
        })
      }
      setIf(ctx, 'source', g('source'))
      break
    }
    case '进口报关': {
      setIf(ctx, 'contract_no', g('contract_no'))
      if (g('seller_company') || g('seller_contact') || g('seller_phone') || g('seller_address')) {
        ctx.seller = {
          company: g('seller_company'),
          contact: g('seller_contact'),
          phone: g('seller_phone'),
          address: g('seller_address'),
        }
      }
      if (g('lines')) {
        ctx.items = itemsSimple(g('lines'))
        const it0 = (ctx.items as Record<string, unknown>[])[0]
        if (it0) {
          if (it0.part) ctx.part = it0.part
          if (it0.qty !== undefined) ctx.qty = it0.qty
          if (it0.price !== undefined) ctx.price = it0.price
        }
      }
      setIf(ctx, 'brand_cn', g('brand_cn'))
      setIf(ctx, 'brand_en', g('brand_en'))
      setIf(ctx, 'description_en', g('description_en'))
      setIf(ctx, 'description_cn', g('description_cn'))
      setIf(ctx, 'origin_cn', g('origin_cn'))
      setIf(ctx, 'unit', g('unit'))
      setIf(ctx, 'currency', g('currency'))
      setIf(ctx, 'hs_code', g('hs_code'))
      setIf(ctx, 'source', g('source'))
      break
    }
    case '国内送货单': {
      setIf(ctx, 'receiver_company', g('receiver_company'))
      setIf(ctx, 'receiver_address', g('receiver_address'))
      setIf(ctx, 'receiver_contact', g('receiver_contact'))
      setIf(ctx, 'ship_date', g('ship_date'))
      setIf(ctx, 'shipper_company', g('shipper_company'))
      setIf(ctx, 'shipper_contact', g('shipper_contact'))
      if (g('lines')) ctx.items = itemsDomestic(g('lines'))
      setIf(ctx, 'source', g('source'))
      break
    }
    case '对冲结算书': {
      setIf(ctx, 'order_no', g('order_no'))
      setIf(ctx, 'order_date', g('order_date'))
      setIf(ctx, 'party_a', g('party_a'))
      setIf(ctx, 'party_b', g('party_b'))
      setIf(ctx, 'contact_a', g('contact_a'))
      setIf(ctx, 'contact_b', g('contact_b'))
      setIf(ctx, 'phone_a', g('phone_a'))
      setIf(ctx, 'phone_b', g('phone_b'))
      setIf(ctx, 'address_a', g('address_a'))
      setIf(ctx, 'address_b', g('address_b'))
      if (g('lines')) ctx.purchase_lines = purchaseLines(g('lines'))
      if (g('sales_lines')) ctx.sales_lines = salesLines(g('sales_lines'))
      setIf(ctx, 'receivable_cn', g('receivable_cn'))
      setIf(ctx, 'payable_cn', g('payable_cn'))
      setIf(ctx, 'net_cn', g('net_cn'))
      break
    }
  }

  if (g('note')) ctx.note = g('note')
  return { template, context: ctx, mode: 'render' }
}

/** 人类可读预览（markdown 表） */
export function payloadPreviewMarkdown(payload: DocExportPayload): string {
  const lines: string[] = [`**模板：** ${payload.template}`]
  if (payload.mode === 'feishu_order') {
    lines.push(`**模式：** 飞书拉单（订单 ${String(payload.context.order || payload.context.source || '')}）`)
    return lines.join('\n')
  }
  const items = (payload.context.items ||
    payload.context.purchase_lines ||
    []) as Record<string, unknown>[]
  if (items.length) {
    lines.push('', '| # | 型号 | 数量 | 单价 |', '|---|------|------|------|')
    items.forEach((it, i) => {
      const part = String(it.part || it.model || '')
      const qty = it.qty ?? ''
      const price =
        it.price ?? it.unit_price ?? it.unit_price_jpy ?? it.unit_price_usd ?? it.unit_price_rmb ?? ''
      lines.push(`| ${i + 1} | ${part} | ${qty} | ${price} |`)
    })
  }
  return lines.join('\n')
}
