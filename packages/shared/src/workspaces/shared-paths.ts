import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { getPrivateTeamDir } from './team-mode.ts';

export const WORKSPACE_VAULT_OBJECTS_DIR = 'vault/objects';
export const SHARED_PATH_OVERRIDES_FILE = 'path-overrides.json';

export type SharedPathRefKind = 'workspace' | 'vault-object' | 'external';
export type SharedPathReadinessStatus = 'ready' | 'missing' | 'placeholder' | 'size-mismatch' | 'hash-mismatch' | 'unreadable';

export interface SharedPathRef {
  version: 1;
  kind: SharedPathRefKind;
  path?: string;
  refId?: string;
  expectedSizeBytes?: number;
  sha256?: string;
  label?: string;
}

export interface SharedPathResolveOptions {
  homeDir?: string;
  externalOverrides?: SharedPathOverrides;
}

export interface SharedPathReadiness {
  status: SharedPathReadinessStatus;
  absolutePath: string;
  reason?: string;
  repair?: {
    kind: 'external-path-override';
    refId: string;
    label?: string;
    message: string;
  };
}

export type SharedPathOverrides = Record<string, string>;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function assertSafeRelativePath(value: string): string {
  const normalized = normalizeRelativePath(value);
  if (!normalized || normalized.includes('\0') || isAbsolute(normalized)) {
    throw new Error(`Invalid shared workspace path: ${value}`);
  }
  const root = resolve('/');
  const resolved = resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    throw new Error(`Invalid shared workspace path: ${value}`);
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error(`Invalid shared workspace path: ${value}`);
  }
  return normalized;
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const between = relative(parent, candidate);
  return between === '' || (!between.startsWith('..') && !isAbsolute(between));
}

function expandPortablePath(value: string, options: SharedPathResolveOptions = {}): string {
  const home = options.homeDir ?? homedir();
  if (value === '~') return home;
  if (value.startsWith('~/')) return resolve(home, value.slice(2));
  if (value.startsWith('${HOME}/')) return resolve(home, value.slice('${HOME}/'.length));
  if (value.startsWith('$HOME/')) return resolve(home, value.slice('$HOME/'.length));
  return isAbsolute(value) ? resolve(value) : resolve(value);
}

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function safeObjectName(fileName: string): string {
  const cleaned = fileName
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 160);
  return cleaned || 'object';
}

export function createWorkspaceRelativePathRef(
  workspaceRootPath: string,
  absolutePath: string,
  input: { expectedSizeBytes?: number; sha256?: string; label?: string } = {},
): SharedPathRef {
  if (!isPathInside(workspaceRootPath, absolutePath)) {
    throw new Error('Path is outside the workspace. Copy it into the vault or store it as an external path.');
  }
  return {
    version: 1,
    kind: 'workspace',
    path: assertSafeRelativePath(relative(resolve(workspaceRootPath), resolve(absolutePath))),
    expectedSizeBytes: input.expectedSizeBytes,
    sha256: input.sha256,
    label: input.label,
  };
}

export function createExternalPathRef(
  absolutePath: string,
  input: { homeDir?: string; refId?: string; expectedSizeBytes?: number; sha256?: string; label?: string } = {},
): SharedPathRef {
  if (!isAbsolute(absolutePath)) {
    throw new Error('External shared path refs require an absolute path.');
  }
  return {
    version: 1,
    kind: 'external',
    refId: input.refId ?? createExternalRefId(absolutePath),
    expectedSizeBytes: input.expectedSizeBytes,
    sha256: input.sha256,
    label: input.label,
  };
}

export function copyFileIntoWorkspaceVault(
  workspaceRootPath: string,
  sourcePath: string,
  input: { homeDir?: string; label?: string } = {},
): SharedPathRef {
  const source = resolve(sourcePath);
  const stat = statSync(source);
  if (!stat.isFile()) throw new Error('Only files can be copied into the workspace vault.');

  const sha256 = hashFile(source);
  const objectName = `${sha256}-${safeObjectName(basename(source))}`;
  const relativePath = assertSafeRelativePath(join(WORKSPACE_VAULT_OBJECTS_DIR, sha256.slice(0, 2), objectName));
  const destination = resolve(workspaceRootPath, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination)) copyFileSync(source, destination);

  return {
    version: 1,
    kind: 'vault-object',
    path: relativePath,
    expectedSizeBytes: stat.size,
    sha256,
    label: input.label ?? basename(source),
  };
}

export function resolveSharedPathRef(
  workspaceRootPath: string,
  ref: SharedPathRef,
  options: SharedPathResolveOptions = {},
): string {
  if (ref.kind === 'external') {
    if (!ref.refId) throw new Error('External shared path ref is missing refId.');
    const override = options.externalOverrides?.[ref.refId];
    if (!override) {
      throw new Error(`External path override required for ${ref.refId}.`);
    }
    return expandPortablePath(override, options);
  }
  if (!ref.path) throw new Error('Workspace shared path ref is missing path.');
  return resolve(workspaceRootPath, assertSafeRelativePath(ref.path));
}

