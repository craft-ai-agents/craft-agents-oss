#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const SEARCH_ROOT = resolve(ROOT, 'apps/electron/src')
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build'])
const RAW_SEND = /(?:webContents|event\.sender|ipcRenderer)\.send\(\s*(['"])([^'"]+)\1/g
const ALLOWED_CHANNELS = new Map<string, Set<string>>([
  ['apps/electron/src/main/index.ts', new Set(['transfer:progress'])],
  ['apps/electron/src/preload/bootstrap.ts', new Set(['__transport:status'])],
])
const ALLOWED_CHANNEL_CONSTANT_FILES = new Set([
  'apps/electron/src/main/browser-pane-manager.ts',
  'apps/electron/src/main/window-manager.ts',
])

const violations: string[] = []
let checked = 0

function scan(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      scan(path)
      continue
    }
    if (!EXTENSIONS.has(extname(entry.name)) || /(?:^|[\\/])__tests__(?:[\\/]|$)|\.test\./.test(path)) continue

    const source = readFileSync(path, 'utf-8')
    const repoPath = relative(ROOT, path).replace(/\\/g, '/')
    for (const match of source.matchAll(RAW_SEND)) {
      checked += 1
      const channel = match[2]!
      if (ALLOWED_CHANNELS.get(repoPath)?.has(channel)) continue
      violations.push(`${repoPath}: raw IPC channel "${channel}"`)
    }

    if (/(?:webContents|event\.sender|ipcRenderer)\.send\(\s*[A-Z][A-Z0-9_.]+/.test(source)
      && !ALLOWED_CHANNEL_CONSTANT_FILES.has(repoPath)) {
      violations.push(`${repoPath}: direct IPC constant send must be routed through the transport or explicitly reviewed`)
    }
  }
}

scan(SEARCH_ROOT)

if (violations.length > 0) {
  console.error('Raw IPC send check failed:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(`Raw IPC send check OK (${checked} reviewed literal send calls)`)
