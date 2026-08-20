#!/usr/bin/env bun
/**
 * scripts/toolchain-locks.ts — генератор pinned-записей toolchain (M1).
 *
 * Для каждого нового инструмента:
 *   binary: ищет latest stable release на GitHub, sha256 берёт из официальных
 *           checksum-файлов релиза (SHA256SUMS/checksums.txt/SHASUMS256.txt/
 *           per-asset .sha256); если их нет — скачивает и считает сам.
 *           darwin-arm64 артефакт дополнительно скачивается, перепроверяется
 *           и запускается (`--version`) — хост разработки mac-arm64.
 *   npm:    качает tarball с registry.npmjs.org (sha256/size для манифеста),
 *           генерирует package-lock.json (`npm install --package-lock-only
 *           --omit=dev`) и выводит base64 для npm-locks.ts (fail-closed).
 *   git:    качает codeload-tarball по pinned commit, sha256/size для GIT_LOCKS.
 *   pip:    `uv pip compile --generate-hashes` → фрагмент для pip-locks.ts.
 *
 * Запуск:
 *   bun scripts/toolchain-locks.ts [--only name1,name2] [--out <dir>]
 *   bun scripts/toolchain-locks.ts pip <name>@<version> <pypi-spec>
 *     pypi-spec example: 'cli-anything-hub==0.4.1' or 'packaging==24.2'
 * По умолчанию пишет сгенерированные TS-фрагменты в /tmp/toolchain-locks-out/.
 * Фрагменты вставляются в manifest-data.ts / npm-locks.ts / pip-locks.ts вручную.
 *
 * Зависимости: bun, npm (npm-режим), uv (pip-режим), tar.
 * Сеть: api.github.com, registry.npmjs.org, PyPI.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Спецификации (источник: PRD §4.1 / план §2.7, верификация GitHub API 2026-08-07)
// ---------------------------------------------------------------------------

type Platform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64';
const PLATFORMS: Platform[] = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

interface BinaryPlatformSpec {
  /** Имя release-asset (функция от tag'а, если версия в имени). */
  asset: (tag: string) => string;
  archive: 'tar.gz' | 'tar.xz' | 'zip';
  binPaths: string[];
}

interface BinaryToolSpec {
  kind: 'binary';
  repo: string;
  displayName: string;
  /** Файл(ы) checksums в релизе: (tag) => имя asset. Per-asset `.sha256` если 'per-asset'. */
  checksums: ((tag: string) => string[]) | 'per-asset' | 'none';
  version: (tag: string) => string;
  platforms: Partial<Record<Platform, BinaryPlatformSpec>>;
}

