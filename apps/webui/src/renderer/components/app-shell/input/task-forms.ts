import type { LucideIcon } from 'lucide-react'
import {
  Search,
  Replace,
  GitCompareArrows,
  FileText,
  ListChecks,
  FileSpreadsheet,
  ScrollText,
  Ship,
  Package,
} from 'lucide-react'
import { buildDocPayload, payloadPreviewMarkdown } from './doc-form-payload'

export type TaskFieldType = 'text' | 'select' | 'textarea'

export interface TaskField {
  key: string
  label: string
  type: TaskFieldType
  placeholder?: string
  required?: boolean
  options?: string[]
}

export interface TaskForm {
  id: string
  label: string
  icon: LucideIcon
  fields: TaskField[]
  getFields?: (v: Record<string, string>) => TaskField[]
  toMessage: (v: Record<string, string>) => string
  group?: 'workflow' | 'doc'
}

function val(v: Record<string, string>, key: string): string {
  return (v[key] ?? '').trim()
}

const NOTE_FIELD: TaskField = {
  key: 'note',
  label: '备注说明',
  type: 'textarea',
  placeholder: '可选；补充说明或特殊要求',
}

function noteSuffix(v: Record<string, string>): string {
  const note = val(v, 'note')
  return note ? `\n备注：${note}` : ''
}

// ---------------------------------------------------------------------------
// 单据模板（正式名写进触发消息，与 skill/catalog 对齐）
// ---------------------------------------------------------------------------

export const DOC_TEMPLATE_NAMES = [
  '美金请款发票 PI',
  '日本請求書（イノ間）',
  '見積書',
  '竹菱 PI',
  '取扱手数料',
  'FAR 采购订单',
  '深圳印诺采购合同（中文）',
  '印诺英文采购合同',
  '不报关出口资料',
  '出口报关',
  '进口报关',
  '国内送货单',
  '对冲结算书',
] as const

export type DocTemplateName = (typeof DOC_TEMPLATE_NAMES)[number]
/** @deprecated 兼容旧导出名 */
export const DOC_TEMPLATES = DOC_TEMPLATE_NAMES

/**
 * 各模板完整表单字段（对齐 render 已支持 context + sample 关键抬头）。
 * 仅收集脚本能落地或 agent 明确需要的；未实现子表字段不假装必填。
 */
