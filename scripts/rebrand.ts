/**
 * One-shot rebrand: ARCHstudio → ARCHstudio
 * Run: cd D:\craft-agents-oss && bun scripts/rebrand.ts
 * Or:  npx tsx scripts/rebrand.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()

// ── Config ──
const TEXT_REPLACEMENTS: [RegExp, string][] = [
  // Display strings only — NOT package names, NOT env var names
  [/\bCraft Agents\b/g, 'ARCHstudio'],
  [/\bCraftAgents\b/g, 'ARCHstudio'],
]

const PATHS_TO_SKIP = new Set([
  'node_modules',
  '.git',
  'release',
  'dist',
  'bun.lock',
])

const EXTENSIONS = new Set([
  '.ts','.tsx','.js','.jsx','.json','.yml','.yaml','.md',
  '.html','.css','.svg','.txt',
])

// ── Walk ──
function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (PATHS_TO_SKIP.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, files)
    } else if (st.isFile() && EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      files.push(full)
    }
  }
  return files
}

// ── Run ──
let changed = 0
let scanned = 0

for (const file of walk(ROOT)) {
  const short = relative(ROOT, file)
  // Skip the script itself
  if (short === 'scripts/rebrand.ts') continue

  let content = readFileSync(file, 'utf-8')
  let original = content

  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    content = content.replace(pattern, replacement)
  }

  if (content !== original) {
    writeFileSync(file, content, 'utf-8')
    console.log(`✓ ${short}`)
    changed++
  }
  scanned++
}

// ── electron-builder.yml artifact names ──
const builderFile = join(ROOT, 'apps/electron/electron-builder.yml')
let builder = readFileSync(builderFile, 'utf-8')
builder = builder
  .replace(/Craft-Agents/g, 'ARCHstudio')
  .replace(/title: "ARCHstudio"/g, 'title: "ARCHstudio"')
  .replace(/ARCHstudio uses your local network/g, 'ARCHstudio uses your local network')
writeFileSync(builderFile, builder, 'utf-8')
console.log('✓ apps/electron/electron-builder.yml')

// ── package.json root description ──
const rootPkg = join(ROOT, 'package.json')
let pkg = readFileSync(rootPkg, 'utf-8')
pkg = pkg.replace(/"description": "ARCHstudio AI Agent"/, '"description": "ARCHstudio AI Super Studio"')
writeFileSync(rootPkg, pkg, 'utf-8')
console.log('✓ package.json')

console.log(`\nScanned ${scanned} files, modified ${changed + 2}`)
console.log('\nNEXT STEPS:')
console.log('1. Replace icon files in apps/electron/resources/ (icon.ico, icon.icns, icon.png, icon.svg)')
console.log('2. Edit apps/electron/src/renderer/components/icons/ARCHstudioLogo.tsx → draw your green/purple split-A SVG')
console.log('3. Edit apps/electron/src/renderer/components/icons/ARCHstudioSymbol.tsx → small A symbol')
console.log('4. Delete apps/electron/release/ and apps/electron/dist/ for clean build')
console.log('5. bun run build:win')
console.log('6. cd apps/electron && npx electron-builder --win --x64')
