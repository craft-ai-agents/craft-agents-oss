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

export function loadMissionAssetManifest(workspaceRootPath: string, workspaceId = 'workspace'): MissionAssetManifest {
  const file = getMissionAssetManifestPath(workspaceRootPath);
  if (!existsSync(file)) return emptyMissionAssetManifest(workspaceId);
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as MissionAssetManifest;
    if (!isMissionAssetManifest(parsed)) return emptyMissionAssetManifest(workspaceId);
    return parsed;
  } catch {
    return emptyMissionAssetManifest(workspaceId);
  }
}

export function saveMissionAssetManifest(workspaceRootPath: string, manifest: MissionAssetManifest): MissionAssetManifest {
  ensureMissionAssetsFolders(workspaceRootPath);
  const file = getMissionAssetManifestPath(workspaceRootPath);
  atomicWriteJson(file, manifest);
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

export function importMissionAssets(
  workspaceRootPath: string,
  workspaceId: string,
  filePaths: string[],
  options: MissionAssetImportOptions = {},
): MissionAssetImportResult {
  ensureMissionAssetsFolders(workspaceRootPath);
  const manifest = loadMissionAssetManifest(workspaceRootPath, workspaceId);
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

function isMissionAssetManifest(value: unknown): value is MissionAssetManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MissionAssetManifest>;
  return candidate.version === 1
    && typeof candidate.workspaceId === 'string'
    && typeof candidate.assetsRoot === 'string'
    && Array.isArray(candidate.files)
    && typeof candidate.updatedAt === 'string';
}
