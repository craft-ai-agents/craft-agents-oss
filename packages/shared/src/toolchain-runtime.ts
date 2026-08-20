/**
 * Интеграция toolchain в рантайм агентов/сервера.
 *
 * Ленивые синглтоны resolver/manager (config-dir scoped) + хелперы спавна
 * агентов: резолв OMP-бинарника (env → toolchain/PATH → friendly error →
 * last-resort 'omp') и PATH-префикс из установленного toolchain.
 *
 * Spec: docs/superpowers/specs/2026-08-06-toolchain-download-manager-design.md
 */

import { delimiter } from 'node:path';

import { CONFIG_DIR } from './config/paths.ts';
import { getToolchainDisabled, setToolchainDisabled } from './config/storage.ts';
import { createManager, createResolver, toolchainPaths } from './toolchain/index.ts';
import type { ToolName, ToolchainManager, ToolchainResolver } from './toolchain/index.ts';

export interface ToolchainRuntime {
  resolver: ToolchainResolver;
  manager: ToolchainManager;
}

let cached: ToolchainRuntime | null = null;

/** Ленивый синглтон: manager/resolver сеет state только при первом обращении. */
export function getToolchain(): ToolchainRuntime {
  if (!cached) {
    const paths = toolchainPaths(CONFIG_DIR);
    cached = {
      resolver: createResolver(paths),
      // Стартовый disabled-список — из config.toolchain.disabled (storage).
      manager: createManager(paths, { disabledTools: getToolchainDisabled() as ToolName[] }),
    };
  }
  return cached;
}

export function getToolchainManager(): ToolchainManager {
  return getToolchain().manager;
}

/**
 * Применить disabled-список (config + живой менеджер) и вернуть применённый.
 * Перезапуск ensureAll — забота вызывающего (хендлер toolchain:setDisabled).
 */
export function setToolchainDisabledTools(tools: ToolName[]): ToolName[] {
  setToolchainDisabled(tools);
  return getToolchainManager().setDisabledTools(tools);
}

/** Фазы, в которых отсутствующий omp объясняется «ещё ставится», а не ENOENT. */
const INSTALLING_PHASES: Record<string, true> = {
  downloading: true,
  installing: true,
  offline: true,
  error: true,
};

/**
 * Резолв OMP CLI.
 * Приоритет: OMP_CLI_PATH env (override) → toolchain → PATH (через resolver) →
 * friendly error если toolchain ещё ставит omp → last-resort 'omp' (поведение
 * spawn-error не меняется).
 */
export async function resolveOmpExecutableOrExplain(): Promise<string> {
  const envOverride = process.env.OMP_CLI_PATH?.trim();
  if (envOverride) return envOverride;

  const { resolver, manager } = getToolchain();
  const resolved = await resolver.findExecutable('omp');
  if (resolved) return resolved;

  let phase: string | undefined;
  let toolError: string | undefined;
  try {
    const status = (await manager.status()).find((s) => s.name === 'omp');
    phase = status?.phase;
    toolError = status?.error;
  } catch {
    // Чтение статуса не фатально — проваливаемся в last-resort spawn.
  }
  if (phase && INSTALLING_PHASES[phase]) {
    throw new Error(
      `OMP runtime is still installing (toolchain: ${phase}${toolError ? ` — ${toolError}` : ''}). ` +
        'Please wait for the download to finish and retry.',
    );
  }
  return 'omp';
}

/**
 * Префикс PATH для сабпроцессов агентов: bin-директории установленного
 * toolchain впереди существующего PATH. Без установленных инструментов
 * возвращает env без изменений.
 */
export async function withToolchainPathPrefix<T extends NodeJS.ProcessEnv>(env: T): Promise<T> {
  let prefix: string;
  try {
    prefix = await getToolchain().resolver.toolchainPathPrefix();
  } catch {
    return env;
  }
  if (!prefix) return env;
  const existing = env.PATH ?? '';
  return { ...env, PATH: existing ? `${prefix}${delimiter}${existing}` : prefix };
}
