import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  buildProcurementSeedTags,
  PROCUREMENT_BASE_NAME,
  PROCUREMENT_BASE_TABLES,
  PROCUREMENT_BASE_TOKEN,
  type ProcurementBaseSeed,
  type ProcurementBaseTableConfig,
  type ProcurementSeedFile,
} from '../procurement/base-seeds'

const DEFAULT_OUTPUT = fileURLToPath(new URL('../../seeds/procurement-base-samples.json', import.meta.url))

interface CliOptions {
  outFile: string
  limitPerTable: number
  identity: 'user' | 'bot'
}

interface LarkRecordListResponse {
  ok: boolean
  data?: {
    data?: unknown[][]
    fields?: string[]
    record_id_list?: string[]
  }
  error?: {
    message?: string
    type?: string
    subtype?: string
  }
}

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
  const identity = readArg(args, '--as') ?? 'user'
  if (identity !== 'user' && identity !== 'bot') {
    throw new Error(`Invalid --as ${identity}; expected user or bot`)
  }

  return {
    outFile: resolve(readArg(args, '--out') ?? DEFAULT_OUTPUT),
    limitPerTable: readNumber(args, '--limit-per-table', 20),
    identity,
  }
}

function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const values = value.map(asText).filter((item): item is string => Boolean(item))
    return values.length > 0 ? values.join('、') : undefined
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['text', 'name', 'value', 'title']) {
      const text = asText(record[key])
      if (text) return text
    }
    return JSON.stringify(value)
  }
  return String(value)
}

function readMapped(rawFields: Record<string, unknown>, fieldName: string | undefined): string | undefined {
  if (!fieldName) return undefined
  return asText(rawFields[fieldName])
}

function buildRecordListArgs(table: ProcurementBaseTableConfig, options: CliOptions): string[] {
  const args = [
    'base',
    '+record-list',
    '--as',
    options.identity,
    '--base-token',
    PROCUREMENT_BASE_TOKEN,
    '--table-id',
    table.tableId,
    '--limit',
    String(options.limitPerTable),
    '--format',
    'json',
  ]
  for (const field of table.fields) {
    args.push('--field-id', field)
  }
  return args
}

function runRecordList(table: ProcurementBaseTableConfig, options: CliOptions): LarkRecordListResponse {
  const child = spawnSync('lark-cli', buildRecordListArgs(table, options), {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  })

  const output = child.stdout.trim() || child.stderr.trim()
  if (!output) {
    throw new Error(`lark-cli returned no output for ${table.tableName}`)
  }

  try {
    return JSON.parse(output) as LarkRecordListResponse
  } catch (error) {
    throw new Error(`Failed to parse lark-cli JSON for ${table.tableName}: ${error instanceof Error ? error.message : String(error)}\n${output}`)
  }
}

function buildRawFields(fields: string[], row: unknown[]): Record<string, unknown> {
  const rawFields: Record<string, unknown> = {}
  fields.forEach((field, index) => {
    rawFields[field] = row[index]
  })
  return rawFields
}

function buildSeed(
  table: ProcurementBaseTableConfig,
  recordId: string,
  rawFields: Record<string, unknown>,
): ProcurementBaseSeed | null {
  const seedWithoutTags = {
    source: {
      baseName: PROCUREMENT_BASE_NAME,
      baseToken: PROCUREMENT_BASE_TOKEN,
      tableName: table.tableName,
      tableId: table.tableId,
      recordId,
      kind: table.kind,
    },
    model: readMapped(rawFields, table.map.model),
    brand: readMapped(rawFields, table.map.brand),
    quantity: readMapped(rawFields, table.map.quantity),
    price: readMapped(rawFields, table.map.price),
    supplierName: readMapped(rawFields, table.map.supplierName),
    supplierGrade: readMapped(rawFields, table.map.supplierGrade),
    updatedAt: readMapped(rawFields, table.map.updatedAt),
    shelf: readMapped(rawFields, table.map.shelf),
    stockType: readMapped(rawFields, table.map.stockType),
    productCategory: readMapped(rawFields, table.map.productCategory),
    supplierType: readMapped(rawFields, table.map.supplierType),
    region: readMapped(rawFields, table.map.region),
    providesStockSheet: readMapped(rawFields, table.map.providesStockSheet),
    rawFields,
  }

  if (table.kind !== 'supplier_profile' && !seedWithoutTags.model) return null
  if (table.kind === 'supplier_profile' && !seedWithoutTags.supplierName) return null

  return {
    ...seedWithoutTags,
    tags: buildProcurementSeedTags(seedWithoutTags),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const seeds: ProcurementBaseSeed[] = []
  const tableErrors: ProcurementSeedFile['tableErrors'] = []

  for (const table of PROCUREMENT_BASE_TABLES) {
    process.stderr.write(`Sampling ${table.tableName} (${table.tableId})...\n`)
    try {
      const response = runRecordList(table, options)
      if (!response.ok) {
        tableErrors.push({
          tableName: table.tableName,
          tableId: table.tableId,
          message: response.error?.message ?? JSON.stringify(response.error ?? response),
        })
        continue
      }

      const rows = response.data?.data ?? []
      const fields = response.data?.fields ?? []
      const recordIds = response.data?.record_id_list ?? []
      rows.forEach((row, index) => {
        const recordId = recordIds[index]
        if (!recordId) return
        const seed = buildSeed(table, recordId, buildRawFields(fields, row))
        if (seed) seeds.push(seed)
      })
    } catch (error) {
      tableErrors.push({
        tableName: table.tableName,
        tableId: table.tableId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (seeds.length === 0) {
    throw new Error(`No procurement Base seeds were sampled. Table errors: ${JSON.stringify(tableErrors, null, 2)}`)
  }

  const seedFile: ProcurementSeedFile = {
    generatedAt: new Date().toISOString(),
    baseName: PROCUREMENT_BASE_NAME,
    baseToken: PROCUREMENT_BASE_TOKEN,
    sampleLimitPerTable: options.limitPerTable,
    seeds,
    tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
  }

  mkdirSync(dirname(options.outFile), { recursive: true })
  writeFileSync(options.outFile, `${JSON.stringify(seedFile, null, 2)}\n`, 'utf8')
  process.stderr.write(`Wrote ${seeds.length} seeds to ${options.outFile}\n`)
  if (tableErrors.length > 0) {
    process.stderr.write(`Completed with ${tableErrors.length} table error(s); see tableErrors in the output JSON.\n`)
  }
}

await main()
