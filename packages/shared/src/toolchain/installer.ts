/**
 * Установка артефактов toolchain: распаковка архивов, chmod, layout
 * toolchain/<tool>/<version>/ + атомарное переключение `current` (symlink /
 * junction / копия на win32), cleanup старых версий и partial-файлов.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TOOLCHAIN_INSTALL_COMPLETE_MARKER } from './types';
import type { ToolArtifact, ToolName, ToolchainPaths } from './types';
import { runCommand, whichTool } from './exec';
import { getNpmLock } from './npm-locks';

const isWindows = process.platform === 'win32';

/** Спавн системной команды; reject с stderr при ненулевом exit-code. Node-only (Electron main — не Bun). */
const run = (cmd: string[], opts?: { cwd?: string }): Promise<void> => runCommand(cmd, opts);

/**
 * Распаковать архив в destDir.
 * tar.gz/tar.xz/zip — системный tar (bsdtar на macOS читает и zip);
 * на win32 — PowerShell Expand-Archive. `raw` — голый файл.
 */
export async function extractArtifact(
  archiveFile: string,
  archive: Exclude<ToolArtifact['archive'], 'uv-python'>,
  destDir: string,
): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  switch (archive) {
    case 'tar.gz':
      await run(['tar', '-xzf', archiveFile, '-C', destDir]);
      return;
    case 'tar.xz':
      await run(['tar', '-xJf', archiveFile, '-C', destDir]);
      return;
    case 'zip':
      if (isWindows) {
        // Windows PowerShell Expand-Archive не санитизирует zip-slip (CWE-22):
        // распаковываем через System.IO.Compression с явной нормализацией путей.
        const a = archiveFile.replaceAll("'", "''");
        const d = destDir.replaceAll("'", "''");
        await run([
          'powershell',
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
            `$dest = (Resolve-Path -LiteralPath '${d}').Path + [IO.Path]::DirectorySeparatorChar; ` +
            `$zip = [System.IO.Compression.ZipFile]::OpenRead('${a}'); ` +
            `foreach ($e in $zip.Entries) { ` +
            `$out = [IO.Path]::GetFullPath([IO.Path]::Combine($dest, $e.FullName)); ` +
            `if (-not $out.StartsWith($dest)) { $zip.Dispose(); throw "zip-slip blocked: $($e.FullName)" } ` +
            `if ($e.FullName.EndsWith('/') -or $e.FullName.EndsWith('\\\\')) { New-Item -ItemType Directory -Path $out -Force | Out-Null } ` +
            `else { New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($out)) -Force | Out-Null; [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $out, $true) } }; ` +
            `$zip.Dispose()`,
        ]);
      } else if (process.platform === 'darwin') {
        // macOS tar — bsdtar (санитизирует ../ и абсолютные пути)
        await run(['tar', '-xf', archiveFile, '-C', destDir]);
      } else {
        // GNU tar не читает zip; unzip (Info-ZIP) санитизирует абсолютные пути
        await run(['unzip', '-o', archiveFile, '-d', destDir]);
      }
      return;
    case 'raw':
      // голый бинарник: кладём как <destDir>/bin/<basename>; имя бинарника
      // задаётся binPaths запись манифеста на этапе installTool
      throw new Error('raw artifacts are handled by installTool, not extractArtifact');
    default:
      throw new Error(`unsupported archive type: ${archive satisfies never}`);
  }
}

/**
 * Пост-проверка распаковки: ни один symlink не должен указывать за пределы
 * root (иначе chmod +x / cleanup могут последовать наружу). Верифицированный
 * sha256 делает злонамеренный архив маловероятным, но защищаемся дешево.
 */
async function assertNoEscapes(root: string): Promise<void> {
  const realRoot = await fs.promises.realpath(root);
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fs.promises.realpath(p).catch(() => null);
        if (target && target !== realRoot && !target.startsWith(realRoot + path.sep)) {
          throw new Error(`archive symlink escapes destDir: ${p} -> ${target}`);
        }
      } else if (entry.isDirectory()) {
        await walk(p);
      }
    }
  }
  await walk(realRoot);
}

