/**
 * Runtime-smoke новых компонентов toolchain (M1): реальная установка в чистый
 * CRAFT_CONFIG_DIR и запуск установленных бинарей.
 * Запуск: CRAFT_CONFIG_DIR=/tmp/craft-toolchain-smoke bun scripts/toolchain-new-smoke.ts [--tools just,fzf,...]
 * ВНИМАНИЕ: не задаём env внутри — корневой bunfig.toml preload грузит
 * config/paths.ts ДО тела скрипта; только внешний env до процесса.
 */
const CRAFT_CONFIG_DIR = process.env.CRAFT_CONFIG_DIR
if (!CRAFT_CONFIG_DIR || !CRAFT_CONFIG_DIR.startsWith('/tmp/')) {
  console.error('Задай CRAFT_CONFIG_DIR=/tmp/... снаружи (см. header)')
  process.exit(2)
}

const toolsArg = process.argv.indexOf('--tools')
const TOOLS: string[] = toolsArg >= 0
  ? process.argv[toolsArg + 1]!.split(',')
  : ['just', 'fzf', 'mise', 'worktrunk', 'skills']

// Динамический импорт намеренно: CONFIG_DIR — module-load const в shared/config/paths.ts,
// env CRAFT_CONFIG_DIR должен быть выставлен ДО загрузки модуля (см. scripts/toolchain-smoke.ts).
const { CONFIG_DIR } = await import('../packages/shared/src/config/paths.ts')
const { createManager, createResolver, toolchainPaths } = await import('../packages/shared/src/toolchain/index.ts')

const paths = toolchainPaths(CONFIG_DIR)
const manager = createManager(paths)
const results: Record<string, string> = {}

for (const name of TOOLS) {
  const t0 = Date.now()
  try {
    const status = await manager.update(name as never)
    results[name] = `${status.phase} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  } catch (err) {
    results[name] = `ERROR: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`
  }
}

// Resolver: бинарь находится и отвечает --version
const resolver = createResolver(paths)
for (const name of TOOLS) {
  const exe = await resolver.findExecutable(name as never)
  if (exe) {
    const run = Bun.spawnSync([exe, '--version'], { timeout: 15_000 })
    const out = `${run.stdout.toString()}${run.stderr.toString()}`.trim().split('\n')[0] ?? ''
    results[name] += ` exe=${exe.includes('toolchain') ? 'toolchain' : 'system'} ver="${out.slice(0, 60)}"`
  } else {
    results[name] += ' exe=NOT-FOUND'
  }
}

console.log(JSON.stringify(results, null, 2))
const failures = Object.entries(results).filter(([, v]) => v.includes('ERROR') || v.includes('NOT-FOUND'))
if (failures.length) {
  console.error(`FAIL: ${failures.map(([k]) => k).join(', ')}`)
  process.exit(1)
}
console.log('OK: все инструменты установлены и резолвятся')
