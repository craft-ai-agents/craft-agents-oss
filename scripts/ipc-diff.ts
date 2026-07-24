import { RPC_CHANNELS } from '../apps/electron/src/shared/types'

function flatten(obj: Record<string, unknown>): string[] {
  return Object.values(obj).flatMap((v) =>
    typeof v === 'string'
      ? [v]
      : typeof v === 'object' && v !== null
        ? flatten(v as Record<string, unknown>)
        : [],
  )
}

const actual = flatten(RPC_CHANNELS).sort()
const testSrc = await Bun.file('./apps/electron/src/shared/__tests__/ipc-channels.test.ts').text()
const block = testSrc.split('const EXPECTED_CHANNELS: string[] = [')[1].split(']')[0]
const expected = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])

const missing = actual.filter((c) => !expected.includes(c))
const stale = expected.filter((c) => !actual.includes(c))

console.log('actual count :', actual.length)
console.log('expected count:', expected.length)
console.log('MISSING from manifest:', JSON.stringify(missing, null, 2))
console.log('STALE in manifest    :', JSON.stringify(stale, null, 2))
