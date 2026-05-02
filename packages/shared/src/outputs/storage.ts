/**
 * Workflow Outputs - workspace-local manifest persistence.
 *
 * Layout:
 *   <workspaceRoot>/outputs/<outputId>/output.json
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import type { CreateOutputBundleInput, OutputAsset, OutputManifest, OutputSummary } from './types.ts';
import { previewModeForMimeType, summarizeOutputContent, toOutputSummary } from './preview.ts';
import {
  assertOutputManifest,
  assertValidOutputId,
  isContainedPath,
  isOutputManifest,
  isSafeRelativeAssetPath,
  isValidOutputId,
} from './validation.ts';

export const OUTPUTS_DIR = 'outputs';
export const OUTPUT_MANIFEST_FILE = 'output.json';

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'output';
}

function resolveOutputDir(workspaceRootPath: string, outputId: string): string | null {
  if (!isValidOutputId(outputId)) return null;
  const outputsRoot = resolve(workspaceRootPath, OUTPUTS_DIR);
  const outputDir = resolve(outputsRoot, outputId);
  return isContainedPath(outputsRoot, outputDir) ? outputDir : null;
}

/** `<workspaceRoot>/outputs/` */
export function getOutputsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, OUTPUTS_DIR);
}

/** `<workspaceRoot>/outputs/<outputId>/` */
export function getOutputDir(workspaceRootPath: string, outputId: string): string {
  const dir = resolveOutputDir(workspaceRootPath, outputId);
  if (!dir) throw new Error(`Invalid output id: ${outputId}`);
  return dir;
}

/** Back-compat alias for the phase-1 bundle directory. */
export function getOutputBundleDir(workspaceRootPath: string, outputId: string): string | null {
  return resolveOutputDir(workspaceRootPath, outputId);
}

/** `<workspaceRoot>/outputs/<outputId>/output.json` */
export function getOutputManifestFile(workspaceRootPath: string, outputId: string): string {
  return join(getOutputDir(workspaceRootPath, outputId), OUTPUT_MANIFEST_FILE);
}

/**
 * Resolve an asset path for preview/open operations. Relative paths must stay
 * inside the output bundle. Absolute paths are allowed only inside the
 * workspace root, which keeps file actions scoped to the current workspace.
 */
export function resolveOutputAssetPath(
  workspaceRootPath: string,
  outputId: string,
  assetPath: string,
): string | null {
  const outputDir = resolveOutputDir(workspaceRootPath, outputId);
  if (!outputDir || !assetPath || assetPath.includes('\0')) return null;

  if (isAbsolute(assetPath)) {
    const workspaceRoot = resolve(workspaceRootPath);
    const resolvedAssetPath = resolve(assetPath);
    return isContainedPath(workspaceRoot, resolvedAssetPath) ? resolvedAssetPath : null;
  }

  if (!isSafeRelativeAssetPath(assetPath)) return null;
  const resolvedAssetPath = resolve(outputDir, assetPath);
  return isContainedPath(outputDir, resolvedAssetPath) ? resolvedAssetPath : null;
}

export function assertOutputAssetPath(workspaceRootPath: string, outputId: string, assetPath: string): string {
  const resolvedPath = resolveOutputAssetPath(workspaceRootPath, outputId, assetPath);
  if (!resolvedPath) {
    throw new Error(`Invalid output asset path: ${assetPath}`);
  }
  return resolvedPath;
}

/**
 * Atomic JSON write. The pid + UUID suffix on the tmp filename prevents two
 * concurrent writers from clobbering each other's tmp file before rename.
 * Same shape as `writeFileAtomic` in `packages/shared/src/memory/storage.ts`.
 */
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

function contentFilename(mimeType: string): string {
  if (mimeType === 'application/json') return 'content.json';
  if (mimeType === 'text/plain') return 'content.txt';
  return 'content.md';
}

function sizeAndHash(path: string): { sizeBytes: number; sha256: string } {
  const data = readFileSync(path);
  return {
    sizeBytes: statSync(path).size,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function assertSafeManifestAssetPaths(workspaceRootPath: string, manifest: OutputManifest): void {
  for (const asset of manifest.assets) {
    assertOutputAssetPath(workspaceRootPath, manifest.id, asset.path);
  }
  if (manifest.primary) {
    assertOutputAssetPath(workspaceRootPath, manifest.id, manifest.primary.path);
  }
}

function isManifestAssetPathsSafe(workspaceRootPath: string, manifest: OutputManifest): boolean {
  try {
    assertSafeManifestAssetPaths(workspaceRootPath, manifest);
    return true;
  } catch {
    return false;
  }
}

export function createOutputManifest(workspaceRootPath: string, manifest: OutputManifest): void {
  assertOutputManifest(manifest, manifest.id);
  assertSafeManifestAssetPaths(workspaceRootPath, manifest);
  const file = getOutputManifestFile(workspaceRootPath, manifest.id);
  if (existsSync(file)) throw new Error(`Output manifest already exists: ${manifest.id}`);
  writeOutputManifest(workspaceRootPath, manifest);
}

/**
 * Atomically write an output manifest. Creates the output directory if needed,
 * writes to a sibling `.tmp`, then renames within the same filesystem.
 */
export function writeOutputManifest(workspaceRootPath: string, manifest: OutputManifest): void {
  assertOutputManifest(manifest, manifest.id);
  assertSafeManifestAssetPaths(workspaceRootPath, manifest);
  const dir = getOutputDir(workspaceRootPath, manifest.id);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, OUTPUT_MANIFEST_FILE), manifest);
}

