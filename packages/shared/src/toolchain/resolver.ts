/**
 * Резолвер исполняемых файлов.
 * Приоритет: toolchain (установленные менеджером) → PATH.
 *
 * Bundled-бинарники (claude/uv/ripgrep/bun из Electron-бандла) сюда НЕ вшиты:
 * их каталоги добавляются в PATH сабпроцесса интеграционным слоем
 * (injector при спавне агента) — shared-пакет не знает layout бандла.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TOOLCHAIN_MANIFEST } from './manifest';
import { OPENCLAW_NPM_PIN } from './npm-locks';
import { TOOLCHAIN_INSTALL_COMPLETE_MARKER } from './types';
import type { ManagedOpenClawLauncher, ToolchainPaths, ToolchainPlatform, ToolchainResolver } from './types';

const isWindows = process.platform === 'win32';

/** Имена-кандидаты для поиска: на Windows исполняемый файл имеет расширение (.exe/.cmd/.bat). */
function candidateNames(name: string, win = isWindows): string[] {
  if (!win) return [name];
  return /\.(exe|cmd|bat)$/i.test(name) ? [name] : [`${name}.exe`, `${name}.cmd`, name];
}

/** Файл существует и исполняем (на win32 — просто существует). */
async function isExecutable(file: string, win = isWindows): Promise<boolean> {
  try {
    await fs.promises.access(file, win ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Regular file contained in the real toolchain root; rejects symlink escapes. */
async function isManagedFile(
  toolchainDir: string,
  file: string,
  executable: boolean,
  win: boolean,
): Promise<boolean> {
  try {
    const [realToolchainDir, realFile] = await Promise.all([
      fs.promises.realpath(toolchainDir),
      fs.promises.realpath(file),
    ]);
    const relative = path.relative(realToolchainDir, realFile);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    const stat = await fs.promises.stat(realFile);
    if (!stat.isFile()) return false;
    if (executable && !win) await fs.promises.access(realFile, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ResolverOptions {
  manifest?: typeof TOOLCHAIN_MANIFEST;
  /** DI вместо process.env.PATH (тесты). */
  pathEnv?: string;
  /** DI вместо process.platform (тесты win-семантики на unix). */
  platform?: NodeJS.Platform;
}

/** Собрать ссылку toolchain/<tool>/current → пути кандидатов по binPaths манифеста. */
async function toolchainCandidates(
  paths: ToolchainPaths,
  manifest: typeof TOOLCHAIN_MANIFEST,
  name: string,
  win = isWindows,
  platform: ToolchainPlatform | null = null,
): Promise<string[]> {
  const baseNames = new Set(candidateNames(name, win));
  const found: string[] = [];
  for (const entry of manifest) {
    const artifacts = [
      // только артефакт текущей платформы; null/legacy — весь набор (тесты)
      ...(platform ? [entry.artifacts[platform]] : Object.values(entry.artifacts)),
    ];
    for (const artifact of artifacts) {
      if (!artifact) continue;
      for (const binRel of artifact.binPaths) {
        const base = path.basename(binRel);
        // Бинарь принадлежит запрашиваемому инструменту → принимаем безусловно
        // (worktrunk шипит binary 'wt' — имя файла ≠ имени тула).
        // Для чужих entry (общий прогон по манифесту) — только точные имена.
        if (entry.name !== name && !baseNames.has(base.replace(/\.(exe|cmd|bat)$/i, '')) && !baseNames.has(base)) continue;
        found.push(path.join(paths.toolchainDir, entry.name, 'current', binRel));
      }
    }
  }
  return found;
}

/** PATH-поиск («which» кросс-платформенный). */
async function findInPath(name: string, pathEnv: string | undefined, win = isWindows): Promise<string | null> {
  const dirs = (pathEnv ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidateNames(name, win)) {
      const full = path.join(dir, candidate);
      if (await isExecutable(full, win)) return full;
    }
  }
  return null;
}

export function createResolver(
  paths: ToolchainPaths,
  opts: ResolverOptions = {},
): ToolchainResolver {
  const manifest = opts.manifest ?? TOOLCHAIN_MANIFEST;
  const win = (opts.platform ?? process.platform) === 'win32';
  // Текущая платформа в терминах манифеста: бинарники других платформ в
  // resolver/PATH-prefix не протекают (P3: раньше Object.values брал всех).
  const platName = opts.platform ?? process.platform;
  const platArch = process.arch;
  const platformKey: ToolchainPlatform | null =
    platName === 'darwin'
      ? platArch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64'
      : platName === 'win32'
        ? 'win32-x64'
        : platName === 'linux'
          ? 'linux-x64'
          : null;

  return {
    async findExecutable(name: string): Promise<string | null> {
      if (name === 'openclaw' || (win && /^openclaw\.(exe|cmd|bat)$/i.test(name))) return null;
      // 1) toolchain: <toolchainDir>/<tool>/current/<binPath>
      for (const candidate of await toolchainCandidates(paths, manifest, name, win, platformKey)) {
        if (await isExecutable(candidate, win)) return candidate;
      }
      // 2) PATH
      return findInPath(name, opts.pathEnv ?? process.env.PATH, win);
    },

    async resolveOpenClawLauncher(): Promise<ManagedOpenClawLauncher | null> {
      // This deliberately does not use `findExecutable`: generic resolution can
      // consult PATH, while OpenClaw must only use its exact managed installation.
      if (!platformKey) return null;
      const nodeEntry = manifest.find((entry) => entry.name === 'node' && entry.version === '22.23.2');
      const openclawEntry = manifest.find(
        (entry) =>
          entry.name === 'openclaw' &&
          entry.kind === 'npm' &&
          entry.version === OPENCLAW_NPM_PIN.version,
      );
      const nodeArtifact = nodeEntry?.artifacts[platformKey];
      const openclawArtifact = openclawEntry?.artifacts[platformKey];
      const nodeBinPath = nodeArtifact?.binPaths.find(
        (binPath) => path.basename(binPath) === (win ? 'node.exe' : 'node'),
      );
      if (
        !nodeEntry ||
        !nodeBinPath ||
        !openclawEntry ||
        !openclawArtifact ||
        !openclawArtifact.binPaths.includes(`package/${OPENCLAW_NPM_PIN.entrypoint}`) ||
        openclawArtifact.url !== OPENCLAW_NPM_PIN.tarballUrl ||
        openclawArtifact.sha256 !== OPENCLAW_NPM_PIN.tarballSha256
      ) {
        return null;
      }

      const nodeVersionDir = path.join(paths.toolchainDir, 'node', nodeEntry.version);
      const nodeCurrentDir = path.join(paths.toolchainDir, 'node', 'current');
      const openclawVersionDir = path.join(paths.toolchainDir, 'openclaw', openclawEntry.version);
      const openclawCurrentDir = path.join(paths.toolchainDir, 'openclaw', 'current');
      const executablePath = path.join(nodeVersionDir, nodeBinPath);
      const entrypointPath = path.join(openclawVersionDir, 'package', OPENCLAW_NPM_PIN.entrypoint);

      try {
        const [realNodeVersion, realNodeCurrent, realOpenclawVersion, realOpenclawCurrent, nodeMarker, openclawMarker] =
          await Promise.all([
            fs.promises.realpath(nodeVersionDir),
            fs.promises.realpath(nodeCurrentDir),
            fs.promises.realpath(openclawVersionDir),
            fs.promises.realpath(openclawCurrentDir),
            fs.promises.readFile(path.join(nodeCurrentDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'utf8'),
            fs.promises.readFile(path.join(openclawCurrentDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'utf8'),
          ]);
        if (
          nodeMarker !== `node@${nodeEntry.version}\n` ||
          openclawMarker !== `openclaw@${openclawEntry.version}\n` ||
          (!win && (realNodeCurrent !== realNodeVersion || realOpenclawCurrent !== realOpenclawVersion))
        ) {
          return null;
        }
      } catch {
        return null;
      }

      const [hasManagedNode, hasManagedEntrypoint] = await Promise.all([
        isManagedFile(paths.toolchainDir, executablePath, true, win),
        isManagedFile(paths.toolchainDir, entrypointPath, false, win),
      ]);
      if (!hasManagedNode || !hasManagedEntrypoint) return null;

      return {
        executablePath,
        argsPrefix: [entrypointPath] as const,
        version: OPENCLAW_NPM_PIN.version,
      };
    },

    /** Префикс PATH для сабпроцессов агентов: bin-директории установленных инструментов. */
    async toolchainPathPrefix(): Promise<string> {
      const dirs = new Set<string>();
      for (const entry of manifest) {
        if (entry.name === 'openclaw') continue;
        let installed = false;
        try {
          installed = fs.existsSync(path.join(paths.toolchainDir, entry.name, 'current'));
        } catch {
          installed = false;
        }
        if (!installed) continue;
        const prefixArtifacts = platformKey
          ? [entry.artifacts[platformKey]]
          : Object.values(entry.artifacts);
        for (const artifact of prefixArtifacts) {
          if (!artifact) continue;
          for (const binRel of artifact.binPaths) {
            dirs.add(path.dirname(path.join(paths.toolchainDir, entry.name, 'current', binRel)));
          }
        }
      }
      return [...dirs].join(path.delimiter);
    },

    toolchainDir(): string {
      return paths.toolchainDir;
    },
  };
}
