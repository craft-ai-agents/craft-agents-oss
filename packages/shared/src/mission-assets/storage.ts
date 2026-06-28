import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  access as accessAsync,
  copyFile as copyFileAsync,
  mkdir as mkdirAsync,
  readFile as readFileAsync,
  rename as renameAsync,
  rm as rmAsync,
  stat as statAsync,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  assetRelativePath,
  classifyMissionAsset,
  displayKind,
  inferMimeType,
} from './classify.ts';
import {
  MISSION_ASSET_MANIFEST_FILE,
  MISSION_ASSETS_DIR,
  type MissionAssetImportCandidate,
  type MissionAssetImportOptions,
  type MissionAssetImportResult,
  type MissionAssetManifest,
  type MissionAssetRecord,
} from './types.ts';

const DEFAULT_DIRECTORIES = [
  'audio/masters',
  'audio/demos',
  'audio/stems',
  'audio/references',
  'video/raw',
  'video/edits',
  'video/finals',
  'images/cover-art',
  'images/press-photos',
  'images/moodboard',
  'docs/lyrics',
  'docs/press',
  'docs/notes',
  'exports/social',
  'exports/epk',
];
const MAX_INLINE_HASH_BYTES = 256 * 1024 * 1024;

export function getMissionAssetsRoot(workspaceRootPath: string): string {
  return join(workspaceRootPath, MISSION_ASSETS_DIR);
}

export function getMissionAssetManifestPath(workspaceRootPath: string): string {
  return join(getMissionAssetsRoot(workspaceRootPath), MISSION_ASSET_MANIFEST_FILE);
}

export function ensureMissionAssetsFolders(workspaceRootPath: string): void {
  const root = getMissionAssetsRoot(workspaceRootPath);
  mkdirSync(root, { recursive: true });
  for (const dir of DEFAULT_DIRECTORIES) {
    mkdirSync(join(root, dir), { recursive: true });
  }
}

export async function ensureMissionAssetsFoldersAsync(workspaceRootPath: string): Promise<void> {
  const root = getMissionAssetsRoot(workspaceRootPath);
  await mkdirAsync(root, { recursive: true });
  await Promise.all(DEFAULT_DIRECTORIES.map((dir) => mkdirAsync(join(root, dir), { recursive: true })));
}

export function loadMissionAssetManifest(workspaceRootPath: string, workspaceId = 'workspace'): MissionAssetManifest {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyMissionAssetManifest(workspaceId);
  const result = readManifestFile(file);
  return result.manifest ?? emptyMissionAssetManifest(workspaceId);
}

function loadMissionAssetManifestForImport(workspaceRootPath: string, workspaceId: string): MissionAssetManifest {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyMissionAssetManifest(workspaceId);
  const result = readManifestFile(file);
  if (result.manifest) return result.manifest;
  const backup = backupInvalidManifest(file);
  throw new Error(`Mission asset manifest is invalid (${result.reason}). Backup saved to ${backup}. Fix or remove manifest before importing.`);
}

async function loadMissionAssetManifestForImportAsync(workspaceRootPath: string, workspaceId: string): Promise<MissionAssetManifest> {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!(await pathExists(file))) return emptyMissionAssetManifest(workspaceId);
  const result = await readManifestFileAsync(file);
  if (result.manifest) return result.manifest;
  const backup = await backupInvalidManifestAsync(file);
  throw new Error(`Mission asset manifest is invalid (${result.reason}). Backup saved to ${backup}. Fix or remove manifest before importing.`);
}

function readManifestFile(file: string): { manifest?: MissionAssetManifest; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as MissionAssetManifest;
    if (!isMissionAssetManifest(parsed)) return { reason: 'schema mismatch' };
    return { manifest: parsed, reason: 'ok' };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'parse failed' };
  }
}

async function readManifestFileAsync(file: string): Promise<{ manifest?: MissionAssetManifest; reason: string }> {
  try {
    const parsed = JSON.parse(await readFileAsync(file, 'utf-8')) as MissionAssetManifest;
    if (!isMissionAssetManifest(parsed)) return { reason: 'schema mismatch' };
    return { manifest: parsed, reason: 'ok' };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'parse failed' };
  }
}

export function saveMissionAssetManifest(workspaceRootPath: string, manifest: MissionAssetManifest): MissionAssetManifest {
  ensureMissionAssetsFolders(workspaceRootPath);
  const file = getMissionAssetManifestPath(workspaceRootPath);
  atomicWriteJson(file, manifest);
  return manifest;
}

