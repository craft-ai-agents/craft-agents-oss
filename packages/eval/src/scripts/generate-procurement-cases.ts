import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump } from 'js-yaml'
import type { EvalCase } from '../types'
import type { ProcurementBaseSeed, ProcurementSeedFile } from '../procurement/base-seeds'

const DEFAULT_SEEDS_FILE = fileURLToPath(new URL('../../seeds/procurement-base-samples.json', import.meta.url))
const DEFAULT_OUTPUT = fileURLToPath(new URL('../../cases/procurement.yaml', import.meta.url))

interface CliOptions {
  seedsFile: string
  outFile: string
  count: number
}

interface CaseBuildContext {
  allInventory: ProcurementBaseSeed[]
  selfInventory: ProcurementBaseSeed[]
  dynamicInventory: ProcurementBaseSeed[]
  noisyModels: ProcurementBaseSeed[]
  weakSignals: ProcurementBaseSeed[]
  supplierProfiles: ProcurementBaseSeed[]
  connectorOrChip: ProcurementBaseSeed[]
}

const LOCAL_INVENTORY_SKILL = ['procurement-local-inventory-lookup']
const PLATFORM_SEARCH_SKILL = ['procurement-platform-search']
const SUPPLIER_SHORTLIST_SKILL = ['procurement-supplier-shortlist']
const DEFAULT_ANSWER_FORBIDDEN_TERMS = ['lark-cli', 'baseToken', 'tableId', 'API', 'command', '命令']
const DEFAULT_MISSING_FIELD_TERMS = ['未填写', '待确认', '缺失', '为空', '未提供']

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function readNumber(args: string[], name: string, fallback: number): number {
  const raw = readArg(args, name)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseArgs(args: string[]): CliOptions {
  return {
    seedsFile: resolve(readArg(args, '--seeds') ?? DEFAULT_SEEDS_FILE),
    outFile: resolve(readArg(args, '--out') ?? DEFAULT_OUTPUT),
    count: readNumber(args, '--count', 100),
  }
}

function mustModel(seed: ProcurementBaseSeed): string {
  if (!seed.model) {
    throw new Error(`Seed ${seed.source.recordId} from ${seed.source.tableName} has no model`)
  }
  return seed.model
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && value.trim().length > 0)
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'item'
}

function normalizeModel(model: string): string {
  return model.replace(/[-\s/]/g, '')
}

function coreModel(model: string): string {
  if (model.length <= 4) return model
  if (/[A-Za-z]$/.test(model)) return model.slice(0, -1)
  if (/[A-Za-z]{1,2}\)?$/.test(model)) return model.replace(/[A-Za-z]{1,2}\)?$/, '')
  return model.slice(0, -1)
}

function requestedVariant(model: string): string {
  const core = coreModel(model)
  return core !== model && core.length >= 3 ? core : `${model}L`
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0)
}

function seedValue(seed: ProcurementBaseSeed, field: string): string | undefined {
  const value = seed[field as keyof ProcurementBaseSeed]
  return typeof value === 'string' ? value : undefined
}

function missingSeedFields(seed: ProcurementBaseSeed, fields: string[]): string[] {
  return fields.filter((field) => !hasValue(seedValue(seed, field)))
}

function evidenceFromSeed(seed: ProcurementBaseSeed, fields: string[]) {
  const missingFields = missingSeedFields(seed, fields)
  return {
    preserveFields: fields,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    missingFieldPolicy: missingFields.length > 0 ? 'explicit_unknown' as const : undefined,
    missingFieldTerms: missingFields.length > 0 ? DEFAULT_MISSING_FIELD_TERMS : undefined,
  }
}

function inventoryToolCalls(seed: ProcurementBaseSeed, terms: string[]) {
  return {
    requiredSkills: LOCAL_INVENTORY_SKILL,
    requiredTableIds: [seed.source.tableId],
    requiredTableNames: [seed.source.tableName],
    requiredSearchFields: ['型号'],
    requiredSearchTerms: unique(terms),
    forbiddenTools: ['WebSearch', 'WebFetch'],
  }
}

