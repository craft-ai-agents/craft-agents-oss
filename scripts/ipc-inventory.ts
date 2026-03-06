#!/usr/bin/env bun
/**
 * IPC Channel Inventory Generator (Step 0 of Phase 2A)
 *
 * Reads RPC_CHANNELS from shared/types.ts and generates:
 * 1. Sorted snapshot array — all wire strings, alphabetically sorted
 * 2. Grouped namespace object — the new nested RPC_CHANNELS structure
 * 3. Migration report — OLD_KEY → NEW_KEY for every channel
 * 4. Channel count — exact number N
 *
 * Merge rules:
 * - session:* (3 channels) → sessions namespace
 * - browser-empty-state:* (1 channel) → browserPane namespace
 * - workspaceSettings:* (2 channels) → workspace namespace
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const TYPES_PATH = join(import.meta.dir, '..', 'apps', 'electron', 'src', 'shared', 'types.ts')

// ── Extract RPC_CHANNELS from source ──

const source = readFileSync(TYPES_PATH, 'utf-8')

// Find the RPC_CHANNELS block
const channelBlockMatch = source.match(
  /export const RPC_CHANNELS = \{([\s\S]*?)\} as const/
)
if (!channelBlockMatch) {
  console.error('ERROR: Could not find RPC_CHANNELS definition in types.ts')
  process.exit(1)
}

const block = channelBlockMatch[1]

// Extract all KEY: 'value' pairs
const entryRegex = /^\s*(\w+)\s*:\s*'([^']+)'/gm
const entries: Array<{ oldKey: string; wireValue: string }> = []
let match: RegExpExecArray | null

while ((match = entryRegex.exec(block)) !== null) {
  entries.push({ oldKey: match[1], wireValue: match[2] })
}

console.log(`\n=== IPC Channel Inventory ===`)
console.log(`Total channels: ${entries.length}`)

// ── Group by wire-format prefix ──

// Merge rules: map wire prefix → target namespace
const MERGE_RULES: Record<string, string> = {
  'session': 'sessions',
  'browser-empty-state': 'browserPane',
  'workspaceSettings': 'workspace',
}

// Convert wire prefix to namespace key (camelCase)
function prefixToNamespace(wirePrefix: string): string {
  if (MERGE_RULES[wirePrefix]) return MERGE_RULES[wirePrefix]
  // Convert kebab-case to camelCase: "browser-pane" → "browserPane"
  return wirePrefix.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

// Get the wire prefix (everything before the first ':')
function getWirePrefix(wire: string): string {
  const idx = wire.indexOf(':')
  return idx >= 0 ? wire.substring(0, idx) : wire
}

// Generate new key name from wire value within its namespace
function generateNewKey(wireValue: string, wirePrefix: string): string {
  // Get the action part after the prefix and ':'
  const action = wireValue.substring(wirePrefix.length + 1)

  // Convert to UPPER_SNAKE_CASE
  // Handle camelCase: insertBefore uppercase letters
  let snaked = action
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase()

  return snaked
}

// Group channels into namespaces
interface NamespaceEntry {
  newKey: string
  wireValue: string
  wirePrefix: string  // original wire prefix (may differ from namespace due to merge)
}

const namespaces = new Map<string, NamespaceEntry[]>()
const migrationMap: Array<{
  oldKey: string
  newPath: string
  wireValue: string
  wirePrefix: string
  namespace: string
}> = []

for (const { oldKey, wireValue } of entries) {
  const wirePrefix = getWirePrefix(wireValue)
  const ns = prefixToNamespace(wirePrefix)
  const newKey = generateNewKey(wireValue, wirePrefix)

  if (!namespaces.has(ns)) namespaces.set(ns, [])
  namespaces.get(ns)!.push({ newKey, wireValue, wirePrefix })

  migrationMap.push({
    oldKey,
    newPath: `RPC_CHANNELS.${ns}.${newKey}`,
    wireValue,
    wirePrefix,
    namespace: ns,
  })
}

// ── Output 1: Sorted snapshot array ──

const sortedWireStrings = entries.map(e => e.wireValue).sort()

console.log(`\n--- Sorted Wire Strings (${sortedWireStrings.length} total) ---`)
console.log('const EXPECTED_CHANNELS: string[] = [')
for (const s of sortedWireStrings) {
  console.log(`  '${s}',`)
}
console.log(']')

// ── Output 2: Namespace object ──

// Sort namespace keys
const sortedNamespaces = [...namespaces.keys()].sort()

console.log(`\n--- Namespace Count: ${sortedNamespaces.length} ---`)
console.log(`\n--- Grouped Namespace Object ---`)
console.log('export const RPC_CHANNELS = {')

for (const ns of sortedNamespaces) {
  const nsEntries = namespaces.get(ns)!
  // Check for duplicate keys within namespace
  const keySet = new Set<string>()
  for (const entry of nsEntries) {
    if (keySet.has(entry.newKey)) {
      // Resolve collision by prepending the wire prefix difference
      const wirePrefix = entry.wirePrefix
      const mergedFrom = Object.entries(MERGE_RULES).find(([_, v]) => v === ns)?.[0]
      if (mergedFrom && wirePrefix === mergedFrom) {
        // This entry was merged — prefix with original domain hint
        const hint = mergedFrom.replace(/-/g, '_').toUpperCase()
        entry.newKey = `${hint}_${entry.newKey}`
      }
    }
    keySet.add(entry.newKey)
  }

  console.log(`  ${ns}: {`)
  for (const { newKey, wireValue, wirePrefix } of nsEntries) {
    const mergedNote = MERGE_RULES[wirePrefix] ? `  // merged from '${wirePrefix}' prefix` : ''
    console.log(`    ${newKey}: '${wireValue}',${mergedNote}`)
  }
  console.log(`  },`)
}

console.log('} as const')

// ── Output 3: Migration report ──

console.log(`\n--- Migration Report (${migrationMap.length} entries) ---`)
console.log('OLD_KEY → NEW_PATH')
for (const { oldKey, newPath, wireValue } of migrationMap) {
  console.log(`  ${oldKey} → ${newPath}  // '${wireValue}'`)
}

// ── Output 4: Prefix analysis ──

const prefixCounts = new Map<string, number>()
for (const { wireValue } of entries) {
  const prefix = getWirePrefix(wireValue)
  prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1)
}

console.log(`\n--- Wire Prefix Analysis (${prefixCounts.size} distinct prefixes) ---`)
for (const [prefix, count] of [...prefixCounts.entries()].sort()) {
  const mergeTarget = MERGE_RULES[prefix]
  const mergeNote = mergeTarget ? ` → MERGES INTO '${mergeTarget}'` : ''
  console.log(`  ${prefix}: ${count} channels${mergeNote}`)
}

console.log(`\n--- Summary ---`)
console.log(`Total channels: ${entries.length}`)
console.log(`Distinct wire prefixes: ${prefixCounts.size}`)
console.log(`After merges: ${sortedNamespaces.length} namespaces`)

// ── Check for duplicate wire values ──
const wireSet = new Set<string>()
const dupes: string[] = []
for (const { wireValue } of entries) {
  if (wireSet.has(wireValue)) dupes.push(wireValue)
  wireSet.add(wireValue)
}
if (dupes.length > 0) {
  console.log(`\n⚠️  DUPLICATE WIRE VALUES: ${dupes.join(', ')}`)
} else {
  console.log(`\n✓ No duplicate wire values`)
}
