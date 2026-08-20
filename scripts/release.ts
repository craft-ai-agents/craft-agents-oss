#!/usr/bin/env bun
/**
 * Minimal release helper: print version + packaging commands.
 * Full historical release CLI depended on removed OSS-sync paths.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const tag = `v${version}`

console.log(`Craft Agents ${tag}`)
console.log(`
Next steps:
  1. bun run check-version
  2. bun run electron:dist:dev:mac   # unsigned local
  3. gh release create ${tag} --title "${tag}" --notes-file RELEASE_NOTES_${version}.md apps/electron/release/*.dmg
`)