export async function saveMissionAssetManifestAsync(workspaceRootPath: string, manifest: MissionAssetManifest): Promise<MissionAssetManifest> {
  await ensureMissionAssetsFoldersAsync(workspaceRootPath);
  const file = getMissionAssetManifestPath(workspaceRootPath);
  await atomicWriteJsonAsync(file, manifest);
  return manifest;
}

export function planMissionAssetImports(
  workspaceRootPath: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): { candidates: MissionAssetImportCandidate[]; skipped: Array<{ path: string; reason: string }> } {
  const candidates: MissionAssetImportCandidate[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const plannedDestinations = new Set<string>();

  for (const sourcePath of filePaths) {
    try {
      if (!sourcePath || sourcePath.includes('\0')) {
        skipped.push({ path: sourcePath, reason: 'Invalid path' });
        continue;
      }
      const info = statSync(sourcePath);
      if (!info.isFile()) {
        skipped.push({ path: sourcePath, reason: 'Only files can be imported' });
        continue;
      }
      const classification = classifyMissionAsset(sourcePath, options.kindHint ?? 'any');
      const destinationRelativePath = uniqueDestinationRelativePath(
        workspaceRootPath,
        classification.directory,
        basename(sourcePath),
        plannedDestinations,
      );
      plannedDestinations.add(destinationRelativePath);
      candidates.push({
        sourcePath,
        fileName: basename(sourcePath),
        kind: classification.kind,
        destinationRelativePath,
        confidence: classification.confidence,
        reason: classification.reason,
        sizeBytes: info.size,
        mimeType: inferMimeType(sourcePath),
      });
    } catch (err) {
      skipped.push({ path: sourcePath, reason: err instanceof Error ? err.message : 'Unable to inspect file' });
    }
  }

  return { candidates, skipped };
}

export async function planMissionAssetImportsAsync(
  workspaceRootPath: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): Promise<{ candidates: MissionAssetImportCandidate[]; skipped: Array<{ path: string; reason: string }> }> {
  const candidates: MissionAssetImportCandidate[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const plannedDestinations = new Set<string>();

  for (const sourcePath of filePaths) {
    try {
      if (!sourcePath || sourcePath.includes('\0')) {
        skipped.push({ path: sourcePath, reason: 'Invalid path' });
        continue;
      }
      const info = await statAsync(sourcePath);
      if (!info.isFile()) {
        skipped.push({ path: sourcePath, reason: 'Only files can be imported' });
        continue;
      }
      const classification = classifyMissionAsset(sourcePath, options.kindHint ?? 'any');
      const destinationRelativePath = await uniqueDestinationRelativePathAsync(
        workspaceRootPath,
        classification.directory,
        basename(sourcePath),
        plannedDestinations,
      );
      plannedDestinations.add(destinationRelativePath);
      candidates.push({
        sourcePath,
        fileName: basename(sourcePath),
        kind: classification.kind,
        destinationRelativePath,
        confidence: classification.confidence,
        reason: classification.reason,
        sizeBytes: info.size,
        mimeType: inferMimeType(sourcePath),
      });
    } catch (err) {
      skipped.push({ path: sourcePath, reason: err instanceof Error ? err.message : 'Unable to inspect file' });
    }
  }

  return { candidates, skipped };
}

export function importMissionAssets(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): MissionAssetImportResult {
  ensureMissionAssetsFolders(workspaceRootPath);
  const manifest = loadMissionAssetManifestForImport(workspaceRootPath, workspaceId);
  const plan = planMissionAssetImports(workspaceRootPath, filePaths, options);
  const imported: MissionAssetRecord[] = [];
  const skipped = [...plan.skipped];
  const now = new Date().toISOString();

  for (const candidate of plan.candidates) {
    try {
      const destination = resolve(workspaceRootPath, candidate.destinationRelativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(candidate.sourcePath, destination);
      const { sizeBytes, sha256 } = sizeAndHash(destination);
      const record: MissionAssetRecord = {
        id: `asset_${randomUUID()}`,
        kind: candidate.kind,
        label: displayKind(candidate.kind),
        relativePath: candidate.destinationRelativePath,
        mimeType: candidate.mimeType ?? inferMimeType(candidate.fileName),
        sizeBytes,
        sha256,
        source: 'copy',
        status: 'available',
        usableByAgents: true,
        notes: candidate.reason,
        createdAt: now,
        updatedAt: now,
      };
      imported.push(record);
      manifest.files.push(record);
    } catch (err) {
      skipped.push({
        path: candidate.sourcePath,
        reason: err instanceof Error ? err.message : 'Failed to copy file',
      });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.storageMode = 'copied';
  manifest.updatedAt = new Date().toISOString();
  saveMissionAssetManifest(workspaceRootPath, manifest);
  return { manifest, imported, skipped };
}

export async function importMissionAssetsAsync(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): Promise<MissionAssetImportResult> {
  await ensureMissionAssetsFoldersAsync(workspaceRootPath);
  const manifest = await loadMissionAssetManifestForImportAsync(workspaceRootPath, workspaceId);
  const plan = await planMissionAssetImportsAsync(workspaceRootPath, filePaths, options);
  const imported: MissionAssetRecord[] = [];
  const skipped = [...plan.skipped];
  const now = new Date().toISOString();

  for (const candidate of plan.candidates) {
    try {
      const destination = resolve(workspaceRootPath, candidate.destinationRelativePath);
      await mkdirAsync(dirname(destination), { recursive: true });
      await copyFileAsync(candidate.sourcePath, destination);
      const { sizeBytes, sha256 } = await sizeAndHashAsync(destination);
      const record: MissionAssetRecord = {
        id: `asset_${randomUUID()}`,
        kind: candidate.kind,
        label: displayKind(candidate.kind),
        relativePath: candidate.destinationRelativePath,
        mimeType: candidate.mimeType ?? inferMimeType(candidate.fileName),
        sizeBytes,
        sha256,
        source: 'copy',
        status: 'available',
        usableByAgents: true,
        notes: candidate.reason,
        createdAt: now,
        updatedAt: now,
      };
      imported.push(record);
      manifest.files.push(record);
    } catch (err) {
      skipped.push({
        path: candidate.sourcePath,
        reason: err instanceof Error ? err.message : 'Failed to copy file',
      });
    }
  }

  manifest.workspaceId = workspaceId;
  manifest.assetsRoot = MISSION_ASSETS_DIR;
  manifest.storageMode = 'copied';
  manifest.updatedAt = new Date().toISOString();
  await saveMissionAssetManifestAsync(workspaceRootPath, manifest);
  return { manifest, imported, skipped };
}

export function emptyMissionAssetManifest(workspaceId: string): MissionAssetManifest {
  return {
    version: 1,
    workspaceId,
    assetsRoot: MISSION_ASSETS_DIR,
    storageMode: 'copied',
    files: [],
    updatedAt: new Date().toISOString(),
  };
}

async function uniqueDestinationRelativePathAsync(
  workspaceRootPath: string,
  directory: string,
  fileName: string,
  plannedDestinations: Set<string>,
): Promise<string> {
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? fileName : `${stem}-${index}${ext}`;
    const relative = assetRelativePath(directory, candidateName);
    const absolute = resolve(workspaceRootPath, relative);
    if (!(await pathExists(absolute)) && !plannedDestinations.has(relative)) return relative;
    index += 1;
  }
}

function uniqueDestinationRelativePath(
  workspaceRootPath: string,
  directory: string,
  fileName: string,
  plannedDestinations: Set<string>,
): string {
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? fileName : `${stem}-${index}${ext}`;
    const relative = assetRelativePath(directory, candidateName);
    const absolute = resolve(workspaceRootPath, relative);
    if (!existsSync(absolute) && !plannedDestinations.has(relative)) return relative;
    index += 1;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await accessAsync(path);
    return true;
  } catch {
    return false;
  }
}

function sizeAndHash(path: string): { sizeBytes: number; sha256?: string } {
  const sizeBytes = statSync(path).size;
  if (sizeBytes > MAX_INLINE_HASH_BYTES) {
    return { sizeBytes };
  }
  const data = readFileSync(path);
  return {
    sizeBytes,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

async function sizeAndHashAsync(path: string): Promise<{ sizeBytes: number; sha256?: string }> {
  const { size } = await statAsync(path);
  if (size > MAX_INLINE_HASH_BYTES) {
    return { sizeBytes: size };
  }
  const data = await readFileAsync(path);
  return {
    sizeBytes: size,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function invalidBackupPath(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${file}.invalid-${stamp}`;
}

function backupInvalidManifest(file: string): string {
  const backup = invalidBackupPath(file);
  copyFileSync(file, backup);
  return backup;
}

async function backupInvalidManifestAsync(file: string): Promise<string> {
  const backup = invalidBackupPath(file);
  await copyFileAsync(file, backup);
  return backup;
}

function atomicWriteJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    renameSync(tmp, file);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

async function atomicWriteJsonAsync(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFileAsync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    await renameAsync(tmp, file);
  } catch (err) {
    try { await rmAsync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

function isMissionAssetManifest(value: unknown): value is MissionAssetManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MissionAssetManifest>;
  return candidate.version === 1
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.assetsRoot === 'string'
    && Array.isArray(candidate.files)
    && typeof candidate.updatedAt === 'string';
}