const BINARY_TOOLS: Record<string, BinaryToolSpec> = {
  just: {
    kind: 'binary',
    repo: 'casey/just',
    displayName: 'just',
    checksums: () => ['SHA256SUMS'],
    version: (tag) => tag.replace(/^v/, ''),
    platforms: {
      'darwin-arm64': {
        asset: (t) => `just-${t.replace(/^v/, '')}-aarch64-apple-darwin.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['just'],
      },
      'darwin-x64': {
        asset: (t) => `just-${t.replace(/^v/, '')}-x86_64-apple-darwin.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['just'],
      },
      'linux-x64': {
        asset: (t) => `just-${t.replace(/^v/, '')}-x86_64-unknown-linux-musl.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['just'],
      },
      'win32-x64': {
        asset: (t) => `just-${t.replace(/^v/, '')}-x86_64-pc-windows-msvc.zip`,
        archive: 'zip',
        binPaths: ['just.exe'],
      },
    },
  },
  fzf: {
    kind: 'binary',
    repo: 'junegunn/fzf',
    displayName: 'fzf',
    checksums: (t) => [`fzf_${t.replace(/^v/, '')}_checksums.txt`],
    version: (tag) => tag.replace(/^v/, ''),
    platforms: {
      'darwin-arm64': {
        asset: (t) => `fzf-${t.replace(/^v/, '')}-darwin_arm64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['fzf'],
      },
      'darwin-x64': {
        asset: (t) => `fzf-${t.replace(/^v/, '')}-darwin_amd64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['fzf'],
      },
      'linux-x64': {
        asset: (t) => `fzf-${t.replace(/^v/, '')}-linux_amd64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['fzf'],
      },
      'win32-x64': {
        asset: (t) => `fzf-${t.replace(/^v/, '')}-windows_amd64.zip`,
        archive: 'zip',
        binPaths: ['fzf.exe'],
      },
    },
  },
  mise: {
    kind: 'binary',
    repo: 'jdx/mise',
    displayName: 'mise',
    checksums: () => ['SHASUMS256.txt'],
    version: (tag) => tag.replace(/^v/, ''),
    platforms: {
      'darwin-arm64': {
        asset: (t) => `mise-${t}-macos-arm64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['mise/bin/mise'],
      },
      'darwin-x64': {
        asset: (t) => `mise-${t}-macos-x64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['mise/bin/mise'],
      },
      'linux-x64': {
        asset: (t) => `mise-${t}-linux-x64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['mise/bin/mise'],
      },
      'win32-x64': {
        asset: (t) => `mise-${t}-windows-x64.zip`,
        archive: 'zip',
        binPaths: ['mise/bin/mise.exe'],
      },
    },
  },
  worktrunk: {
    kind: 'binary',
    repo: 'max-sixty/worktrunk',
    displayName: 'worktrunk (wt)',
    checksums: 'per-asset',
    version: (tag) => tag.replace(/^v/, ''),
    platforms: {
      'darwin-arm64': {
        asset: () => 'worktrunk-aarch64-apple-darwin.tar.xz',
        archive: 'tar.xz',
        binPaths: ['worktrunk-aarch64-apple-darwin/wt'],
      },
      'darwin-x64': {
        asset: () => 'worktrunk-x86_64-apple-darwin.tar.xz',
        archive: 'tar.xz',
        binPaths: ['worktrunk-x86_64-apple-darwin/wt'],
      },
      'linux-x64': {
        asset: () => 'worktrunk-x86_64-unknown-linux-musl.tar.xz',
        archive: 'tar.xz',
        binPaths: ['worktrunk-x86_64-unknown-linux-musl/wt'],
      },
      'win32-x64': {
        asset: () => 'worktrunk-x86_64-pc-windows-msvc.zip',
        archive: 'zip',
        binPaths: ['worktrunk-x86_64-pc-windows-msvc/wt.exe'],
      },
    },
  },
  infisical: {
    kind: 'binary',
    repo: 'Infisical/cli',
    displayName: 'Infisical CLI',
    checksums: (t) => [`cli_${t.replace(/^v/, '')}_checksums.txt`, 'checksums.txt'],
    version: (tag) => tag.replace(/^v/, ''),
    platforms: {
      'darwin-arm64': {
        asset: (t) => `cli_${t.replace(/^v/, '')}_darwin_arm64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['infisical'],
      },
      'darwin-x64': {
        asset: (t) => `cli_${t.replace(/^v/, '')}_darwin_amd64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['infisical'],
      },
      'linux-x64': {
        asset: (t) => `cli_${t.replace(/^v/, '')}_linux_amd64.tar.gz`,
        archive: 'tar.gz',
        binPaths: ['infisical'],
      },
      'win32-x64': {
        asset: (t) => `cli_${t.replace(/^v/, '')}_windows_amd64.zip`,
        archive: 'zip',
        binPaths: ['infisical.exe'],
      },
    },
  },
};

interface NpmToolSpec {
  kind: 'npm';
  /** npm package name. */
  pkg: string;
  version: string;
  displayName: string;
  /** Основной бинарник для манифеста (unix/win). */
  bin: string;
}

// tier default-on кроме eve/agent-browser (opt-in) и всех 5 vercel-каталоговых (opt-in).
const NPM_TOOLS: Record<string, NpmToolSpec> = {
  'opencode-ai': { kind: 'npm', pkg: 'opencode-ai', version: '1.18.15', displayName: 'OpenCode', bin: 'opencode' },
  'oh-my-openagent': { kind: 'npm', pkg: 'oh-my-openagent', version: '4.19.4', displayName: 'oh-my-openagent', bin: 'oh-my-openagent' },
  'oh-my-codex': { kind: 'npm', pkg: 'oh-my-codex', version: '0.20.3', displayName: 'oh-my-codex', bin: 'omx' },
  'oh-my-claude-sisyphus': { kind: 'npm', pkg: 'oh-my-claude-sisyphus', version: '4.15.8', displayName: 'oh-my-claudecode (sisyphus)', bin: 'omc' },
  skills: { kind: 'npm', pkg: 'skills', version: '1.5.22', displayName: 'vercel skills CLI', bin: 'skills' },
  eve: { kind: 'npm', pkg: 'eve', version: '0.31.0', displayName: 'eve', bin: 'eve' },
  'agent-browser': { kind: 'npm', pkg: 'agent-browser', version: '0.33.2', displayName: 'agent-browser', bin: 'agent-browser' },
  // M4a каталог (§15.4): toolchain-toggle установка через toolchain:update.
  portless: { kind: 'npm', pkg: 'portless', version: '0.15.5', displayName: 'portless', bin: 'portless' },
  'just-bash': { kind: 'npm', pkg: 'just-bash', version: '3.2.0', displayName: 'just-bash', bin: 'just-bash' },
  opensrc: { kind: 'npm', pkg: 'opensrc', version: '0.7.3', displayName: 'opensrc', bin: 'opensrc' },
  deepsec: { kind: 'npm', pkg: 'deepsec', version: '2.3.4', displayName: 'deepsec', bin: 'deepsec' },
  dev3000: { kind: 'npm', pkg: 'dev3000', version: '0.0.178', displayName: 'dev3000', bin: 'dev3000' },
};

interface GitToolSpec {
  kind: 'git-npm';
  repo: string;
  commit: string;
  version: string; // short commit для version-поля манифеста
  displayName: string;
  bin: string;
}

const GIT_TOOLS: Record<string, GitToolSpec> = {
  gbrain: {
    kind: 'git-npm',
    repo: 'garrytan/gbrain',
    commit: '15b9863d13635d173562a54f55a1d388bfcf546b',
    version: '15b9863d1363',
    displayName: 'gbrain',
    bin: 'gbrain',
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.error(`>> ${msg}`);
}

/** Escape a requirements.txt body for a TS template-literal lock entry. */
function escapePipLockBody(body: string): string {
  return body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * pip mode: bun scripts/toolchain-locks.ts pip <name>@<version> <pypi-spec>
 * Runs `uv pip compile --generate-hashes` and prints a pip-locks.ts fragment.
 */
async function runPipMode(argv: string[]): Promise<void> {
  // argv = ['pip', 'cli-anything@0.4.1', 'cli-anything-hub==0.4.1', ...]
  const key = argv[1];
  const spec = argv[2];
  if (!key || !spec || !key.includes('@')) {
    console.error(
      "usage: bun scripts/toolchain-locks.ts pip <name>@<version> <pypi-spec>\n" +
        "  e.g. bun scripts/toolchain-locks.ts pip cli-anything@0.4.1 'cli-anything-hub==0.4.1'",
    );
    process.exit(2);
  }
  const at = key.lastIndexOf('@');
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  if (!name || !version) {
    console.error('invalid <name>@<version> key');
    process.exit(2);
  }

  // Locate uv (PATH). Fail non-zero if missing.
  const uvPath = Bun.which('uv');
  if (!uvPath) {
    console.error('uv not found on PATH — install uv to generate pip locks');
    process.exit(1);
  }
  log(`uv: ${uvPath}`);
  log(`compile ${spec} → ${name}@${version}`);

  const proc = Bun.spawn(['uv', 'pip', 'compile', '--generate-hashes', '-'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(spec.endsWith('\n') ? spec : `${spec}\n`);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    console.error(stderr || `uv pip compile failed (exit ${exitCode})`);
    process.exit(exitCode || 1);
  }
  const body = stdout.endsWith('\n') ? stdout : `${stdout}\n`;
  const fragment =
    `  // ${name} ${version} — ${spec}\n` +
    `  // Lock body from \`uv pip compile --generate-hashes\`.\n` +
    `  '${name}@${version}': \`${escapePipLockBody(body)}\`,\n`;
  process.stdout.write(fragment);
  log(`pip lock fragment for ${name}@${version} (${body.split('\n').length} lines)`);
}

// pip subcommand — early exit before bulk binary/npm/git path
if (process.argv[2] === 'pip') {
  await runPipMode(process.argv.slice(2));
  process.exit(0);
}

const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1]! : '/tmp/toolchain-locks-out';
})();
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? new Set(process.argv[i + 1]!.split(',')) : null;
})();
const wanted = (name: string) => !ONLY || ONLY.has(name);


