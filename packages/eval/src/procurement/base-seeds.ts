export const PROCUREMENT_BASE_NAME = '供应商管理（正式版）'
export const PROCUREMENT_BASE_TOKEN = 'Mjlkb49B9aoptssVw8Jc0wGwnhh'

export type ProcurementSeedKind = 'supplier_stock' | 'self_inventory' | 'dynamic_inventory' | 'supplier_profile'

export interface ProcurementBaseTableConfig {
  kind: ProcurementSeedKind
  tableName: string
  tableId: string
  fields: string[]
  map: {
    model?: string
    brand?: string
    quantity?: string
    price?: string
    supplierName?: string
    supplierGrade?: string
    updatedAt?: string
    shelf?: string
    stockType?: string
    productCategory?: string
    supplierType?: string
    region?: string
    providesStockSheet?: string
  }
}

export interface ProcurementSeedSource {
  baseName: string
  baseToken: string
  tableName: string
  tableId: string
  recordId: string
  kind: ProcurementSeedKind
}

export interface ProcurementBaseSeed {
  source: ProcurementSeedSource
  model?: string
  brand?: string
  quantity?: string
  price?: string
  supplierName?: string
  supplierGrade?: string
  updatedAt?: string
  shelf?: string
  stockType?: string
  productCategory?: string
  supplierType?: string
  region?: string
  providesStockSheet?: string
  tags: string[]
  rawFields: Record<string, unknown>
}

export interface ProcurementSeedFile {
  generatedAt: string
  baseName: string
  baseToken: string
  sampleLimitPerTable: number
  seeds: ProcurementBaseSeed[]
  tableErrors?: Array<{
    tableName: string
    tableId: string
    message: string
  }>
}

const supplierStockFields = [
  '型号',
  '品牌',
  '库存数量',
  '单价',
  '供应商名称',
  '供应商等级',
  '更新时间',
]

export const PROCUREMENT_BASE_TABLES: ProcurementBaseTableConfig[] = [
  {
    kind: 'dynamic_inventory',
    tableName: '动态库存表',
    tableId: 'tbli1WYTb1Xn2MSa',
    fields: ['型号', '品牌', '数量', '目标价/价格', '供应商名称', '类型', '发布时间'],
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '数量',
      price: '目标价/价格',
      supplierName: '供应商名称',
      stockType: '类型',
      updatedAt: '发布时间',
    },
  },
  {
    kind: 'supplier_stock',
    tableName: 'A级供应商库存',
    tableId: 'tblzQbSnVNhGszYA',
    fields: supplierStockFields,
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '库存数量',
      price: '单价',
      supplierName: '供应商名称',
      supplierGrade: '供应商等级',
      updatedAt: '更新时间',
    },
  },
  {
    kind: 'supplier_stock',
    tableName: 'B级供应商库存1',
    tableId: 'tbldOthm6zmFonDM',
    fields: supplierStockFields,
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '库存数量',
      price: '单价',
      supplierName: '供应商名称',
      supplierGrade: '供应商等级',
      updatedAt: '更新时间',
    },
  },
  {
    kind: 'supplier_stock',
    tableName: 'B级供应商库存2',
    tableId: 'tblqaoi5UuUGybxF',
    fields: supplierStockFields,
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '库存数量',
      price: '单价',
      supplierName: '供应商名称',
      supplierGrade: '供应商等级',
      updatedAt: '更新时间',
    },
  },
  {
    kind: 'supplier_stock',
    tableName: 'B级供应商库存3',
    tableId: 'tbld53dBj2dvI1R6',
    fields: supplierStockFields,
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '库存数量',
      price: '单价',
      supplierName: '供应商名称',
      supplierGrade: '供应商等级',
      updatedAt: '更新时间',
    },
  },
  {
    kind: 'supplier_stock',
    tableName: 'C级供应商库存',
    tableId: 'tblBbvvRKB0Ziioz',
    fields: supplierStockFields,
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '库存数量',
      price: '单价',
      supplierName: '供应商名称',
      supplierGrade: '供应商等级',
      updatedAt: '更新时间',
    },
  },
  {
    kind: 'self_inventory',
    tableName: '自家库存',
    tableId: 'tblSUjXdehzkxIbK',
    fields: ['型号', '品牌', '库存数量', '单价', '货架位置号', '更新时间'],
    map: {
      model: '型号',
      brand: '品牌',
      quantity: '库存数量',
      price: '单价',
      shelf: '货架位置号',
      updatedAt: '更新时间',
    },
  },
  {
    kind: 'supplier_profile',
    tableName: '供应商档案',
    tableId: 'tblbtuMHFIOr6Oss',
    fields: ['供应商全称', '主营品牌', '优势产品', '询价品牌', '供应商等级', '等级', '供应商类型', '地区', '是否提供库存表'],
    map: {
      supplierName: '供应商全称',
      brand: '主营品牌',
      productCategory: '优势产品',
      supplierGrade: '供应商等级',
      supplierType: '供应商类型',
      region: '地区',
      providesStockSheet: '是否提供库存表',
    },
  },
]

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0)
}

