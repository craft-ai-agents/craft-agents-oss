/**
 * Декларативный манифест toolchain + платформенные хелперы.
 * Единственная точка правки при бампе версий — manifest-data.ts.
 */

import * as path from 'node:path';

import { MANIFEST_DATA, TOOL_PLATFORM_MATRIX } from './manifest-data';
import type {
  ToolEntry,
  ToolName,
  ToolchainPaths,
  ToolchainPlatform,
} from './types';

/** Текущая платформа в терминах манифеста. */
export function currentPlatform(): ToolchainPlatform {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (platform === 'win32') return 'win32-x64';
  return 'linux-x64';
}

/** Стандартные пути toolchain внутри config-dir (обычно ~/.craft-agent). */
export function toolchainPaths(configDir: string): ToolchainPaths {
  const toolchainDir = path.join(configDir, 'toolchain');
  return {
    toolchainDir,
    downloadsDir: path.join(configDir, 'downloads'),
    stateFile: path.join(toolchainDir, 'state.json'),
  };
}

/** Собранный манифест: данные из manifest-data.ts + тип ToolEntry. */
function buildManifest(): ToolEntry[] {
  const entries: ToolEntry[] = [];
  for (const [name, data] of Object.entries(MANIFEST_DATA)) {
    if (!data) continue;
    entries.push({
      name: name as ToolName,
      version: data.version,
      kind: data.kind,
      tier: data.tier,
      critical: data.critical,
      displayName: data.displayName,
      artifacts: data.artifacts,
      dependsOn: data.dependsOn,
      systemBinary: data.systemBinary,
      brewFormula: data.brewFormula,
      pipPackage: data.pipPackage,
      pipModule: data.pipModule,
      platforms: TOOL_PLATFORM_MATRIX[name as ToolName],
    });
  }
  return entries;
}

export const TOOLCHAIN_MANIFEST: ToolEntry[] = buildManifest();

/**
 * Загрузить манифест. Обертка над константой — точка расширения,
 * если позже появится remote-manifest.
 */
export function loadManifest(): ToolEntry[] {
  return TOOLCHAIN_MANIFEST;
}