async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  const buf = await fs.promises.readFile(file);
  hash.update(buf);
  return hash.digest('hex');
}

async function ghJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'user-agent': 'craft-toolchain-locks' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'craft-toolchain-locks' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  // Bun.write(dest, res) надёжно НЕ работает с redirect-Response (зависает) — материализуем через arrayBuffer.
  await Bun.write(dest, await res.arrayBuffer());
}

/** Парсинг checksums-файлов формата "<64hex>( *|  )<filename>". */
function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})[ *]+(\S.*)$/i);
    if (m) map.set(m[2]!.trim().replace(/^\.\//, ''), m[1]!.toLowerCase());
  }
  return map;
}

interface ResolvedArtifact {
  url: string;
  sha256: string;
  size: number;
  source: 'checksums-file' | 'downloaded' | 'verified-download';
}

async function resolveBinaryTool(name: string, spec: BinaryToolSpec, work: string): Promise<{ tag: string; artifacts: Record<Platform, ResolvedArtifact> }> {
  const rel = await ghJson(`https://api.github.com/repos/${spec.repo}/releases/latest`);
  const tag: string = rel.tag_name;
  log(`${name}: ${spec.repo} @ ${tag} (${rel.published_at})`);
  const assets: { name: string; browser_download_url: string; size: number }[] = rel.assets;
  const byName = new Map(assets.map((a) => [a.name, a]));

  // 1) собираем карту checksums из релизных файлов
  let checksumMap = new Map<string, string>();
  if (spec.checksums === 'per-asset') {
    for (const plat of PLATFORMS) {
      const pspec = spec.platforms[plat];
      if (!pspec) continue;
      const assetName = pspec.asset(tag);
      const sumAsset = byName.get(`${assetName}.sha256`);
      if (!sumAsset) throw new Error(`${name}: no ${assetName}.sha256 in release`);
      const text = await (await fetch(sumAsset.browser_download_url)).text();
      const line = text.trim().split(/\s+/);
      if (!/^[0-9a-f]{64}$/i.test(line[0]!)) throw new Error(`${name}: bad .sha256 for ${assetName}: ${text.slice(0, 80)}`);
      checksumMap.set(assetName, line[0]!.toLowerCase());
    }
  } else if (spec.checksums !== 'none') {
    for (const csName of spec.checksums(tag)) {
      const csAsset = byName.get(csName);
      if (!csAsset) continue;
      const text = await (await fetch(csAsset.browser_download_url)).text();
      for (const [k, v] of parseChecksums(text)) checksumMap.set(k, v);
    }
  }

  const out: Partial<Record<Platform, ResolvedArtifact>> = {};
  for (const plat of PLATFORMS) {
    const pspec = spec.platforms[plat];
    if (!pspec) continue;
    const assetName = pspec.asset(tag);
    const asset = byName.get(assetName);
    if (!asset) throw new Error(`${name} [${plat}]: asset ${assetName} not found in ${spec.repo}@${tag}`);
    const published = checksumMap.get(assetName);
    const isHostArmMac = plat === 'darwin-arm64' && process.platform === 'darwin' && process.arch === 'arm64';
    if (published && !isHostArmMac) {
      out[plat] = { url: asset.browser_download_url, sha256: published, size: asset.size, source: 'checksums-file' };
      continue;
    }
    // нет публикуемого хэша или хост-платформа (проверяем): качаем+считаем
    const dest = path.join(work, name, assetName);
    log(`${name} [${plat}]: download ${assetName} (${(asset.size / 1048576).toFixed(1)}MB)`);
    await download(asset.browser_download_url, dest);
    const actual = await sha256File(dest);
    if (published && published !== actual) {
      throw new Error(`${name} [${plat}]: PUBLISHED sha256 mismatch! published=${published} actual=${actual}`);
    }
    out[plat] = {
      url: asset.browser_download_url,
      sha256: actual,
      size: (await fs.promises.stat(dest)).size,
      source: published ? 'verified-download' : 'downloaded',
    };
    // хост-платформа: верифицируем binPaths и запускаем бинарник
    if (isHostArmMac) {
      const extractDir = path.join(work, `${name}-verify`);
      fs.rmSync(extractDir, { recursive: true, force: true });
      await fs.promises.mkdir(extractDir, { recursive: true });
      const tarArgs =
        pspec.archive === 'zip' ? ['tar', '-xf', dest, '-C', extractDir]
        : pspec.archive === 'tar.xz' ? ['tar', '-xJf', dest, '-C', extractDir]
        : ['tar', '-xzf', dest, '-C', extractDir];
      {
        const p = Bun.spawnSync(tarArgs);
        if (p.exitCode !== 0) throw new Error(`${name}: extract failed: ${p.stderr.toString()}`);
      }
      for (const binRel of pspec.binPaths) {
        const full = path.join(extractDir, binRel);
        if (!fs.existsSync(full)) {
          const listing = Bun.spawnSync(['tar', pspec.archive === 'zip' ? '-tf' : pspec.archive === 'tar.xz' ? '-tJf' : '-tzf', dest]);
          throw new Error(
            `${name} [${plat}]: binPath ${binRel} NOT in archive. Listing:\n${listing.stdout.toString().split('\n').slice(0, 30).join('\n')}`,
          );
        }
        if (process.platform !== 'win32') await fs.promises.chmod(full, 0o755);
        const run = Bun.spawnSync([full, '--version'], { cwd: extractDir, timeout: 30_000 });
        const out1 = `${run.stdout.toString()}${run.stderr.toString()}`.trim().split('\n')[0] ?? '';
        if (run.exitCode !== 0) throw new Error(`${name}: ${binRel} --version exited ${run.exitCode}: ${out1}`);
        log(`${name} [${plat}]: VERIFIED run ${binRel} --version -> ${out1}`);
      }
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.rmSync(dest, { force: true });
  }
  return { tag, artifacts: out as Record<Platform, ResolvedArtifact> };
}

async function resolveNpmTool(name: string, spec: NpmToolSpec, work: string): Promise<{ tarball: ResolvedArtifact; lockB64: string; lockBytes: number }> {
  const meta = await ghJsonEquivalent(`https://registry.npmjs.org/${encodeURIComponent(spec.pkg)}/${spec.version}`);
  const tarballUrl: string = meta.dist.tarball;
  const dest = path.join(work, name, path.basename(tarballUrl));
  await download(tarballUrl, dest);
  const sha = await sha256File(dest);
  const size = (await fs.promises.stat(dest)).size;
  const extractDir = path.join(work, `${name}-pkg`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  await fs.promises.mkdir(extractDir, { recursive: true });
  {
    const p = Bun.spawnSync(['tar', '-xzf', dest, '-C', extractDir]);
    if (p.exitCode !== 0) throw new Error(`${name}: npm tarball extract failed`);
  }
  const pkgDir = path.join(extractDir, 'package');
  // Публикуемые из монореп пакеты могут тащить workspace:* в devDependencies —
  // npm это не резолвит (EUNSUPPORTEDPROTOCOL). Для lock-only с --omit=dev
  // devDependencies влиять не должны: вычищаем их и любые workspace:* значения.
  {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    delete pkgJson.devDependencies;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = pkgJson[field];
      if (!deps) continue;
      for (const dep of Object.keys(deps)) {
        if (String(deps[dep]).startsWith('workspace:')) delete deps[dep];
      }
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
  }
  // package-lock.json той же схемы, что и для omp (regen-omp-lock.sh)
  const npmArgs = ['install', '--package-lock-only', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'];
  const npm = Bun.spawnSync(['npm', ...npmArgs], { cwd: pkgDir, timeout: 300_000 });
  if (npm.exitCode !== 0) throw new Error(`${name}: npm ${npmArgs.join(' ')} failed: ${npm.stderr.toString().slice(-500)}`);
  const lockFile = path.join(pkgDir, 'package-lock.json');
  if (!fs.existsSync(lockFile)) throw new Error(`${name}: package-lock.json not generated`);
  const lockRaw = await fs.promises.readFile(lockFile, 'utf8');
  const lockJson = JSON.parse(lockRaw);
  const rootVersion = lockJson.packages?.['']?.version;
  if (rootVersion !== spec.version) throw new Error(`${name}: lock root version ${rootVersion} != ${spec.version}`);
  const pkgBin = lockJson.packages?.['']?.bin;
  if (pkgBin && typeof pkgBin === 'object' && !(spec.bin in pkgBin)) {
    log(`${name}: WARNING bin ${spec.bin} not in package.json bin ${JSON.stringify(pkgBin)}`);
  }
  const lockB64 = Buffer.from(lockRaw, 'utf8').toString('base64');
  log(`${name}: npm lock ok (${(lockRaw.length / 1024).toFixed(0)}KB -> b64 ${(lockB64.length / 1024).toFixed(0)}KB)`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(dest, { force: true });
  return { tarball: { url: tarballUrl, sha256: sha, size, source: 'downloaded' }, lockB64, lockBytes: lockRaw.length };
}

async function ghJsonEquivalent(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'user-agent': 'craft-toolchain-locks' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function resolveGitTool(name: string, spec: GitToolSpec, work: string): Promise<{ url: string; sha256: string; size: number }> {
  const url = `https://github.com/${spec.repo}/archive/${spec.commit}.tar.gz`;
  const dest = path.join(work, name, `${name}-${spec.version}.tar.gz`);
  log(`${name}: download ${url}`);
  await download(url, dest);
  const sha = await sha256File(dest);
  const size = (await fs.promises.stat(dest)).size;
  // sanity: внутри package.json с ожидаемым bin
  const listing = Bun.spawnSync(['tar', '-tzf', dest]);
  const files = listing.stdout.toString().split('\n');
  const root = files[0]?.split('/')[0];
  const pkgJsonEntry = files.find((f) => f.endsWith('/package.json'));
  if (!pkgJsonEntry) throw new Error(`${name}: no package.json in codeload tarball`);
  const extractDir = path.join(work, `${name}-git`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  await fs.promises.mkdir(extractDir, { recursive: true });
  const p = Bun.spawnSync(['tar', '-xzf', dest, '-C', extractDir]);
  if (p.exitCode !== 0) throw new Error(`${name}: extract failed`);
  const pkg = JSON.parse(await fs.promises.readFile(path.join(extractDir, root!, 'package.json'), 'utf8'));
  const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : pkg.bin;
  if (!bins?.[spec.bin]) throw new Error(`${name}: expected bin ${spec.bin} in package.json, got ${JSON.stringify(pkg.bin)}`);
  if (!fs.existsSync(path.join(extractDir, root!, 'bun.lock'))) {
    log(`${name}: WARNING no bun.lock in repo tarball — deps не pinned, установка упадёт на --frozen-lockfile`);
  }
  log(`${name}: git tarball ok, pkg ${pkg.name}@${pkg.version}, bins ${Object.keys(bins).join(',')}, root ${root}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(dest, { force: true });
  return { url, sha256: sha, size };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-locks-'));
fs.mkdirSync(OUT_DIR, { recursive: true });
const fragments: string[] = [];
const npmLocksOut: string[] = [];
const gitLocksOut: string[] = [];
const summary: Record<string, unknown> = {};

try {
  for (const [name, spec] of Object.entries(BINARY_TOOLS)) {
    if (!wanted(name)) continue;
    const { tag, artifacts } = await resolveBinaryTool(name, spec, work);
    const version = spec.version(tag);
    summary[name] = { tag, version, sources: Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, v.source])) };
    const lines = Object.entries(artifacts)
      .map(([plat, a]) => {
        const bps = spec.platforms[plat as Platform]!.binPaths;
        return `      '${plat}': {\n        url: '${a.url}',\n        sha256: '${a.sha256}',\n        size: ${a.size},\n        archive: '${spec.platforms[plat as Platform]!.archive}',\n        binPaths: ${JSON.stringify(bps)},\n      },`;
      })
      .join('\n');
    fragments.push(
      `  // ${name} ${version} — github.com/${spec.repo}; sha256: релизные checksums${Object.values(artifacts).some((a) => a.source !== 'checksums-file') ? ' + локальная верификация' : ''}, darwin-arm64 проверен запуском.\n` +
        `  ${name}: {\n    version: '${version}',\n    kind: 'binary',\n    tier: 'default-on',\n    displayName: '${spec.displayName}',\n    artifacts: {\n${lines}\n    },\n  },`,
    );
  }

  for (const [name, spec] of Object.entries(NPM_TOOLS)) {
    if (!wanted(name)) continue;
    const { tarball, lockB64 } = await resolveNpmTool(name, spec, work);
    summary[name] = { version: spec.version, tarballSha: tarball.sha256, size: tarball.size };
    const bpsUnix = [`bin/${spec.bin}`];
    const bpsWin = [`bin/${spec.bin}.cmd`];
    const lines = (['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'] as Platform[])
      .map((plat) => {
        const bps = plat === 'win32-x64' ? bpsWin : bpsUnix;
        return `      '${plat}': {\n        url: '${tarball.url}',\n        sha256: '${tarball.sha256}',\n        size: ${tarball.size},\n        archive: 'tar.gz',\n        binPaths: ${JSON.stringify(bps)},\n      },`;
      })
      .join('\n');
    fragments.push(
      `  // ${name} ${spec.version} — npm ${spec.pkg} (тарболл + embedded package-lock, fail-closed).\n` +
        `  ${name}: {\n    version: '${spec.version}',\n    kind: 'npm',\n    tier: 'default-on', // TODO tier refine ниже\n    displayName: '${spec.displayName}',\n    dependsOn: ['bun', 'node'],\n    artifacts: {\n${lines}\n    },\n  },`,
    );
    npmLocksOut.push(`  // ${spec.pkg} ${spec.version}\n  '${name}@${spec.version}':\n    '${lockB64}',`);
  }

  for (const [name, spec] of Object.entries(GIT_TOOLS)) {
    if (!wanted(name)) continue;
    const t = await resolveGitTool(name, spec, work);
    summary[name] = { commit: spec.commit, sha256: t.sha256, size: t.size };
    gitLocksOut.push(
      `  // ${spec.repo} @ ${spec.commit}\n  '${name}@${spec.version}': {\n    repo: '${spec.repo}',\n    commit: '${spec.commit}',\n    url: '${t.url}',\n    sha256: '${t.sha256}',\n    size: ${t.size},\n  },`,
    );
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest-fragments.ts'), fragments.join('\n\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'npm-locks-fragment.ts'), npmLocksOut.join('\n\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'git-locks-fragment.ts'), gitLocksOut.join('\n\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
log(`fragments -> ${OUT_DIR}/`);
