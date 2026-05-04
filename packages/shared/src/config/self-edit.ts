import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandPath } from '../utils/paths.ts';
import { safeJsonParse } from '../utils/files.ts';

export interface SelfEditTargetConfig {
  enabled?: boolean;
  repoPath?: string;
  devCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
  testCommand?: string;
}

export interface DeveloperConfig {
  selfEdit?: SelfEditTargetConfig;
}

export interface SelfEditConfigContainer {
  developer?: DeveloperConfig;
}

export interface ResolvedSelfEditTarget {
  enabled: boolean;
  source: 'workspace' | 'global' | 'none';
  repoPath?: string;
  devCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
  testCommand?: string;
}

export interface SelfEditRepoValidationResult {
  valid: boolean;
  repoPath: string;
  packageName?: string;
  errors: string[];
  warnings: string[];
}

const EXPECTED_ROOT_PACKAGE_NAMES = new Set(['craft-agent', 'runneros']);
const EXPECTED_ELECTRON_PACKAGE_NAME = '@craft-agent/electron';
const EXPECTED_SHARED_PACKAGE_NAME = '@craft-agent/shared';

function cleanCommand(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  return trimmed || undefined;
}

function normalizeTarget(target: SelfEditTargetConfig | undefined): SelfEditTargetConfig | undefined {
  if (!target) return undefined;
  const normalized: SelfEditTargetConfig = {};
  if (target.enabled !== undefined) normalized.enabled = target.enabled;
  if (target.repoPath?.trim()) normalized.repoPath = resolve(expandPath(target.repoPath.trim()));
  const devCommand = cleanCommand(target.devCommand);
  const typecheckCommand = cleanCommand(target.typecheckCommand);
  const lintCommand = cleanCommand(target.lintCommand);
  const testCommand = cleanCommand(target.testCommand);
  if (devCommand) normalized.devCommand = devCommand;
  if (typecheckCommand) normalized.typecheckCommand = typecheckCommand;
  if (lintCommand) normalized.lintCommand = lintCommand;
  if (testCommand) normalized.testCommand = testCommand;
  return normalized;
}

export function resolveSelfEditTarget(
  globalConfig?: SelfEditConfigContainer | null,
  workspaceConfig?: SelfEditConfigContainer | null,
): ResolvedSelfEditTarget {
  const globalTarget = normalizeTarget(globalConfig?.developer?.selfEdit);
  const workspaceTarget = normalizeTarget(workspaceConfig?.developer?.selfEdit);
  const source = workspaceTarget ? 'workspace' : globalTarget ? 'global' : 'none';
  const merged = {
    ...(globalTarget ?? {}),
    ...(workspaceTarget ?? {}),
  };

  return {
    enabled: merged.enabled === true,
    source,
    repoPath: merged.repoPath,
    devCommand: merged.devCommand,
    typecheckCommand: merged.typecheckCommand,
    lintCommand: merged.lintCommand,
    testCommand: merged.testCommand,
  };
}

export function validateSelfEditRepo(repoPath: string | undefined): SelfEditRepoValidationResult {
  const resolvedPath = repoPath?.trim() ? resolve(expandPath(repoPath.trim())) : '';
  const errors: string[] = [];
  const warnings: string[] = [];
  let packageName: string | undefined;

  if (!resolvedPath) {
    return {
      valid: false,
      repoPath: '',
      errors: ['Self-edit repo path is not configured.'],
      warnings,
    };
  }

  if (!existsSync(resolvedPath)) {
    return {
      valid: false,
      repoPath: resolvedPath,
      errors: ['Self-edit repo path does not exist.'],
      warnings,
    };
  }

  try {
    if (!statSync(resolvedPath).isDirectory()) {
      errors.push('Self-edit repo path is not a directory.');
    }
  } catch {
    errors.push('Self-edit repo path cannot be read.');
  }

  const packageJsonPath = join(resolvedPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    errors.push('Missing package.json at repo root.');
  } else {
    try {
      const pkg = safeJsonParse(readFileSync(packageJsonPath, 'utf-8')) as { name?: unknown; scripts?: unknown };
      packageName = typeof pkg.name === 'string' ? pkg.name : undefined;
      if (!packageName || !EXPECTED_ROOT_PACKAGE_NAMES.has(packageName)) {
        errors.push('Unexpected root package name; this does not look like RunnerOS.');
      }
      const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts as Record<string, unknown> : {};
      if (typeof scripts['electron:dev'] !== 'string' && typeof scripts.dev !== 'string') {
        warnings.push('No obvious dev script found in package.json.');
      }
      if (typeof scripts['typecheck:all'] !== 'string' && typeof scripts.typecheck !== 'string') {
        warnings.push('No obvious typecheck script found in package.json.');
      }
    } catch {
      errors.push('package.json is not valid JSON.');
    }
  }

  if (!existsSync(join(resolvedPath, '.git'))) {
    errors.push('Missing .git directory at repo root.');
  }
  if (!existsSync(join(resolvedPath, 'apps', 'electron'))) {
    errors.push('Missing apps/electron; this does not look like RunnerOS.');
  } else {
    const electronPackageJsonPath = join(resolvedPath, 'apps', 'electron', 'package.json');
    if (!existsSync(electronPackageJsonPath)) {
      errors.push('Missing apps/electron/package.json; this does not look like RunnerOS.');
    } else {
      try {
        const pkg = safeJsonParse(readFileSync(electronPackageJsonPath, 'utf-8')) as { name?: unknown };
        if (pkg.name !== EXPECTED_ELECTRON_PACKAGE_NAME) {
          errors.push('Unexpected apps/electron package name; this does not look like RunnerOS.');
        }
      } catch {
        errors.push('apps/electron/package.json is not valid JSON.');
      }
    }
  }
  if (!existsSync(join(resolvedPath, 'packages', 'shared'))) {
    errors.push('Missing packages/shared; this does not look like RunnerOS.');
  } else {
    const sharedPackageJsonPath = join(resolvedPath, 'packages', 'shared', 'package.json');
    if (!existsSync(sharedPackageJsonPath)) {
      errors.push('Missing packages/shared/package.json; this does not look like RunnerOS.');
    } else {
      try {
        const pkg = safeJsonParse(readFileSync(sharedPackageJsonPath, 'utf-8')) as { name?: unknown };
        if (pkg.name !== EXPECTED_SHARED_PACKAGE_NAME) {
          errors.push('Unexpected packages/shared package name; this does not look like RunnerOS.');
        }
      } catch {
        errors.push('packages/shared/package.json is not valid JSON.');
      }
    }
  }

  const gitConfigPath = join(resolvedPath, '.git', 'config');
  if (existsSync(gitConfigPath)) {
    try {
      const gitConfig = readFileSync(gitConfigPath, 'utf-8').toLowerCase();
      if (!gitConfig.includes('runneros') && !gitConfig.includes('craft-agents')) {
        warnings.push('No obvious RunnerOS/Craft Agents git remote found.');
      }
    } catch {
      warnings.push('Could not read git remote configuration.');
    }
  }

  return {
    valid: errors.length === 0,
    repoPath: resolvedPath,
    packageName,
    errors,
    warnings,
  };
}