export function getDocFieldsForTemplate(template: DocTemplateName): TaskField[] {
  switch (template) {
    case '美金请款发票 PI':
      return [
        {
          key: 'source',
          label: '订单编号',
          type: 'text',
          placeholder: '飞书客户订单编号（优先；脚本可自动拉货品行）',
          required: true,
        },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '可选：若不用飞书拉单，每行 型号,数量,单价,描述',
          required: false,
        },
        NOTE_FIELD,
      ]

    case '日本請求書（イノ間）':
      return [
        { key: 'invoice_no', label: '請求番号', type: 'text', placeholder: '如 OD20260212174', required: true },
        { key: 'invoice_date', label: '請求日', type: 'text', placeholder: '2026-07-09 或 2026年7月9日', required: true },
        { key: 'subject', label: '件名', type: 'text', placeholder: '電子部品の緊急調達', required: false },
        { key: 'fx_rmb', label: 'RMB汇率', type: 'text', placeholder: '如 22.5（仕入 RMB→JPY）', required: true },
        { key: 'fx_usd', label: 'USD汇率', type: 'text', placeholder: '如 160（仕入 USD→JPY）', required: true },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,币种,单价\n币种填 RMB 或 USD 或 JPY（对应仕入 S/T/U 列）',
          required: true,
        },
        { key: 'shipping_qty', label: '运费数量', type: 'text', placeholder: '立替運送料数量，无则 0', required: false },
        { key: 'shipping_price', label: '运费单价', type: 'text', placeholder: 'JPY 运费单价，无则空', required: false },
        { key: 'import_tax_jpy', label: '輸入消费税', type: 'text', placeholder: '立替輸入消費税 JPY，无则 0', required: false },
        { key: 'customer', label: '客户名', type: 'text', placeholder: '可选；如 パルス / 朋栄（查单用）', required: false },
        { key: 'source', label: '关联订单', type: 'text', placeholder: '可选；飞书/内部订单号', required: false },
        NOTE_FIELD,
      ]

    case '見積書':
      return [
        { key: 'date', label: '报价日期', type: 'text', placeholder: '2026-07-09 或 2025.6.12', required: true },
        { key: 'to', label: 'TO客户', type: 'textarea', placeholder: 'TO 客户名/公司（可多行）', required: true },
        {
          key: 'from_block',
          label: 'FROM抬头',
          type: 'textarea',
          placeholder: '可选；FROM 公司块（空白则用模板默认）',
          required: false,
        },
        {
          key: 'currency',
          label: '币种',
          type: 'select',
          options: ['JPY', 'USD'],
          required: true,
        },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价,单位,DC,货期\n例：5CB1G97586,3,26,PCS,NA,2週間',
          required: true,
        },
        { key: 'source', label: '关联订单', type: 'text', placeholder: '可选', required: false },
        NOTE_FIELD,
      ]

    case '竹菱 PI':
      return [
        { key: 'invoice_no', label: 'Invoice No', type: 'text', placeholder: '如 20251219', required: true },
        { key: 'invoice_date', label: 'Date', type: 'text', placeholder: '如 20251219 或 2026-07-09', required: true },
        { key: 'po_number', label: 'PO No', type: 'text', placeholder: '如 8828984 / 08831960-0010', required: true },
        { key: 'terms', label: 'Terms', type: 'text', placeholder: '默认 DDU', required: false },
        { key: 'ship_date', label: 'Ship date', type: 'text', placeholder: '常与 Date 相同', required: false },
        { key: 'ship_via', label: 'Ship Via', type: 'text', placeholder: 'FedEx / UPS / SF', required: false },
        { key: 'tracking_no', label: 'Tracking', type: 'text', placeholder: '运单号', required: false },
        {
          key: 'bill_to',
          label: 'Bill To',
          type: 'textarea',
          placeholder: '第一行公司名，后续地址/电话（可多行）\n空白默认 TAKEBISHI',
          required: false,
        },
        {
          key: 'ship_to',
          label: 'Ship To',
          type: 'textarea',
          placeholder: '第一行公司名，后续地址；可与 Bill 不同（物流仓）',
          required: false,
        },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价,描述\n例：SDSQUNI-256G-ZS3MN,400,37,SDカード',
          required: true,
        },
        { key: 'source', label: '关联订单', type: 'text', placeholder: '可选', required: false },
        NOTE_FIELD,
      ]

    case '取扱手数料':
      return [
        { key: 'invoice_no', label: '請求番号', type: 'text', placeholder: '请求书番号', required: true },
        { key: 'invoice_date', label: '請求日', type: 'text', placeholder: '2026年7月7日', required: true },
        { key: 'subject', label: '件名', type: 'text', placeholder: '電子部品の緊急調達', required: false },
        {
          key: 'lines',
          label: '手续费明细',
          type: 'textarea',
          placeholder: '每行：品名,数量,单价,单位\n金额必须业务给定，禁止自算百分比\n例：CB01A6-05B0-02 取扱手数料,1,5661,一式',
          required: true,
        },
        { key: 'source', label: '关联订单', type: 'text', placeholder: '可选', required: false },
        NOTE_FIELD,
      ]

    case 'FAR 采购订单':
      return [
        { key: 'po_number', label: '订单编号', type: 'text', placeholder: '如 PO-2026-05-0701', required: true },
        { key: 'po_date', label: '订单日期', type: 'text', placeholder: '2026-07-09', required: true },
        { key: 'supplier_name', label: '供应商', type: 'text', placeholder: '乙方（供方）全称', required: true },
        { key: 'supplier_contact', label: '供方联系人', type: 'text', required: false },
        { key: 'supplier_phone', label: '供方电话', type: 'text', required: false },
        { key: 'supplier_address', label: '供方地址', type: 'textarea', required: false },
        {
          key: 'ship_address',
          label: '收货地址',
          type: 'textarea',
          placeholder: '可选；空白用模板预填深圳地址',
          required: false,
        },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：品牌,型号,数量,单价,单位,批次,交货期\n例：ST,STM32F103,100,3.2,PCS,24+,2周',
          required: true,
        },
        NOTE_FIELD,
      ]

    case '深圳印诺采购合同（中文）':
      return [
        { key: 'po_number', label: '订单编号', type: 'text', required: true },
        { key: 'po_date', label: '订单日期', type: 'text', required: true },
        { key: 'supplier_name', label: '供应商', type: 'text', required: true },
        { key: 'supplier_contact', label: '供方联系人', type: 'text', required: false },
        { key: 'supplier_phone', label: '供方电话', type: 'text', required: false },
        { key: 'supplier_address', label: '供方地址', type: 'textarea', required: false },
        {
          key: 'tax_mode',
          label: '税口径',
          type: 'select',
          options: ['含税', '未税'],
          required: true,
        },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：品牌,型号,数量,单价,单位,批次,交货期,备注',
          required: true,
        },
        NOTE_FIELD,
      ]

    case '印诺英文采购合同':
      return [
        { key: 'po_number', label: 'PO Number', type: 'text', required: true },
        {
          key: 'ship_to_mode',
          label: '收货仓',
          type: 'select',
          options: ['日本仓', '深圳仓'],
          required: true,
        },
        {
          key: 'currency',
          label: '币种',
          type: 'select',
          options: ['USD', 'JPY', 'CNY'],
          required: false,
        },
        { key: 'po_sent_by', label: 'Sent by', type: 'text', required: false },
        { key: 'ship_via', label: 'Ship Via', type: 'text', placeholder: 'FedEx / DHL', required: false },
        { key: 'terms', label: 'Terms', type: 'text', placeholder: 'T/T in advance', required: false },
        { key: 'delivery_date', label: '交期', type: 'text', required: false },
        { key: 'supplier_name', label: 'Supplier', type: 'text', required: true },
        { key: 'supplier_address', label: 'Supplier地址', type: 'textarea', required: false },
        {
          key: 'ship_to',
          label: 'Ship to',
          type: 'textarea',
          placeholder: '正式地址全文；空白用脚本占位（日本仓/深圳印诺）',
          required: false,
        },
        {
          key: 'bill_to',
          label: 'Bill to',
          type: 'textarea',
          placeholder: '正式地址全文；空白用默认（日仓日本印诺 / 深仓 FAR）',
          required: false,
        },
        { key: 'contact', label: 'Contact', type: 'text', required: false },
        { key: 'tel', label: 'Tel', type: 'text', required: false },
        { key: 'email', label: 'E-mail', type: 'text', required: false },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价,描述,DC',
          required: true,
        },
        NOTE_FIELD,
      ]

    case '不报关出口资料':
      return [
        { key: 'po_number', label: 'PO No', type: 'text', required: true },
        { key: 'sold_to_company', label: 'Sold to公司', type: 'text', required: true },
        { key: 'sold_to_address', label: 'Sold to地址', type: 'textarea', required: true },
        { key: 'seller_company', label: 'Seller公司', type: 'text', placeholder: '可选；空白模板默认', required: false },
        { key: 'seller_address', label: 'Seller地址', type: 'textarea', required: false },
        { key: 'ship_to_name', label: 'SHIP TO收件人', type: 'text', required: false },
        { key: 'ship_to_phone', label: 'SHIP TO电话', type: 'text', required: false },
        { key: 'bill_to_block', label: 'BILL TO', type: 'textarea', placeholder: '整段账单抬头（日元/美金规则）', required: false },
        { key: 'date_y', label: '日期-年', type: 'text', placeholder: '26', required: false },
        { key: 'date_m', label: '日期-月', type: 'text', placeholder: '07', required: false },
        { key: 'date_d', label: '日期-日', type: 'text', placeholder: '09', required: false },
        { key: 'brand', label: '品牌', type: 'text', required: false },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价,描述\n（本版脚本主填汇总；PI/装箱细表未全自动）',
          required: true,
        },
        { key: 'description_en', label: '英文品名', type: 'text', required: false },
        { key: 'material_en', label: '材质(英)', type: 'text', required: false },
        { key: 'hs_code', label: 'HS编码', type: 'text', placeholder: '有则填；禁止编造', required: false },
        { key: 'cartons', label: '件数', type: 'text', required: false },
        { key: 'source', label: '关联订单', type: 'text', required: false },
        NOTE_FIELD,
      ]

    case '出口报关':
      return [
        {
          key: 'currency_set',
          label: '币种套',
          type: 'select',
          options: ['cny', 'usd', 'jpy1039'],
          required: true,
        },
        { key: 'transport', label: '运输方式', type: 'text', placeholder: 'FedEx / DHL', required: false },
        { key: 'freight', label: '运费', type: 'text', required: false },
        { key: 'ship_date', label: '发货日期', type: 'text', required: false },
        { key: 'trade_country', label: '贸易国(中)', type: 'text', placeholder: '日本', required: false },
        { key: 'trade_country_en', label: '贸易国(英)', type: 'text', placeholder: 'JAPAN', required: false },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价,品牌\n（填汇总+选中币种套主表；报关单/申报要素未全自动）',
          required: true,
        },
        { key: 'description_en', label: '品名(英)', type: 'text', required: false },
        { key: 'description_cn', label: '品名(中)', type: 'text', required: false },
        { key: 'unit', label: '单位', type: 'text', placeholder: 'PCS / 个', required: false },
        { key: 'currency', label: '成交币种', type: 'select', options: ['JPY', 'USD', 'CNY'], required: false },
        { key: 'origin', label: '原产国', type: 'text', placeholder: '中国', required: false },
        { key: 'hs_code', label: 'HS编码', type: 'text', placeholder: '有则填；禁止编造', required: false },
        { key: 'sold_to_company', label: '买方公司', type: 'text', required: false },
        { key: 'sold_to_address', label: '买方地址', type: 'textarea', required: false },
        { key: 'seller_company', label: '卖方公司', type: 'text', required: false },
        { key: 'seller_address', label: '卖方地址', type: 'textarea', required: false },
        { key: 'source', label: '关联订单', type: 'text', required: false },
        NOTE_FIELD,
      ]

    case '进口报关':
      return [
        { key: 'contract_no', label: '合同号', type: 'text', required: true },
        { key: 'seller_company', label: '卖方公司', type: 'text', required: true },
        { key: 'seller_contact', label: '卖方联系人', type: 'text', required: false },
        { key: 'seller_phone', label: '卖方电话', type: 'text', required: false },
        { key: 'seller_address', label: '卖方地址', type: 'textarea', required: false },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价\n（本版主填进口汇总；合同/发票子表未全自动）',
          required: true,
        },
        { key: 'brand_cn', label: '品牌(中)', type: 'text', required: false },
        { key: 'brand_en', label: '品牌(英)', type: 'text', required: false },
        { key: 'description_en', label: '品名(英)', type: 'text', required: false },
        { key: 'description_cn', label: '品名(中)', type: 'text', required: false },
        { key: 'origin_cn', label: '原产国(中)', type: 'text', required: false },
        { key: 'unit', label: '单位', type: 'text', required: false },
        { key: 'currency', label: '币种', type: 'select', options: ['USD', 'JPY', 'CNY'], required: false },
        { key: 'hs_code', label: 'HS编码', type: 'text', placeholder: '有则填；禁止编造', required: false },
        { key: 'source', label: '关联订单', type: 'text', required: false },
        NOTE_FIELD,
      ]

    case '国内送货单':
      return [
        { key: 'receiver_company', label: '收货公司', type: 'text', required: true },
        { key: 'receiver_address', label: '收货地址', type: 'textarea', required: true },
        { key: 'receiver_contact', label: '收货联系人', type: 'text', required: false },
        { key: 'ship_date', label: '发货日期', type: 'text', required: false },
        {
          key: 'shipper_company',
          label: '发货公司',
          type: 'text',
          placeholder: '默认深圳市印诺电子科技有限公司',
          required: false,
        },
        { key: 'shipper_contact', label: '发货联系人', type: 'text', required: false },
        {
          key: 'lines',
          label: '货品明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单位,备注\n例：DOM-PART,100,PCS,急',
          required: true,
        },
        { key: 'source', label: '关联订单', type: 'text', required: false },
        NOTE_FIELD,
      ]

    case '对冲结算书':
      return [
        { key: 'order_no', label: '订单编号', type: 'text', required: true },
        { key: 'order_date', label: '订单日期', type: 'text', placeholder: '2026年7月9日', required: false },
        {
          key: 'party_a',
          label: '甲方',
          type: 'text',
          placeholder: '可选；默认模板甲方',
          required: false,
        },
        { key: 'party_b', label: '乙方', type: 'text', required: true },
        { key: 'contact_a', label: '甲方联系人', type: 'text', required: false },
        { key: 'contact_b', label: '乙方联系人', type: 'text', required: false },
        { key: 'phone_a', label: '甲方电话', type: 'text', required: false },
        { key: 'phone_b', label: '乙方电话', type: 'text', required: false },
        { key: 'address_a', label: '甲方地址', type: 'textarea', required: false },
        { key: 'address_b', label: '乙方地址', type: 'textarea', required: false },
        {
          key: 'lines',
          label: '采购明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,采购价[,销售价]',
          required: true,
        },
        {
          key: 'sales_lines',
          label: '销售明细',
          type: 'textarea',
          placeholder: '每行：型号,数量,单价',
          required: false,
        },
        {
          key: 'receivable_cn',
          label: '应收条款',
          type: 'textarea',
          placeholder: '整句中文；脚本不自动轧差',
          required: false,
        },
        {
          key: 'payable_cn',
          label: '应付条款',
          type: 'textarea',
          required: false,
        },
        {
          key: 'net_cn',
          label: '轧差条款',
          type: 'textarea',
          required: false,
        },
        NOTE_FIELD,
      ]
  }
}