function sourceMetadata(seed: ProcurementBaseSeed, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    source: seed.source,
    seed: {
      model: seed.model ?? null,
      brand: seed.brand ?? null,
      quantity: seed.quantity ?? null,
      price: seed.price ?? null,
      supplierName: seed.supplierName ?? null,
      supplierGrade: seed.supplierGrade ?? null,
      tags: seed.tags,
    },
    ...extra,
  }
}

function caseFromSeed(
  seed: ProcurementBaseSeed,
  index: number,
  category: string,
  partial: Omit<EvalCase, 'id' | 'category' | 'metadata'> & { metadata?: Record<string, unknown> },
): EvalCase {
  return {
    id: `${category}-${String(index).padStart(3, '0')}-${slug(seed.model ?? seed.supplierName ?? seed.source.recordId)}`,
    category,
    metadata: sourceMetadata(seed, partial.metadata),
    ...partial,
  }
}

function cycle<T>(items: T[], count: number, label: string): T[] {
  if (items.length === 0) {
    throw new Error(`Cannot build ${label}: no matching seeds`)
  }
  return Array.from({ length: count }, (_unused, index) => items[index % items.length]!)
}

function hasAnyTag(seed: ProcurementBaseSeed, tags: string[]): boolean {
  return tags.some((tag) => seed.tags.includes(tag))
}

function buildContext(seedFile: ProcurementSeedFile): CaseBuildContext {
  const allInventory = seedFile.seeds.filter((seed) => seed.source.kind !== 'supplier_profile' && Boolean(seed.model))
  const selfInventory = allInventory.filter((seed) => seed.source.kind === 'self_inventory' && Boolean(seed.price))
  const dynamicInventory = allInventory.filter((seed) => seed.source.kind === 'dynamic_inventory')
  const noisyModels = allInventory.filter((seed) => hasAnyTag(seed, [
    'model_has_dash',
    'model_has_dot',
    'model_has_space',
    'model_has_slash',
    'model_has_plus',
    'model_has_parenthesis',
    'model_mixed_case',
  ]))
  const weakSignals = allInventory.filter((seed) => hasAnyTag(seed, ['missing_brand', 'missing_price', 'weak_supplier_signal']))
  const supplierProfiles = seedFile.seeds.filter((seed) => seed.source.kind === 'supplier_profile')
  const connectorOrChip = allInventory.filter((seed) => hasAnyTag(seed, ['category_connector', 'category_chip', 'category_industrial']))

  if (allInventory.length === 0) {
    throw new Error('Seed file has no inventory rows with models')
  }

  return {
    allInventory,
    selfInventory: selfInventory.length > 0 ? selfInventory : allInventory,
    dynamicInventory: dynamicInventory.length > 0 ? dynamicInventory : allInventory,
    noisyModels: noisyModels.length > 0 ? noisyModels : allInventory,
    weakSignals: weakSignals.length > 0 ? weakSignals : allInventory,
    supplierProfiles: supplierProfiles.length > 0 ? supplierProfiles : seedFile.seeds,
    connectorOrChip: connectorOrChip.length > 0 ? connectorOrChip : allInventory,
  }
}

function inventoryFirstCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.allInventory, count, 'inventory-first cases').map((seed, offset) => {
    const model = mustModel(seed)
    return caseFromSeed(seed, startIndex + offset, 'procurement_inventory_first', {
      name: `真实库存找料优先 - ${model}`,
      input: `帮我找一下 ${model}`,
      skillSlugs: LOCAL_INVENTORY_SKILL,
      expected: {
        trace: {
          inventoryFirst: true,
          forbidPlatformBeforeInventory: true,
          maxToolCalls: 12,
          maxBashCalls: 10,
        },
        toolCalls: inventoryToolCalls(seed, [model]),
        answer: {
          requiredTerms: [model],
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
          mustMentionInternalSource: true,
        },
        evidence: evidenceFromSeed(seed, ['brand', 'quantity', 'price', 'supplierName']),
      },
      assertions: [
        { type: 'code', criterion: '先查内部库存，不先查外部平台或型号资料网页' },
        { type: 'manual', criterion: '保留用户原始型号，并说明内部库存查询结果来自本地/供应商库存' },
      ],
    })
  })
}

function normalizationCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.noisyModels, count, 'normalization cases').map((seed, offset) => {
    const model = mustModel(seed)
    const normalized = normalizeModel(model)
    const core = coreModel(model)
    return caseFromSeed(seed, startIndex + offset, 'procurement_model_normalization', {
      name: `型号预处理真实噪声 - ${model}`,
      input: `找料 ${model}`,
      skillSlugs: LOCAL_INVENTORY_SKILL,
      expected: {
        trace: {
          inventoryFirst: true,
          forbidPlatformBeforeInventory: true,
          maxToolCalls: 14,
          maxBashCalls: 12,
        },
        toolCalls: inventoryToolCalls(seed, compact([model, normalized !== model ? normalized : undefined, core !== model ? core : undefined])),
        answer: {
          requiredTerms: compact([model, normalized !== model ? normalized : undefined, core !== model ? core : undefined]),
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
          mustMentionInternalSource: true,
        },
        evidence: evidenceFromSeed(seed, ['brand', 'quantity', 'price', 'supplierName']),
      },
      assertions: [
        { type: 'manual', criterion: '生成原始词、去符号词、核心词，并去重后再查库存' },
        { type: 'manual', criterion: '没有把去符号词当成用户唯一想要的型号' },
      ],
    })
  })
}

function mismatchCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.noisyModels, count, 'mismatch cases').map((seed, offset) => {
    const matched = mustModel(seed)
    const requested = requestedVariant(matched)
    return caseFromSeed(seed, startIndex + offset, 'procurement_model_mismatch_detail', {
      name: `近似命中差异说明 - ${requested} vs ${matched}`,
      context: [
        `用户原始要找的型号是 ${requested}。`,
        `内部库存查询命中了一条近似记录，库存表里的型号是 ${matched}。`,
        seed.brand ? `库存记录品牌是 ${seed.brand}。` : '',
        seed.supplierName ? `库存记录供应商是 ${seed.supplierName}。` : '',
      ].filter(Boolean).join('\n'),
      input: '把这个库存命中整理给采购看。',
      expected: {
        trace: {
          maxToolCalls: 0,
        },
        answer: {
          requiredTerms: [requested, matched],
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
        },
        evidence: evidenceFromSeed(seed, ['brand', 'supplierName']),
      },
      assertions: [
        { type: 'manual', criterion: '明确写出用户型号和命中型号的具体差异，不能只写“相近命中需复核”' },
        { type: 'manual', criterion: '不把近似命中当成精确现货结论' },
      ],
    })
  })
}

function selfInventoryCostCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.selfInventory, count, 'self-inventory cost cases').map((seed, offset) => {
    const model = mustModel(seed)
    const price = seed.price ?? '单价为空'
    return caseFromSeed(seed, startIndex + offset, 'procurement_self_inventory_cost', {
      name: `自家库存成本价 - ${model}`,
      context: [
        `查库存结果：自家库存表命中。`,
        `型号 ${model}，品牌 ${seed.brand ?? '未填写'}，库存数量 ${seed.quantity ?? '未填写'}，单价 ${price}。`,
        seed.shelf ? `货架位置号 ${seed.shelf}。` : '',
      ].filter(Boolean).join('\n'),
      input: '有自家库存，你整理结果给我。',
      expected: {
        trace: {
          maxToolCalls: 0,
        },
        answer: {
          requiredTerms: [model, price, '囤货成本'],
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
          mustMentionInternalSource: true,
        },
        evidence: evidenceFromSeed(seed, ['brand', 'quantity', 'price', 'shelf']),
      },
      assertions: [
        { type: 'code', criterion: '展示自家库存的单价/成本价，而不是只说有货' },
        { type: 'manual', criterion: '说明自家库存价格是囤货成本，可用于和市场行情对比' },
      ],
    })
  })
}

function singleSupplierCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.weakSignals, count, 'single-supplier weak signal cases').map((seed, offset) => {
    const model = mustModel(seed)
    const grade = firstNonEmpty(seed.supplierGrade, seed.source.tableName.includes('C级') ? 'C' : undefined, '待判断') ?? '待判断'
    return caseFromSeed(seed, startIndex + offset, 'procurement_single_supplier_risk', {
      name: `单源库存风险 - ${model}`,
      context: [
        `用户之前问了“帮我找 ${model}”，内部库存查完。`,
        `结果：只有${seed.source.tableName}里有一条记录，供应商 ${seed.supplierName ?? '未填写'}，等级 ${grade}，数量 ${seed.quantity ?? '未填写'}，单价 ${seed.price ?? '未填写'}。`,
        `其他库存表没有更多记录。`,
      ].join('\n'),
      input: '查完了，结果如上。请整理给我。',
      expected: {
        trace: {
          maxToolCalls: 0,
        },
        answer: {
          requiredTerms: [model, '仅此一家', grade],
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
          mustMentionInternalSource: true,
        },
        evidence: evidenceFromSeed(seed, ['brand', 'quantity', 'price', 'supplierName', 'supplierGrade']),
      },
      assertions: [
        { type: 'manual', criterion: '标注仅此一家报有货，无其他源印证' },
        { type: 'manual', criterion: '价格、品牌或供应商等级缺失时明确写“未填写/待确认”，不能编造' },
      ],
    })
  })
}

function dynamicInventoryCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.dynamicInventory, count, 'dynamic inventory cases').map((seed, offset) => {
    const model = mustModel(seed)
    return caseFromSeed(seed, startIndex + offset, 'procurement_dynamic_inventory', {
      name: `动态库存时效性 - ${model}`,
      context: [
        `动态库存表命中：型号 ${model}，品牌 ${seed.brand ?? '未填写'}，数量 ${seed.quantity ?? '未填写'}。`,
        `目标价/价格 ${seed.price ?? '未填写'}，类型 ${seed.stockType ?? '未填写'}，发布时间 ${seed.updatedAt ?? '未填写'}。`,
      ].join('\n'),
      input: '把动态库存结果整理给采购。',
      expected: {
        trace: {
          maxToolCalls: 0,
        },
        answer: {
          requiredTerms: compact([model, '动态库存', seed.updatedAt, seed.price]),
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
          mustMentionInternalSource: true,
        },
        evidence: evidenceFromSeed(seed, ['brand', 'quantity', 'price', 'updatedAt', 'stockType']),
      },
      assertions: [
        { type: 'manual', criterion: '说明动态库存时效性强，并展示发布时间' },
        { type: 'manual', criterion: '目标价/价格里有含税或文本噪声时原样呈现，不擅自换算' },
      ],
    })
  })
}

function platformContinuationCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.connectorOrChip, count, 'platform continuation cases').map((seed, offset) => {
    const model = mustModel(seed)
    return caseFromSeed(seed, startIndex + offset, 'procurement_platform_continuation', {
      name: `用户明确继续查平台 - ${model}`,
      input: `内部库存没有。继续帮我查平台，型号 ${model}`,
      skillSlugs: PLATFORM_SEARCH_SKILL,
      expected: {
        trace: {
          requiresPlatformSearch: true,
          maxToolCalls: 16,
        },
        toolCalls: {
          requiredSkills: PLATFORM_SEARCH_SKILL,
          requiredSearchTerms: [model],
        },
        answer: {
          requiredTerms: [model, '交期'],
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
        },
      },
      assertions: [
        { type: 'code', criterion: '用户明确要求继续查平台时，应触发平台搜索' },
        { type: 'manual', criterion: '平台结果要区分现货和交期，缺失时写交期待确认' },
      ],
    })
  })
}