/** Mach-O/fat магии (big-endian первые 4 байта). ELF/PE проверяются посимвольно. */
const MACHO_MAGICS: Record<number, true> = {
  0xfeedface: true, // Mach-O 32 LE
  0xfeedfacf: true, // Mach-O 64 LE
  0xcefaedfe: true, // Mach-O 32 BE
  0xcffaedfe: true, // Mach-O 64 BE
  0xcafebabe: true, // fat binary
  0xcafed00d: true, // fat binary 64
};

/**
 * Файл — нативный исполняемый (ELF/PE/Mach-O/fat)? postinstall некоторых
 * npm-пакетов (opencode-ai) копирует НАТИВНЫЙ бинарь поверх js-цели bin —
 * его надо exec'ать напрямую, а не прогонять через bun.
 */
async function isNativeBinary(file: string): Promise<boolean> {
  const head = Buffer.alloc(4);
  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(file, 'r');
  } catch {
    return false;
  }
  try {
    const { bytesRead } = await fh.read(head, 0, 4, 0);
    if (bytesRead < 2) return false;
    // ELF: \x7fELF
    if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true;
    // PE/COFF: 'MZ'
    if (head[0] === 0x4d && head[1] === 0x5a) return true;
    return bytesRead >= 4 && MACHO_MAGICS[head.readUInt32BE(0)] === true;
  } finally {
    await fh.close();
  }
}

/**
 * npm-тарболлы кладут исполняемый файл как js (например package/dist/cli.js),
 * а имя CLI задаётся в package.json bin. Генерируем лончеры в <versionDir>/bin/
 * с правильным именем (bin/omp, bin/omp.cmd), чтобы резолвер находил их как
 * обычный исполняемый файл. Bun для запуска: CRAFT_BUN_PATH env → toolchain
 * bun → bun из PATH.
 * Нативная цель bin (postinstall opencode-ai) — лончер exec'ает её напрямую.
 */
async function generateNpmWrappers(toolDir: string): Promise<string[]> {
  const pkgFile = path.join(toolDir, 'package', 'package.json');
  let pkgBin: Record<string, string> | undefined;
  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgFile, 'utf8'));
    pkgBin = typeof pkg.bin === 'string' ? { [pkg.name ?? 'bin']: pkg.bin } : pkg.bin;
  } catch {
    return [];
  }
  if (!pkgBin || typeof pkgBin !== 'object') return [];

  const binDir = path.join(toolDir, 'bin');
  await fs.promises.mkdir(binDir, { recursive: true });
  const created: string[] = [];
  for (const [name, rel] of Object.entries(pkgBin)) {
    if (typeof rel !== 'string' || !rel) continue;
    // postinstall (opencode-ai) кладёт нативный бинарь поверх js-цели — exec без bun.
    const native = (await isNativeBinary(path.join(toolDir, 'package', rel)))
      ? rel
      : (await isNativeBinary(path.join(toolDir, 'package', `${rel}.exe`)))
        ? `${rel}.exe`
        : null;
    if (native) {
      const target = path.join(toolDir, 'package', native);
      try {
        const st = await fs.promises.stat(target);
        await fs.promises.chmod(target, st.mode | 0o755);
      } catch {
        // права не выставились — exec сам упадёт в рантайме, не фатально
      }
      const shNative =
        '#!/bin/sh\n' +
        'DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
        `exec "$DIR/../package/${native}" "$@"\n`;
      await fs.promises.writeFile(path.join(binDir, name), shNative, { mode: 0o755 });
      created.push(path.join('bin', name));
      const cmdNative = '@echo off\r\n' + `"%~dp0..\\package\\${native.replace(/\//g, '\\')}" %*\r\n`;
      await fs.promises.writeFile(path.join(binDir, `${name}.cmd`), cmdNative);
      created.push(path.join('bin', `${name}.cmd`));
      continue;
    }
    // unix wrapper: ../package/<rel> относительно bin/
    const sh =
      '#!/bin/sh\n' +
      'DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
      'if [ -n "$CRAFT_BUN_PATH" ] && [ -x "$CRAFT_BUN_PATH" ]; then\n' +
      '  BUN="$CRAFT_BUN_PATH"\n' +
      'else\n' +
      '  BUN=""\n' +
      '  for c in "$DIR"/../../../bun/current/bun "$DIR"/../../../bun/current/*/bun; do\n' +
      '    if [ -x "$c" ]; then BUN="$c"; break; fi\n' +
      '  done\n' +
      '  [ -z "$BUN" ] && BUN="bun"\n' +
      'fi\n' +
      `exec "$BUN" "$DIR/../package/${rel}" "$@"\n`;
    await fs.promises.writeFile(path.join(binDir, name), sh, { mode: 0o755 });
    created.push(path.join('bin', name));
    // windows wrapper
    const cmd =
      '@echo off\r\n' +
      'setlocal\r\n' +
      'set "BUN=%CRAFT_BUN_PATH%"\r\n' +
      'if "%BUN%"=="" if exist "%~dp0..\\..\\..\\bun\\current\\bun-windows-x64\\bun.exe" set "BUN=%~dp0..\\..\\..\\bun\\current\\bun-windows-x64\\bun.exe"\r\n' +
      'if "%BUN%"=="" set "BUN=bun"\r\n' +
      `"%BUN%" "%~dp0..\\package\\${rel.replace(/\//g, '\\')}" %*\r\n`;
    await fs.promises.writeFile(path.join(binDir, `${name}.cmd`), cmd);
    created.push(path.join('bin', `${name}.cmd`));
  }
  return created;
}

