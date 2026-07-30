#!/usr/bin/env bun
/**
 * scripts/sync-branding.ts
 *
 * Reads brand constants from packages/shared/src/branding.ts and patches
 * non-TypeScript config files that cannot import from it:
 *
 *   - apps/electron/electron-builder.yml  (appId, title, artifactName)
 *   - apps/electron/package.json          (description)
 *   - Dockerfile.server                   (labels, user, home, image name)
 *   - apps/electron/resources/config-defaults.json (description)
 *
 * Usage:
 *   bun run sync:branding          # apply patches, print diff summary
 *   bun run sync:branding --check  # exit 1 if any file would change
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')

// ── Import brand constants from the single source of truth ────────────────
import {
  APP_NAME,
  APP_ID,
  EXECUTABLE,
  DOCKER_USER,
  DOCKER_HOME,
} from '../packages/shared/src/branding'

// ── Helpers ───────────────────────────────────────────────────────────────

function load(relPath: string): string {
  const abs = join(ROOT, relPath)
  if (!existsSync(abs)) {
    console.error(`⚠️  File not found: ${relPath}`)
    return ''
  }
  return readFileSync(abs, 'utf-8')
}

function save(relPath: string, content: string): void {
  writeFileSync(join(ROOT, relPath), content, 'utf-8')
}

interface Patch {
  file: string
  find: RegExp
  replace: string
  description: string
}

const CHECK_MODE = process.argv.includes('--check')
let changes = 0

function applyPatch(patch: Patch): void {
  const original = load(patch.file)
  if (!original) return

  const updated = original.replace(patch.find, patch.replace)
  if (updated === original) return

  changes++
  if (CHECK_MODE) {
    console.error(`❌ Would change: ${patch.file} — ${patch.description}`)
  } else {
    save(patch.file, updated)
    console.log(`✅ Patched: ${patch.file} — ${patch.description}`)
  }
}

// ── Patches ───────────────────────────────────────────────────────────────

const patches: Patch[] = [
  // electron-builder.yml — appId
  {
    file: 'apps/electron/electron-builder.yml',
    find: /^appId:\s+.*/m,
    replace: `appId: ${APP_ID}`,
    description: 'appId',
  },
  // electron-builder.yml — title
  {
    file: 'apps/electron/electron-builder.yml',
    find: /^title:\s+.*/m,
    replace: `title: ${APP_NAME}`,
    description: 'dmg title',
  },
  // electron-builder.yml — artifactName patterns (replace brand prefix only, preserve ${arch}.${ext})
  {
    file: 'apps/electron/electron-builder.yml',
    find: /artifactName:\s+["'][A-Za-z][A-Za-z-]+-/g,
    replace: `artifactName: "${APP_NAME}-`,
    description: 'artifactName prefix',
  },
  // electron-builder.yml — NSLocalNetworkUsageDescription
  {
    file: 'apps/electron/electron-builder.yml',
    find: /NSLocalNetworkUsageDescription:\s*"[^"]*"/,
    replace: `NSLocalNetworkUsageDescription: "${APP_NAME} uses your local network to reach LAN addresses and devices you ask an agent to access, such as local servers or APIs."`,
    description: 'NSLocalNetworkUsageDescription',
  },
  // package.json — description
  {
    file: 'apps/electron/package.json',
    find: /"description":\s*"[^"]*ARCHstudio[^"]*"/,
    replace: `"description": "Electron desktop app for ${APP_NAME}"`,
    description: 'package.json description',
  },
  // Dockerfile.server — LABEL description (builder stage)
  {
    file: 'Dockerfile.server',
    find: /LABEL org\.opencontainers\.image\.description="ARCHstudio Server/g,
    replace: `LABEL org.opencontainers.image.description="${APP_NAME} Server`,
    description: 'Dockerfile OCI description (builder)',
  },
  // Dockerfile.server — LABEL description (runtime stage)
  {
    file: 'Dockerfile.server',
    find: /LABEL org\.opencontainers\.image\.description="ARCHstudio Server/g,
    replace: `LABEL org.opencontainers.image.description="${APP_NAME} Server`,
    description: 'Dockerfile OCI description (runtime)',
  },
  // Dockerfile.server — useradd (match with any leading whitespace — continuation lines are indented)
  {
    file: 'Dockerfile.server',
    find: /^\s*useradd\s+-r\s+-g\s+\S+\s+-m\s+-d\s+\/home\/\S+\s+-s\s+\/bin\/bash\s+\S+/m,
    replace: `    useradd -r -g ${DOCKER_USER} -m -d ${DOCKER_HOME} -s /bin/bash ${DOCKER_USER}`,
    description: 'Dockerfile useradd',
  },
  // Dockerfile.server — WORKDIR home
  {
    file: 'Dockerfile.server',
    find: /mkdir -p \/home\/archstudio/m,
    replace: `mkdir -p ${DOCKER_HOME}`,
    description: 'Dockerfile home dir',
  },
  // config-defaults.json — description
  {
    file: 'apps/electron/resources/config-defaults.json',
    find: /"description":\s*"[^"]*ARCHstudio[^"]*"/,
    replace: `"description": "Default configuration values for ${APP_NAME}"`,
    description: 'config-defaults description',
  },
]

// ── Run ───────────────────────────────────────────────────────────────────

console.log(CHECK_MODE ? '🔍 Checking branding consistency...\n' : '🔄 Syncing branding to config files...\n')

for (const patch of patches) {
  applyPatch(patch)
}

console.log('')
if (changes === 0) {
  console.log('✅ All config files are in sync with branding.ts')
} else if (CHECK_MODE) {
  console.error(`\n❌ ${changes} file(s) would change — run \`bun run sync:branding\` to apply`)
  process.exit(1)
} else {
  console.log(`\n📝 Patched ${changes} file(s)`)
}
