#!/usr/bin/env bun
/** Ensure product workspace package.json versions match root (not independent pkgs). */
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '..')
const rootVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string

const PRODUCT_PACKAGES = [
  'package.json',
  'apps/electron/package.json',
  'apps/viewer/package.json',
  'apps/webui/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
  'packages/core/package.json',
  'packages/ui/package.json',
  'packages/server/package.json',
  'packages/server-core/package.json',
  'packages/session-tools-core/package.json',
  'packages/session-mcp-server/package.json',
  'packages/pi-agent-server/package.json',
  'packages/messaging-gateway/package.json',
  'packages/messaging-whatsapp-worker/package.json',
]

const mismatches: string[] = []
for (const rel of PRODUCT_PACKAGES) {
  const p = join(root, rel)
  const v = JSON.parse(readFileSync(p, 'utf8')).version
  if (v !== rootVersion) mismatches.push(`${rel}: ${v} != ${rootVersion}`)
}
if (mismatches.length) {
  console.error('Version mismatch:\n' + mismatches.join('\n'))
  process.exit(1)
}
console.log(`OK: product packages version=${rootVersion} (${PRODUCT_PACKAGES.length} files)`)
