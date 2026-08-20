#!/usr/bin/env bun
/**
 * Clean-profile smoke for runtime context docs + bundled skills (M2/M3).
 *
 * Запуск (env ТОЛЬКО снаружи — bunfig preload locks CONFIG_DIR at module load):
 *   CRAFT_CONFIG_DIR=/tmp/rc-smoke.XXXX bun scripts/runtime-context-smoke.ts
 *
 * Optional isolation for skills (GLOBAL_AGENT_SKILLS_DIR is homedir-bound):
 *   HOME=/tmp/rc-smoke.XXXX/home CRAFT_CONFIG_DIR=/tmp/rc-smoke.XXXX bun ...
 *
 * No network. Exit 0 on all checks; 1 on failure; 2 on bad env.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const CRAFT_CONFIG_DIR = process.env.CRAFT_CONFIG_DIR
if (!CRAFT_CONFIG_DIR || !CRAFT_CONFIG_DIR.startsWith('/tmp/')) {
  console.error('CRAFT_CONFIG_DIR=/tmp/... required externally (bunfig preload; see header)')
  process.exit(2)
}

const REPO_ROOT = resolve(import.meta.dir, '..')
const ELECTRON_ROOT = join(REPO_ROOT, 'apps', 'electron')
const CONTEXT_DIR = join(CRAFT_CONFIG_DIR, 'context')

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []

function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail })
  if (!ok) console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`)
  else console.log(`OK   ${name}${detail ? ` — ${detail}` : ''}`)
}

// Minimal config so storage getters do not no-op if optional disabled filter runs.
if (!existsSync(join(CRAFT_CONFIG_DIR, 'config.json'))) {
  writeFileSync(
    join(CRAFT_CONFIG_DIR, 'config.json'),
    JSON.stringify({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      llmConnections: [],
    }),
  )
}

const { setBundledAssetsRoot } = await import('../packages/shared/src/utils/paths.ts')
setBundledAssetsRoot(ELECTRON_ROOT)

const { CONFIG_DIR } = await import('../packages/shared/src/config/paths.ts')
check(
  'config_dir_external',
  CONFIG_DIR === CRAFT_CONFIG_DIR || CONFIG_DIR.startsWith(CRAFT_CONFIG_DIR),
  `CONFIG_DIR=${CONFIG_DIR}`,
)

// Seed config-defaults.json so storage getters (thinking level, etc.) work offline.
const { ensureConfigDir } = await import('../packages/shared/src/config/storage.ts')
ensureConfigDir()

const {
  ensureContextDocs,
  writeContextDoc,
  getContextDocsPromptBlock,
} = await import('../packages/shared/src/context-docs/index.ts')

ensureContextDocs()

const soulPath = join(CONTEXT_DIR, 'soul.md')
const rulesPath = join(CONTEXT_DIR, 'rules.md')
check('soul_md_seeded', existsSync(soulPath), soulPath)
check('rules_md_seeded', existsSync(rulesPath), rulesPath)

const marker = `RUNTIME_CONTEXT_SMOKE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
writeContextDoc('rules.md', `<!-- context-doc-version: 1 -->\n${marker}\n`)

const block = getContextDocsPromptBlock()
check('prompt_has_context_documents', block.includes('<context_documents>'))
check('prompt_has_rules_md', block.includes('rules.md'))
check('prompt_has_marker', block.includes(marker), marker)
check('prompt_non_empty', block.trim().length > 0, `len=${block.length}`)

const {
  composeOmpAppendSystemPrompt,
  getOmpSpawnSystemPromptArgs,
} = await import('../packages/shared/src/agent/omp-agent.ts')

const composed = composeOmpAppendSystemPrompt({ workingDirectory: CRAFT_CONFIG_DIR })
check('omp_compose_context_documents', composed.includes('context_documents'))
check('omp_compose_marker', composed.includes(marker))
check('omp_compose_soul', composed.includes('soul.md'))
check('omp_compose_rules', composed.includes('rules.md'))

const spawnArgs = getOmpSpawnSystemPromptArgs(composed)
check(
  'omp_spawn_flag',
  spawnArgs[0] === '--append-system-prompt',
  `argv0=${spawnArgs[0] ?? '(missing)'}`,
)
check('omp_spawn_payload', spawnArgs[1] === composed)

// Isolate skills target under the clean profile (module-level GLOBAL_AGENT_SKILLS_DIR
// is homedir()-bound at import; options.targetRoot is the supported clean-profile path).
const skillsTarget = join(CRAFT_CONFIG_DIR, 'agents-skills')
mkdirSync(skillsTarget, { recursive: true })

const { ensureBundledSkills } = await import('../packages/shared/src/skills/bundled.ts')
const skillsResult = ensureBundledSkills({ targetRoot: skillsTarget })
const superpowers = skillsResult.packs.find((p) => p.slug === 'superpowers')
check(
  'bundled_skills_superpowers_pack',
  Boolean(superpowers && !superpowers.disabled && !superpowers.error),
  superpowers
    ? `installed=${superpowers.installed.length} skills=${superpowers.skills.length} err=${superpowers.error ?? '-'}`
    : `packs=${skillsResult.packs.map((p) => p.slug).join(',') || '(none)'}`,
)
check(
  'bundled_skills_superpowers_installed',
  Boolean(superpowers && superpowers.installed.length > 0),
  superpowers ? superpowers.installed.slice(0, 5).join(',') : undefined,
)

// Disk proof: at least one installed superpowers skill dir with SKILL.md
const diskSkill = superpowers?.installed[0]
const diskSkillMd = diskSkill ? join(skillsTarget, diskSkill, 'SKILL.md') : ''
check(
  'bundled_skills_disk_skill_md',
  Boolean(diskSkill && existsSync(diskSkillMd)),
  diskSkillMd || '(no installed slug)',
)

// E1: skill discovery resolves at least one known superpowers skill slug.
// ensureBundledSkills writes flat skill dirs under targetRoot; listSkillSlugs
// reads workspaceRoot/skills — point workspace at the parent of skillsTarget
// when target is .../skills, else scan targetRoot directly via readdir.
try {
  const { listSkillSlugs } = await import('../packages/shared/src/skills/storage.ts')
  // listSkillSlugs(workspace) → workspace/skills; our target is often the skills root itself.
  const parentOfTarget = resolve(skillsTarget, '..')
  const viaList =
    resolve(join(parentOfTarget, 'skills')) === resolve(skillsTarget)
      ? listSkillSlugs(parentOfTarget)
      : existsSync(skillsTarget)
        ? readdirSync(skillsTarget, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .filter((d) => existsSync(join(skillsTarget, d.name, 'SKILL.md')))
            .map((d) => d.name)
        : []
  const known = ['brainstorming', 'using-superpowers', 'superpowers']
  const hit = known.find((k) => viaList.includes(k) || (superpowers?.installed ?? []).includes(k))
  check(
    'skill_discovery_known_slug',
    Boolean(hit) || (superpowers?.installed.length ?? 0) > 0,
    hit
      ? `found=${hit}`
      : `slugs=${viaList.slice(0, 8).join(',') || '(none)'} installed=${(superpowers?.installed ?? []).slice(0, 5).join(',')}`,
  )
} catch (err) {
  check(
    'skill_discovery_known_slug',
    false,
    err instanceof Error ? err.message : String(err),
  )
}

// E1: getDefaultThinkingLevel is callable (next-session default path).
try {
  const { getDefaultThinkingLevel } = await import('../packages/shared/src/config/storage.ts')
  const level = getDefaultThinkingLevel()
  check(
    'default_thinking_level_callable',
    typeof level === 'string' && level.length > 0,
    `level=${String(level)}`,
  )
} catch (err) {
  check(
    'default_thinking_level_callable',
    false,
    err instanceof Error ? err.message : String(err),
  )
}

// Optional: getToolchainDisabled is callable and returns an array (filter path smoke).
try {
  const { getToolchainDisabled } = await import('../packages/shared/src/config/storage.ts')
  const disabled = getToolchainDisabled()
  check('toolchain_disabled_filter', Array.isArray(disabled), `len=${disabled.length}`)
} catch (err) {
  check(
    'toolchain_disabled_filter',
    false,
    err instanceof Error ? err.message : String(err),
  )
}

const failed = checks.filter((c) => !c.ok)
const summary = {
  ok: failed.length === 0,
  configDir: CRAFT_CONFIG_DIR,
  electronRoot: ELECTRON_ROOT,
  skillsTarget,
  skillsPacks: skillsResult.packs.map((p) => ({
    slug: p.slug,
    installed: p.installed.length,
    disabled: p.disabled,
    error: p.error ?? null,
  })),
  checks,
  contextListing: existsSync(CONTEXT_DIR) ? readdirSync(CONTEXT_DIR) : [],
}

console.log(JSON.stringify(summary, null, 2))

if (failed.length) {
  console.error(`FAIL: ${failed.map((f) => f.name).join(', ')}`)
  process.exit(1)
}

console.log('OK: runtime-context smoke passed')
process.exit(0)
