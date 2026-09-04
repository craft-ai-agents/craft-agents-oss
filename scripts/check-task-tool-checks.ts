#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const SOURCE_ROOTS = [resolve(ROOT, 'apps'), resolve(ROOT, 'packages')]
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage'])
const DIRECT_TASK_CHECK = /(?:\btoolName|\.toolName)\s*(?:===|!==|==|!=)\s*(['"])Task\1/g
const violations: string[] = []

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
    if (DIRECT_TASK_CHECK.test(source)) {
      violations.push(relative(ROOT, path).replace(/\\/g, '/'))
    }
    DIRECT_TASK_CHECK.lastIndex = 0
  }
}

for (const sourceRoot of SOURCE_ROOTS) scan(sourceRoot)

if (violations.length > 0) {
  console.error('Task tool-name check failed. Use isParentTaskTool() so provider aliases remain supported:')
  for (const violation of violations.sort()) console.error(`  ${violation}`)
  process.exit(1)
}

console.log('Task tool-name check OK')