/**
 * Установка зависимостей распакованного npm-пакета СТРОГО по pinned
 * package-lock.json из toolchain/npm-locks.ts (npm ci проверяет integrity
 * каждого пакета — ни один байт транзитивных deps не исполняется
 * без верификации; supply-chain фикс обзора 2026-08-06).
 * Lock отсутствует → установка запрещена (fail-closed).
 * node+npm: toolchain node (omp dependsOn node) → fallback 'npm' из PATH.
 *
 * Lifecycle scripts are OFF by default (`--ignore-scripts`). Tools that need
 * postinstall/prepare (native binaries, launcher rewrite) are allowlisted and
 * retried WITHOUT `--ignore-scripts` only after the safe install fails.
 */
/** Tools whose npm lifecycle scripts are required for a working install. */
const NPM_SCRIPTS_ALLOWLIST = new Set<ToolName>([
  'opencode-ai',
  'oh-my-codex',
  'oh-my-claude-sisyphus',
  'agent-browser',
  'eve',
  'skills',
  'dev3000',
  'deepsec',
  'opensrc',
  'portless',
  'just-bash',
]);

export async function npmInstallDeps(
  paths: ToolchainPaths,
  toolDir: string,
  tool: ToolName,
  version: string,
  opts?: {
    /** Test seam: override command runner (defaults to runCommand). */
    runCmd?: typeof runCommand
    /** Test seam: force npm binary path (skips toolchain/PATH lookup). */
    npmBin?: string
    /** Test seam: override lock lookup (defaults to getNpmLock). */
    getLock?: (tool: ToolName, version: string) => string | null
  },
): Promise<void> {
  const lock = (opts?.getLock ?? getNpmLock)(tool, version);
  if (!lock) {
    throw new Error(
      `no pinned npm lock for ${tool}@${version}: бамп версии требует нового ` +
        'package-lock.json в toolchain/npm-locks.ts (см. header файла)',
    );
  }
  const pkgDir = path.join(toolDir, 'package');
  await fs.promises.writeFile(path.join(pkgDir, 'package-lock.json'), lock, 'utf8');
  // LockFor: хэшируется генератором ПОСЛЕ удаления devDependencies (monorepo-пакеты
  // тащат workspace:*), поэтому и на установке вычищаем те же поля из распакованного
  // пакета — иначе npm ci валится EUSAGE "lock out of sync".
  {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));
    delete pkgJson.devDependencies;
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = pkgJson[field];
      if (!deps) continue;
      for (const dep of Object.keys(deps)) {
        if (String(deps[dep]).startsWith('workspace:')) delete deps[dep];
      }
    }
    await fs.promises.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
  }

  // toolchain node: npm живёт рядом с node (unix: <dir>/bin/npm; win: npm.cmd в корне).
  let npm: string | undefined = opts?.npmBin;
  if (!npm) {
    const nodeRoot = path.join(paths.toolchainDir, 'node', 'current');
    try {
      for (const entry of await fs.promises.readdir(nodeRoot)) {
        for (const candidate of isWindows
          ? [path.join(nodeRoot, entry, 'npm.cmd'), path.join(nodeRoot, entry, 'bin', 'npm.cmd')]
          : [path.join(nodeRoot, entry, 'bin', 'npm')]) {
          if (fs.existsSync(candidate)) {
            npm = candidate;
            break;
          }
        }
        if (npm) break;
      }
    } catch {
      // toolchain node ещё не установлен
    }
    // OpenClaw's supply-chain path is anchored to managed Node. It must never
    // borrow a user/global npm when its dependency was not installed.
    if (tool !== 'openclaw') {
      npm ??= (await whichTool(isWindows ? 'npm.cmd' : 'npm')) ?? undefined;
    }
  }
  if (!npm) {
    if (tool === 'openclaw') {
      throw new Error('managed toolchain Node/npm required for OpenClaw; PATH fallback is forbidden');
    }
    throw new Error('npm not found: toolchain node required (omp dependsOn node), fallback PATH npm');
  }
  const env = {
    ...process.env,
    PATH: `${path.dirname(npm)}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  const runCmd = opts?.runCmd ?? runCommand;
  const baseArgs = [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'];
  // Default: never run lifecycle scripts (supply-chain fail-closed).
  try {
    await runCmd([...baseArgs, '--ignore-scripts'], { cwd: pkgDir, env });
  } catch (err) {
    // Allowlisted tools may need postinstall (native bins, launcher rewrite).
    // Retry once without --ignore-scripts only for those packages.
    if (!NPM_SCRIPTS_ALLOWLIST.has(tool)) throw err;
    await runCmd(baseArgs, { cwd: pkgDir, env }).catch((err2) => {
      throw err2 instanceof Error && err2.message ? err2 : err;
    });
  }
}

/** chmod +x всем binPaths (unix). Windows не требует. */
async function chmodBins(toolDir: string, binPaths: string[]): Promise<void> {

  for (const rel of binPaths) {
    const file = path.join(toolDir, rel);
    try {
      const stat = await fs.promises.stat(file);
      await fs.promises.chmod(file, stat.mode | 0o755);
    } catch {
      // бинарника нет в дереве — не фатально (npx-симлинки и т.п.)
    }
  }
}

/** Переключить `current` на новую версию атомарно (junction/copy fallback на win32). */
export async function flipCurrent(toolRoot: string, version: string, versionDir: string): Promise<void> {
  const currentLink = path.join(toolRoot, 'current');
  const tmpLink = path.join(toolRoot, `.current.tmp-${process.pid}`);
  await fs.promises.rm(tmpLink, { recursive: true, force: true });
  try {
    if (isWindows) {
      // junction не требует прав администратора
      await fs.promises.symlink(versionDir, tmpLink, 'junction');
    } else {
      await fs.promises.symlink(version, tmpLink); // относительный — переносимо
    }
    if (isWindows) {
      // junction не требует прав администратора; rename поверх каталога на
      // win не атомарен — удаляем старый (краткое окно без current, принимаем)
      await fs.promises.rm(currentLink, { recursive: true, force: true });
      await fs.promises.rename(tmpLink, currentLink);
    } else {
      // POSIX rename(2) атомарно заменяет symlink-назначение — rm не нужен,
      // процессы всегда видят старый или новый current, но не пусто.
      await fs.promises.rename(tmpLink, currentLink);
    }
  } catch (error) {
    await fs.promises.rm(tmpLink, { recursive: true, force: true });
    // Windows-fallback: если symlink запрещён политикой — копируем дерево
    if (!isWindows) throw error;
    await fs.promises.rm(currentLink, { recursive: true, force: true });
    await fs.promises.cp(versionDir, currentLink, { recursive: true });
  }
}

/** Удалить все кроме указанной версии + partial-файлы в downloads. */
export async function cleanupOldVersions(toolRoot: string, keepVersion: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(toolRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === keepVersion || entry === 'current' || entry.startsWith('.current.tmp')) continue;
    await fs.promises.rm(path.join(toolRoot, entry), { recursive: true, force: true });
  }
}

export interface InstallResult {
  installedPath: string;
  installedVersion: string;
}

/**
 * Установить уже скачанный и проверенный артефакт:
 * распаковка -> toolchain/<tool>/<version> -> flip `current` -> cleanup.
 */
export async function installTool(
  paths: ToolchainPaths,
  tool: ToolName,
  version: string,
  artifactFile: string,
  artifact: ToolArtifact,
): Promise<InstallResult> {
  if (artifact.archive === 'uv-python') {
    throw new Error('uv-python artifacts are installed by manager via bundled uv');
  }
  const toolRoot = path.join(paths.toolchainDir, tool);
  const versionDir = path.join(toolRoot, version);
  await fs.promises.rm(versionDir, { recursive: true, force: true });

  if (artifact.archive === 'raw') {
    // голый бинарник кладём по первому binPath записи манифеста
    const binRel = artifact.binPaths[0] ?? path.join('bin', tool);
    const dest = path.join(versionDir, binRel);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(artifactFile, dest);
  } else {
    await extractArtifact(artifactFile, artifact.archive, versionDir);
    await assertNoEscapes(versionDir);
    // OpenClaw has no generic wrapper: only the managed Node launcher may run it.
    const wrappers = tool === 'openclaw' ? [] : await generateNpmWrappers(versionDir);
    if (wrappers.length > 0 || tool === 'openclaw') {
      // npm-зависимости (pi-natives и др. — тарболл один неработоспособен).
      try {
        await npmInstallDeps(paths, versionDir, tool, version);
      } catch (error) {
        // A failed install must never leave an entrypoint the resolver could launch.
        await fs.promises.rm(versionDir, { recursive: true, force: true });
        throw error;
      }
      if (tool !== 'openclaw') {
        // postinstall мог заменить js-цель bin нативным бинарём (opencode-ai):
        // перегенерируем лончеры — вторая волна перепишет их прямым exec.
        await generateNpmWrappers(versionDir);
      }
    }
  }
  await chmodBins(versionDir, artifact.binPaths);
  await fs.promises.writeFile(
    path.join(versionDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER),
    `${tool}@${version}\n`,
    { mode: 0o600 },
  );
  await flipCurrent(toolRoot, version, versionDir);
  await cleanupOldVersions(toolRoot, version);
  // partial/исходник артефакта больше не нужен
  await fs.promises.rm(artifactFile, { force: true });

  return { installedPath: versionDir, installedVersion: version };
}

// ---------------------------------------------------------------------------
// git-npm supply-chain (kind 'git-npm', см. manager.defaultGitNpmInstall)
// ---------------------------------------------------------------------------

/**
 * Параметры pinned-установки git-npm инструмента.
 */
export interface GitNpmPinnedInstall {
  /** toolchain-первый bun executable. */
  bun: string;
  /** toolchain/<name>/<version> — BUN_INSTALL root (install/global + bin). */
  versionDir: string;
  /** 'owner/repo' на GitHub. */
  repo: string;
  /** Полный commit sha — фактический пин снапшота (git-locks.ts). */
  commit: string;
  /** Временный каталог чекаута (создаём и чистим сами). */
  workDir: string;
  /** DI для тестов (заменяет runCommand). */
  runCmd?: typeof runCommand;
  /** WARNING/прогресс-лог (по умолчанию console.warn). */
  onLog?: (message: string) => void;
}

/**
 * Установка git-npm инструмента из pinned checkout'а с pinned транзитивами.
 *
 * Проблема: `bun install -g github:<repo>#<commit>` пинит только снапшот самого
 * пакета — его dependencies bun разрешает по latest (ни github:-спека, ни
 * global-install из локального пути чужой bun.lock НЕ читают — проверено
 * эмпирически на bun 1.3.14: global из пути с bun.lock@picocolors-1.0.0 поставил
 * 1.1.1). Поэтому:
 *   1. clone pinned коммита (git fetch <sha> --depth 1, как marketplace.installer);
 *   2. `bun install --frozen-lockfile` В ЧЕКАУТЕ — транзитивы строго по локу,
 *      рассинхрон lock↔package.json → fail-closed (bun падает);
 *   3. `bun install --global <workDir>` — bun копирует каталог целиком, включая
 *      node_modules (проверено на 1.3.14: реальная копия, не symlink), поэтому
 *      runtime-резолв кода пакета идёт по вложенным pinned-зависимостям.
 *
 * Fail-closed (no legacy unpinned fallback):
 *   - нет bun.lock/bun.lockb в апстрим-чекауте → throw (refuse unpinned transitives);
 *   - git недоступен (ENOENT) → throw (cannot verify pin/lock).
 */
export async function installGitNpmPinned(req: GitNpmPinnedInstall): Promise<void> {
  const runCmd = req.runCmd ?? runCommand;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // BUN_INSTALL направляет глобальную установку внутрь toolchain-layout:
    // versionDir/install/global/node_modules/<pkg> + лончер versionDir/bin/<bin>.
    BUN_INSTALL: req.versionDir,
    // Лончеры сгенерированных npm-wrapper'ов должны находить именно этот bun.
    CRAFT_BUN_PATH: req.bun,
  };
  await fs.promises.mkdir(req.versionDir, { recursive: true });

  let hasLockfile = false;
  await fs.promises.rm(req.workDir, { recursive: true, force: true });
  try {
    await fs.promises.mkdir(req.workDir, { recursive: true });
    await runCmd(['git', 'init', '-q', req.workDir]);
    await runCmd(['git', 'remote', 'add', 'origin', `https://github.com/${req.repo}.git`], { cwd: req.workDir });
    // fetch по полному sha — content-addressed: FETCH_HEAD === req.commit.
    await runCmd(['git', 'fetch', '-q', '--depth', '1', 'origin', req.commit], { cwd: req.workDir });
    await runCmd(['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'], { cwd: req.workDir });
    // Defense-in-depth: same HEAD===pin invariant as marketplace.checkoutPinnedRef.
    // runCommand is void (no stdout capture) — read detached HEAD from .git/HEAD.
    const headRaw = (await fs.promises.readFile(path.join(req.workDir, '.git', 'HEAD'), 'utf8')).trim();
    const head = headRaw.startsWith('ref:') ? '' : headRaw;
    if (head !== req.commit) {
      throw new Error(`git-npm ref mismatch for ${req.repo}: pinned ${req.commit}, got HEAD ${headRaw}`);
    }
    hasLockfile =
      fs.existsSync(path.join(req.workDir, 'bun.lock')) || fs.existsSync(path.join(req.workDir, 'bun.lockb'));
  } catch (error) {
    await fs.promises.rm(req.workDir, { recursive: true, force: true });
    // git недоступен — fail-closed: без git нельзя верифицировать pin/lock.
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new Error(`git-npm fail-closed: git unavailable; cannot verify pin/lock for ${req.repo}`);
    }
    throw error;
  }

  if (!hasLockfile) {
    await fs.promises.rm(req.workDir, { recursive: true, force: true });
    throw new Error(
      `git-npm fail-closed: no bun.lock/bun.lockb in ${req.repo}@${req.commit.slice(0, 8)} — refuse unpinned transitives`,
    );
  }

  try {
    // Транзитивы — строго по локфайлу апстрима; расхождение lock↔package.json
    // здесь фатально (fail-closed, зеркалит npm ci --frozen-lockfile).
    await runCmd([req.bun, 'install', '--frozen-lockfile'], { cwd: req.workDir, env });
    // Global-install из чекаута: bun копирует каталог (включая node_modules) —
    // pinned-транзитивы едут вместе с пакетом в versionDir/install/global.
    await runCmd([req.bun, 'install', '--global', req.workDir], { env });
  } finally {
    await fs.promises.rm(req.workDir, { recursive: true, force: true });
  }
}