function createExternalRefId(absolutePath: string): string {
  const hash = createHash('sha256').update(resolve(absolutePath)).digest('hex').slice(0, 12);
  const name = safeObjectName(basename(absolutePath)).replace(/\.[^.]+$/, '') || 'external-path';
  return `${name}-${hash}`;
}

export function getSharedPathOverridesFile(workspaceId: string): string {
  return join(getPrivateTeamDir(workspaceId), SHARED_PATH_OVERRIDES_FILE);
}

export function loadSharedPathOverrides(workspaceId: string): SharedPathOverrides {
  const file = getSharedPathOverridesFile(workspaceId);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const overrides: SharedPathOverrides = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string' && isAbsolute(value)) {
        overrides[key] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveSharedPathOverrides(workspaceId: string, overrides: SharedPathOverrides): void {
  const file = getSharedPathOverridesFile(workspaceId);
  mkdirSync(dirname(file), { recursive: true });
  const normalized: SharedPathOverrides = {};
  for (const [refId, path] of Object.entries(overrides)) {
    if (!refId.trim()) continue;
    if (!isAbsolute(path)) throw new Error(`Path override for ${refId} must be absolute.`);
    normalized[refId] = resolve(path);
  }
  writeFileSync(file, JSON.stringify(normalized, null, 2) + '\n', 'utf-8');
}

export function setSharedPathOverride(workspaceId: string, refId: string, absolutePath: string): SharedPathOverrides {
  if (!refId.trim()) throw new Error('Path override refId is required.');
  if (!isAbsolute(absolutePath)) throw new Error('Path override must be absolute.');
  const overrides = loadSharedPathOverrides(workspaceId);
  overrides[refId] = resolve(absolutePath);
  saveSharedPathOverrides(workspaceId, overrides);
  return overrides;
}

export function clearSharedPathOverride(workspaceId: string, refId: string): SharedPathOverrides {
  const overrides = loadSharedPathOverrides(workspaceId);
  delete overrides[refId];
  saveSharedPathOverrides(workspaceId, overrides);
  return overrides;
}

export function inspectSharedPathRef(
  workspaceRootPath: string,
  ref: SharedPathRef,
  options: SharedPathResolveOptions = {},
): SharedPathReadiness {
  if (ref.kind === 'external' && (!ref.refId || !options.externalOverrides?.[ref.refId])) {
    const refId = ref.refId ?? '';
    const message = refId
      ? `This file is linked to another machine. Add a local path override for ${refId} or ask the owner to copy it into Vault.`
      : 'This file is linked to another machine but is missing its external reference id.';
    return {
      status: 'missing',
      absolutePath: '',
      reason: message,
      repair: refId
        ? {
            kind: 'external-path-override',
            refId,
            label: ref.label,
            message,
          }
        : undefined,
    };
  }
  const absolutePath = resolveSharedPathRef(workspaceRootPath, ref, options);
  const cloudPlaceholder = join(dirname(absolutePath), `.${basename(absolutePath)}.icloud`);
  if (!existsSync(absolutePath)) {
    return existsSync(cloudPlaceholder)
      ? { status: 'placeholder', absolutePath, reason: 'File is an iCloud placeholder and is not downloaded yet.' }
      : { status: 'missing', absolutePath, reason: 'File does not exist on this machine.' };
  }

  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return { status: 'unreadable', absolutePath, reason: 'Path is not a file.' };
    if (ref.expectedSizeBytes && ref.expectedSizeBytes > 0 && stat.size === 0) {
      return { status: 'placeholder', absolutePath, reason: 'File is zero bytes but the manifest expects content.' };
    }
    if (ref.expectedSizeBytes !== undefined && stat.size > 0 && stat.size !== ref.expectedSizeBytes) {
      return { status: 'size-mismatch', absolutePath, reason: `Expected ${ref.expectedSizeBytes} bytes, found ${stat.size}.` };
    }
    if (ref.sha256) {
      const actualSha256 = hashFile(absolutePath);
      if (actualSha256 !== ref.sha256) {
        return { status: 'hash-mismatch', absolutePath, reason: 'File content does not match the manifest hash.' };
      }
    }

    const fd = openSync(absolutePath, 'r');
    try {
      const sampleBytes = Math.min(64 * 1024, Math.max(1, stat.size));
      const buffer = Buffer.allocUnsafe(sampleBytes);
      const bytesRead = readSync(fd, buffer, 0, sampleBytes, 0);
      if (stat.size > 0 && bytesRead === 0) {
        return { status: 'placeholder', absolutePath, reason: 'File could not be hydrated for reading.' };
      }
    } finally {
      closeSync(fd);
    }
    return { status: 'ready', absolutePath };
  } catch (error) {
    return {
      status: 'unreadable',
      absolutePath,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