/** Read an output manifest. Returns null when missing, unparsable, or invalid. */
export function readOutputManifest(workspaceRootPath: string, outputId: string): OutputManifest | null {
  const dir = resolveOutputDir(workspaceRootPath, outputId);
  if (!dir) return null;
  const file = join(dir, OUTPUT_MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!isOutputManifest(parsed, outputId)) return null;
    if (!isManifestAssetPathsSafe(workspaceRootPath, parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** List all output manifests for a workspace, sorted newest-first by `createdAt`. */
export function listOutputManifests(workspaceRootPath: string): OutputManifest[] {
  const root = getOutputsDir(workspaceRootPath);
  if (!existsSync(root)) return [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: OutputManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = readOutputManifest(workspaceRootPath, entry.name);
    if (manifest) out.push(manifest);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

function uniqueOutputSlug(workspaceRootPath: string, desired: string, ownId: string): string {
  const existing = new Set(
    listOutputManifests(workspaceRootPath)
      .filter((m) => m.id !== ownId)
      .map((m) => m.slug),
  );
  if (!existing.has(desired)) return desired;
  // Match the `-vN` convention used by the agent slug suggester so users
  // see one consistent collision shape across the app.
  let suffix = 2;
  while (existing.has(`${desired}-v${suffix}`)) suffix += 1;
  return `${desired}-v${suffix}`;
}

export function createOutputBundle(workspaceRootPath: string, input: CreateOutputBundleInput): OutputManifest {
  const id = input.id ?? randomUUID();
  assertValidOutputId(id);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const updatedAt = createdAt;
  const outputDir = getOutputDir(workspaceRootPath, id);
  for (const asset of input.assets ?? []) {
    assertOutputAssetPath(workspaceRootPath, id, asset.path);
  }
  mkdirSync(outputDir, { recursive: true });

  const assets: OutputAsset[] = [...(input.assets ?? [])];
  let primary: OutputAsset | undefined = assets.find((asset) => asset.role === 'primary');
  let preview = undefined as OutputManifest['preview'];
  let summary = input.summary?.trim() ?? '';

  // Stage content under a tmp name in the same dir; only rename to the
  // canonical filename after the manifest write succeeds. This avoids
  // orphaning `content.md` in the output dir if validation throws.
  let contentTmpPath: string | null = null;
  let contentFinalPath: string | null = null;

  if (input.content !== undefined) {
    const mimeType = input.contentMimeType ?? 'text/markdown';
    const filename = contentFilename(mimeType);
    contentFinalPath = join(outputDir, filename);
    contentTmpPath = `${contentFinalPath}.${process.pid}.${randomUUID()}.staging`;
    writeFileSync(contentTmpPath, input.content, 'utf-8');
    const meta = sizeAndHash(contentTmpPath);
    primary = {
      id: 'primary',
      label: basename(filename, extname(filename)) || 'Content',
      role: 'primary',
      path: filename,
      mimeType,
      ...meta,
    };
    assets.unshift(primary);
    preview = {
      mode: previewModeForMimeType(mimeType),
      assetId: primary.id,
      inlineText: summarizeOutputContent(input.content, 800),
    };
    if (!summary) summary = summarizeOutputContent(input.content);
  }

  const desiredSlug = slugify(input.title);
  const manifest: OutputManifest = {
    schemaVersion: 1,
    id,
    workspaceId: input.workspaceId,
    title: input.title,
    slug: uniqueOutputSlug(workspaceRootPath, desiredSlug, id),
    kind: input.kind,
    status: input.status ?? 'published',
    summary,
    createdAt,
    updatedAt,
    completedAt: input.completedAt,
    origin: input.origin,
    primary,
    assets,
    receipts: input.receipts ?? [],
    links: input.links ?? [],
    preview,
    tags: input.tags,
  };

  try {
    writeOutputManifest(workspaceRootPath, manifest);
  } catch (err) {
    if (contentTmpPath) {
      try { rmSync(contentTmpPath, { force: true }); } catch { /* ignore */ }
    }
    throw err;
  }

  if (contentTmpPath && contentFinalPath) {
    try {
      renameSync(contentTmpPath, contentFinalPath);
    } catch (err) {
      try { unlinkSync(contentTmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  return manifest;
}

export function readOutput(workspaceRootPath: string, outputId: string): OutputManifest | null {
  return readOutputManifest(workspaceRootPath, outputId);
}

export function listOutputs(workspaceRootPath: string): OutputSummary[] {
  return listOutputManifests(workspaceRootPath).map(toOutputSummary);
}

/** Delete an output bundle. Returns true when something was removed. */
export function deleteOutput(workspaceRootPath: string, outputId: string): boolean {
  const dir = resolveOutputDir(workspaceRootPath, outputId);
  if (!dir) return false;
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export {
  assertOutputManifest,
  assertValidOutputId,
  isOutputManifest,
  isValidOutputId,
};
