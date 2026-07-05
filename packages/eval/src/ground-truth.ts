/**
 * 真值对账的地面真值层:eval 时 harness 自己查 larkdepot(与 agent 同一份本地缓存),
 * 现场算出"这个型号真实有没有货、在哪几张表、哪些供应商、什么价"。
 *
 * 为什么这样做:判"agent 说的话与库存事实是否一致",而不是判"agent 走了哪条路"。
 * 工具怎么换名、路径怎么改,这里都不用知道——真值自更新,零关键词税则,零维护。
 * (旧的轨迹关键词判分器一个下午改了四次谓词,已整体处决。)
 *
 * 只在 larkdepot 可用的环境(生产)有效;本地无 larkdepot 时判分器显式报"真值不可用"。
 */
import { execFileSync } from 'node:child_process'

export interface PartFacts {
  /** 查询词(可以是变体写法;record-search 内建 norm 归一) */
  queryPart: string
  available: boolean
  rowCount: number
  /** 表名 → 命中行数 */
  tables: Record<string, number>
  /** 命中行里的供应商名(去重) */
  suppliers: string[]
  /** 命中行里的规范型号写法(去重,来自缓存的 型号 列) */
  canonicalMpns: string[]
  /** 命中行里的价格数字 token(如 "11.33"),供"答案里报了真实价格"检查 */
  priceTokens: string[]
}

function runLarkdepot(args: string[]): unknown {
  const out = execFileSync('larkdepot', args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(out)
}

function rowsOf(envelope: unknown): Array<Record<string, unknown>> {
  const data = (envelope as { data?: unknown })?.data
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : []
}

function textOf(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : String(v)
}

/** 从价格文本抽数字 token:"11.33 USD" → "11.33","0.42含税" → "0.42"。 */
function priceTokensOf(v: unknown): string[] {
  return [...textOf(v).matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0])
}

const factsCache = new Map<string, PartFacts>()

export function fetchPartFacts(queryPart: string): PartFacts {
  const cached = factsCache.get(queryPart)
  if (cached) return cached

  const envelope = runLarkdepot([
    'base', '+record-search',
    '--keyword', queryPart,
    '--search-field', '型号',
    '--limit', '200',
  ])
  const rows = rowsOf(envelope)
  const tables: Record<string, number> = {}
  const suppliers = new Set<string>()
  const mpns = new Set<string>()
  const prices = new Set<string>()
  for (const row of rows) {
    const table = textOf(row['_table'])
    if (table) tables[table] = (tables[table] ?? 0) + 1
    const supplier = textOf(row['供应商名称']).trim()
    if (supplier) suppliers.add(supplier)
    const mpn = textOf(row['型号']).trim()
    if (mpn) mpns.add(mpn)
    for (const key of ['目标价/价格', '单价']) {
      for (const token of priceTokensOf(row[key])) prices.add(token)
    }
  }
  const facts: PartFacts = {
    queryPart,
    available: rows.length > 0,
    rowCount: rows.length,
    tables,
    suppliers: [...suppliers],
    canonicalMpns: [...mpns],
    priceTokens: [...prices],
  }
  factsCache.set(queryPart, facts)
  return facts
}

let supplierDirectoryCache: string[] | null = null

/**
 * 供应商档案全量名录(编造检测的候选池):答案里出现"在名录里、却不在本型号
 * 真值供应商集"的名字 = 无中生有的货源。名录之外的名字(如境外平台)不判。
 */
export function fetchSupplierDirectory(): string[] {
  if (supplierDirectoryCache) return supplierDirectoryCache
  const envelope = runLarkdepot([
    'query', 'sql',
    '--sql', 'SELECT "供应商全称" AS n, "供应商名称文本" AS t FROM 供应商档案',
    '--limit', '2000',
  ])
  const names = new Set<string>()
  for (const row of rowsOf(envelope)) {
    for (const key of ['n', 't']) {
      const name = textOf(row[key]).trim()
      // 短名(<4 字)子串误命中率高,不进候选池
      if (name.length >= 4) names.add(name)
    }
  }
  supplierDirectoryCache = [...names]
  return supplierDirectoryCache
}
