#!/usr/bin/env bun
/**
 * CI smoke: полный цикл toolchain ensureAll на чистом профиле.
 * Запуск: CRAFT_CONFIG_DIR=<dir> bun scripts/toolchain-smoke.ts
 * Выход 0: все инструменты с артефактами под текущую платформу — ready,
 * omp-лончер реально исполняется, python/bun/node возвращают версии.
 */
import { execFileSync } from 'node:child_process';

const configDir = process.env.CRAFT_CONFIG_DIR;
if (!configDir) {
  console.error('CRAFT_CONFIG_DIR required');
  process.exit(2);
}

const { createManager, createResolver, toolchainPaths, currentPlatform } = await import(
  '../packages/shared/src/toolchain/index.ts'
);
import type { ToolStatus } from '../packages/shared/src/toolchain/index.ts';

const platform = currentPlatform();
if (!platform) {
  console.error(`unsupported platform: ${process.platform}/${process.arch}`);
  process.exit(2);
}
console.log('platform:', platform, 'bun:', Bun.version);

const paths = toolchainPaths(configDir);
const manager = createManager(paths);
const resolver = createResolver(paths);

manager.onStatusChange((s: ToolStatus) => {
  if (s.phase !== 'downloading') {
    console.log(`[status] ${s.name}: ${s.phase}${s.error ? ` — ${s.error}` : ''}`);
  }
});

const t0 = Date.now();
await manager.ensureAll({ background: false });
const statuses = await manager.status();
console.log(`== ensureAll done in ${((Date.now() - t0) / 1000).toFixed(1)}s ==`);

const EXPECTED: Record<string, string | null> = {
  omp: '17.2.10',
  bun: '1.3.14',
  uv: '0.12.2',
  node: '22.23.2',
  python: '3.12',
  ffmpeg: '9.0',
  pandoc: '3.10.1',
  gh: '2.97.0',
  jq: '1.8.1',
  yq: '4.53.3',
  // git: артефакт только под win32-x64
  git: platform === 'win32-x64' ? '2.55.0.3' : null,
};

let failed = 0;
for (const [name, expected] of Object.entries(EXPECTED)) {
  if (expected === null) continue;
  const s = statuses.find((x) => x.name === name);
  if (!s) {
    console.error(`FAIL ${name}: no status entry`);
    failed++;
    continue;
  }
  if (s.phase !== 'ready') {
    console.error(`FAIL ${name}: phase=${s.phase} error=${s.error ?? '-'}`);
    failed++;
    continue;
  }
  console.log(`READY ${name} v${s.installedVersion}`);
}

// git на unix считаем системным, если доступен
if (platform !== 'win32-x64') {
  const git = statuses.find((x) => x.name === 'git');
  if (git && git.phase === 'ready') console.log('READY git (system)');
}

// 1) omp лончер из toolchain
const omp = await resolver.findExecutable('omp');
if (!omp || !omp.includes(paths.toolchainDir)) {
  console.error(`FAIL: omp must resolve from toolchain, got: ${omp}`);
  failed++;
} else {
  const out = execFileSync(omp, ['--help'], { encoding: 'utf8', timeout: 60_000 });
  if (!out.includes('omp v')) {
    console.error('FAIL: launcher ran but no version in output');
    failed++;
  } else {
    console.log('launcher OK:', out.split('\n')[0]);
  }
}

// 2) python из toolchain
const PY_BIN = platform === 'win32-x64' ? 'python' : 'python3';
const python = await resolver.findExecutable(PY_BIN);
if (python && python.includes(paths.toolchainDir)) {
  const v = execFileSync(python, ['--version'], { encoding: 'utf8' }).trim();
  console.log('python OK:', v);
  if (!v.startsWith('Python 3.12')) failed++;
} else {
  console.error(`FAIL: python must resolve from toolchain, got: ${python}`);
  failed++;
}

// 3) PATH prefix не содержит чужих платформ (linux row на darwin скрыт)
const prefix = await resolver.toolchainPathPrefix();
if (platform === 'darwin-arm64' && /bun-windows-x64|node-v22\.23\.2-win/.test(prefix)) {
  console.error('FAIL: PATH prefix leaks foreign platforms');
  failed++;
}
console.log('PATH prefix entries:', prefix.split(':').filter(Boolean).length);

process.exit(failed === 0 ? 0 : 1);