function supplierShortlistCases(ctx: CaseBuildContext, startIndex: number, count: number): EvalCase[] {
  return cycle(ctx.supplierProfiles, count, 'supplier shortlist cases').map((seed, offset) => {
    const brand = firstNonEmpty(seed.brand, seed.productCategory, seed.supplierName) ?? 'Molex'
    return caseFromSeed(seed, startIndex + offset, 'procurement_supplier_shortlist', {
      name: `供应商档案候选 - ${brand}`,
      input: `库存只有一家，帮我按 ${brand} 补几个供应商候选`,
      skillSlugs: SUPPLIER_SHORTLIST_SKILL,
      expected: {
        trace: {
          requiresSupplierShortlist: true,
          maxToolCalls: 12,
        },
        toolCalls: {
          requiredSkills: SUPPLIER_SHORTLIST_SKILL,
          requiredTableIds: [seed.source.tableId],
          requiredTableNames: [seed.source.tableName],
          requiredSearchTerms: [brand],
        },
        answer: {
          requiredTerms: [brand],
          forbiddenTerms: DEFAULT_ANSWER_FORBIDDEN_TERMS,
        },
        evidence: evidenceFromSeed(seed, ['supplierName', 'brand', 'productCategory', 'supplierGrade', 'supplierType']),
      },
      assertions: [
        { type: 'code', criterion: '触发供应商档案候选查询，而不是继续只查库存表' },
        { type: 'manual', criterion: '候选供应商要展示等级、类型、优势产品或主营品牌等可核对信息' },
      ],
    })
  })
}

function buildCases(seedFile: ProcurementSeedFile, desiredCount: number): EvalCase[] {
  const ctx = buildContext(seedFile)
  const groups: Array<[number, (startIndex: number, count: number) => EvalCase[]]> = [
    [25, (start, count) => inventoryFirstCases(ctx, start, count)],
    [15, (start, count) => normalizationCases(ctx, start, count)],
    [15, (start, count) => mismatchCases(ctx, start, count)],
    [10, (start, count) => selfInventoryCostCases(ctx, start, count)],
    [10, (start, count) => singleSupplierCases(ctx, start, count)],
    [10, (start, count) => dynamicInventoryCases(ctx, start, count)],
    [10, (start, count) => platformContinuationCases(ctx, start, count)],
    [5, (start, count) => supplierShortlistCases(ctx, start, count)],
  ]

  const cases: EvalCase[] = []
  let nextIndex = 1
  for (const [count, build] of groups) {
    const remaining = desiredCount - cases.length
    if (remaining <= 0) break
    const groupCount = Math.min(count, remaining)
    cases.push(...build(nextIndex, groupCount))
    nextIndex += groupCount
  }

  if (cases.length < desiredCount) {
    cases.push(...inventoryFirstCases(ctx, nextIndex, desiredCount - cases.length))
  }

  return cases
}

function loadSeedFile(path: string): ProcurementSeedFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProcurementSeedFile
  if (!Array.isArray(parsed.seeds) || parsed.seeds.length === 0) {
    throw new Error(`Seed file must contain at least one seed: ${path}`)
  }
  return parsed
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const seedFile = loadSeedFile(options.seedsFile)
  const cases = buildCases(seedFile, options.count)
  writeFileSync(options.outFile, dump(cases, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }), 'utf8')
  process.stderr.write(`Wrote ${cases.length} procurement eval cases to ${options.outFile}\n`)
}

await main()
