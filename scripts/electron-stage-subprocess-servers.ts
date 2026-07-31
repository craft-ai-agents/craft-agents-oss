/**
 * Build + stage the Node subprocess servers that the packaged Electron app
 * spawns at runtime.
 *
 * Why this exists
 * ---------------
 * `runtime-resolver.ts` resolves these servers differently per mode:
 *
 *   dev       -> packages/<name>/dist/index.js        (resolved upwards)
 *   packaged  -> <appRoot>/resources/<name>/index.js
 *
 * `electron-builder.yml` lists `resources/<name>/**` in `files:`, but nothing
 * ever populated `apps/electron/resources/{pi-agent-server,session-mcp-server}`.
 * The dev path existed, so ChatGPT/Codex sessions worked from source and then
 * failed in every installed build with:
 *
 *   "piServerPath not configured. Cannot spawn Pi subprocess."
 *
 * Pi SDK is the backend for all non-Anthropic providers (ChatGPT/Codex,
 * Copilot), so the packaged app could not run them at all.
 *
 * This script builds each package and copies its bundle to the staging path
 * that `electron:build:resources` then mirrors into `dist/resources/`.
 *
 * Runs on every `electron:build`. The bundles are small and bun builds them in
 * seconds; doing it unconditionally is cheaper than shipping a stale — or
 * absent — subprocess and only discovering it after install.
 */

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const STAGE_DIR = join(ROOT, 'apps/electron/resources')

/**
 * `bridge-mcp-server` is deliberately absent: its bundle is committed directly
 * under `apps/electron/resources/bridge-mcp-server/` rather than built here.
 */
const SERVERS = ['session-mcp-server', 'pi-agent-server'] as const

let failed = false

for (const name of SERVERS) {
  const pkgDir = join(ROOT, 'packages', name)
  if (!existsSync(pkgDir)) {
    console.error(`✗ ${name}: package directory missing at ${pkgDir}`)
    failed = true
    continue
  }

  const built = Bun.spawnSync(['bun', 'run', 'build'], { cwd: pkgDir, stdout: 'pipe', stderr: 'pipe' })
  if (built.exitCode !== 0) {
    console.error(`✗ ${name}: build failed\n${built.stderr.toString()}`)
    failed = true
    continue
  }

  const src = join(pkgDir, 'dist', 'index.js')
  if (!existsSync(src)) {
    console.error(`✗ ${name}: build produced no dist/index.js`)
    failed = true
    continue
  }

  const destDir = join(STAGE_DIR, name)
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, join(destDir, 'index.js'))
  const mb = (statSync(src).size / 1024 / 1024).toFixed(1)
  console.log(`📦 staged ${name} (${mb} MB) -> resources/${name}/index.js`)
}

if (failed) {
  // Fail loudly. A silent skip here is exactly how the packaged app shipped
  // without a Pi server in the first place.
  console.error('\nSubprocess server staging failed — the packaged app would be unable to spawn them.')
  process.exit(1)
}