function includesAny(value: string, needles: string[]): boolean {
  const normalized = value.toLowerCase()
  return needles.some((needle) => normalized.includes(needle.toLowerCase()))
}

function modelTags(model: string): string[] {
  const tags: string[] = []
  if (model.includes('-')) tags.push('model_has_dash')
  if (model.includes('.')) tags.push('model_has_dot')
  if (model.includes(' ')) tags.push('model_has_space')
  if (model.includes('/')) tags.push('model_has_slash')
  if (model.includes('+')) tags.push('model_has_plus')
  if (/[()（）]/.test(model)) tags.push('model_has_parenthesis')
  if (/^[0-9.\-]+$/.test(model)) tags.push('model_numeric_punctuation')
  if (/[a-z]/.test(model) && /[A-Z]/.test(model)) tags.push('model_mixed_case')
  return tags
}

function categoryTags(seed: Pick<ProcurementBaseSeed, 'brand' | 'model' | 'productCategory'>): string[] {
  const value = [seed.brand, seed.model, seed.productCategory].filter(Boolean).join(' ')
  const tags: string[] = []
  if (includesAny(value, ['Molex', 'MOLEX', 'TE ', 'TE Connectivity', 'HRS', 'Hirose', 'JST', 'SCHURTER'])) {
    tags.push('category_connector')
  }
  if (includesAny(value, ['Omron', '欧姆龙', 'SMC', 'Mitsubishi', 'IDEC', 'Mean Well', 'eao'])) {
    tags.push('category_industrial')
  }
  if (includesAny(value, ['STM32', 'Realtek', 'Micron', 'Toshiba', 'Maxim', 'Renesas', 'Dialog', '瑞萨'])) {
    tags.push('category_chip')
  }
  return tags
}

export function buildProcurementSeedTags(seed: Omit<ProcurementBaseSeed, 'tags'>): string[] {
  const tags = new Set<string>([seed.source.kind, seed.source.tableName])
  if (seed.model) {
    for (const tag of modelTags(seed.model)) tags.add(tag)
  }
  if (!hasValue(seed.brand) && seed.source.kind !== 'supplier_profile') tags.add('missing_brand')
  if (!hasValue(seed.price) && seed.source.kind !== 'supplier_profile') tags.add('missing_price')
  if (hasValue(seed.price) && seed.price && /[^0-9.$¥￥,\s-]/.test(seed.price)) tags.add('price_text_noise')
  if (seed.source.kind === 'self_inventory') tags.add('self_inventory_cost')
  if (seed.source.kind === 'dynamic_inventory') tags.add('time_sensitive_dynamic')
  if (seed.supplierGrade && includesAny(seed.supplierGrade, ['C', '待判断'])) tags.add('weak_supplier_signal')
  for (const tag of categoryTags(seed)) tags.add(tag)
  return [...tags].sort()
}