/**
 * 拼完整触发消息：人类可读预览 + 机器可读 payload（```doc-export-json）。
 * Agent 须用 render_from_form.py 吃掉 JSON 块，勿手抄坐标。
 */
export function docToMessage(template: string, v: Record<string, string>): string {
  const payload = buildDocPayload(template as DocTemplateName, v)

  // 美金 PI 仅订单号：保留短触发语 + 仍附 payload（mode=feishu_order）
  if (payload.mode === 'feishu_order') {
    const source = val(v, 'source')
    return [
      `把 ${source} 这单按 美金请款发票 PI 生成请款单（PI）`,
      `请用 procurement-doc-export：优先 \`scripts/render_from_form.py --data\` 吃下面 JSON（飞书拉单）；失败则如实说。`,
      '',
      '```doc-export-json',
      JSON.stringify(payload, null, 2),
      '```',
      noteSuffix(v).trimStart(),
    ]
      .filter((line) => line !== undefined && line !== '')
      .join('\n')
  }

  const parts: string[] = [
    `请用 procurement-doc-export 技能，按模板「${template}」生成可编辑单据。`,
    `端到端：先按下列预览向用户确认，确认后执行：`,
    `\`uv run --with openpyxl python3 .agents/skills/procurement-doc-export/scripts/render_from_form.py --data payload.json --out <工作区>/<名>.xlsx\``,
    `其中 payload.json 内容 = 下方 doc-export-json 代码块（原样保存即可）。不要手抄单元格坐标。`,
    `禁止虚构 HS/地址/金额/重量；缺字段如实说。`,
    '',
    '### 预览',
    payloadPreviewMarkdown(payload),
    '',
    '```doc-export-json',
    JSON.stringify(payload, null, 2),
    '```',
  ]

  const note = noteSuffix(v)
  if (note) parts.push(note.trimStart())

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// 按钮注册：每模板独立
// ---------------------------------------------------------------------------

interface DocSpec {
  id: string
  label: string
  template: DocTemplateName
  icon: LucideIcon
}

const DOC_SPECS: DocSpec[] = [
  { id: 'doc-pi', label: '美金 PI', template: '美金请款发票 PI', icon: FileText },
  { id: 'doc-jp-invoice', label: '日本請求書', template: '日本請求書（イノ間）', icon: ScrollText },
  { id: 'doc-quotation', label: '見積書', template: '見積書', icon: FileSpreadsheet },
  { id: 'doc-takebishi-pi', label: '竹菱 PI', template: '竹菱 PI', icon: FileText },
  { id: 'doc-takebishi-fee', label: '取扱手数料', template: '取扱手数料', icon: ScrollText },
  { id: 'doc-far-po', label: 'FAR 订单', template: 'FAR 采购订单', icon: FileSpreadsheet },
  { id: 'doc-sz-po', label: '中文采购合同', template: '深圳印诺采购合同（中文）', icon: FileSpreadsheet },
  { id: 'doc-en-po', label: '英文采购合同', template: '印诺英文采购合同', icon: FileSpreadsheet },
  { id: 'doc-no-decl', label: '不报关资料', template: '不报关出口资料', icon: Ship },
  { id: 'doc-export', label: '出口报关', template: '出口报关', icon: Ship },
  { id: 'doc-import', label: '进口报关', template: '进口报关', icon: Ship },
  { id: 'doc-domestic', label: '国内送货单', template: '国内送货单', icon: Package },
  { id: 'doc-hedge', label: '对冲结算', template: '对冲结算书', icon: ScrollText },
]

function buildDocForm(spec: DocSpec): TaskForm {
  const fields = getDocFieldsForTemplate(spec.template)
  return {
    id: spec.id,
    label: spec.label,
    icon: spec.icon,
    fields,
    group: 'doc',
    toMessage: (v) => docToMessage(spec.template, v),
  }
}

export const WORKFLOW_TASK_FORMS: TaskForm[] = [
  {
    id: 'find',
    label: '找料',
    icon: Search,
    group: 'workflow',
    fields: [
      { key: 'mpn', label: '型号', type: 'text', placeholder: '如 TPS92550TZX', required: true },
      NOTE_FIELD,
    ],
    toMessage: (v) =>
      `帮我找一下 ${val(v, 'mpn')}：先查本地库存（自家 + 各级供应商），再查各平台原始分销渠道，给我现货数量、阶梯价、MOQ、供应商和货期，优先原厂 / 授权渠道；查不到也明确告诉我。${noteSuffix(v)}`,
  },
  {
    id: 'batch',
    label: '批量找料',
    icon: ListChecks,
    group: 'workflow',
    fields: [
      {
        key: 'parts',
        label: '型号清单',
        type: 'textarea',
        placeholder: '每行一个型号（可从表格直接粘贴一列）',
        required: true,
      },
      NOTE_FIELD,
    ],
    toMessage: (v) =>
      `这一批型号帮我批量找料（用 procurement-batch-orchestration 技能）：\n${val(v, 'parts')}${noteSuffix(v)}`,
  },
  {
    id: 'alt',
    label: '找替代料',
    icon: Replace,
    group: 'workflow',
    fields: [
      { key: 'mpn', label: '型号', type: 'text', placeholder: '如 TPS92550TZX', required: true },
      NOTE_FIELD,
    ],
    toMessage: (v) =>
      `帮我找 ${val(v, 'mpn')} 的替代料：给 pin-to-pin 和功能替代候选，逐项说明关键参数差异（封装 / 电压 / 电流 / 精度 / 温度等）和能否替代的结论，并标注品牌、货源和大致价格。${noteSuffix(v)}`,
  },
  {
    id: 'compare',
    label: '替代料判断',
    icon: GitCompareArrows,
    group: 'workflow',
    fields: [
      { key: 'need', label: '需求型号', type: 'text', required: true },
      { key: 'quote', label: '报价型号', type: 'text', required: true },
      NOTE_FIELD,
    ],
    toMessage: (v) =>
      `需求型号 ${val(v, 'need')}，报价型号 ${val(v, 'quote')}，这俩能不能替代？请逐项对比关键参数（封装 / 电气规格 / 温度范围 / 认证等），指出差异点，给出能否直接替代的明确结论和需要注意的风险。${noteSuffix(v)}`,
  },
]

export const DOC_TASK_FORMS: TaskForm[] = DOC_SPECS.map(buildDocForm)

export const TASK_FORMS: TaskForm[] = [...WORKFLOW_TASK_FORMS, ...DOC_TASK_FORMS]

export function getTaskForm(id: string): TaskForm | undefined {
  return TASK_FORMS.find((f) => f.id === id)
}

export function resolveFields(form: TaskForm, values: Record<string, string>): TaskField[] {
  return form.getFields?.(values) ?? form.fields
}

export function isFormComplete(form: TaskForm, values: Record<string, string>): boolean {
  return resolveFields(form, values).every((f) => !f.required || (values[f.key]?.trim() ?? '') !== '')
}
