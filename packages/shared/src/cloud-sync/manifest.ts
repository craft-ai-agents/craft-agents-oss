/**
 * Manifest Builder & Diff Calculator
 *
 * Scans local workspace directory, computes file hashes,
 * and calculates diffs between local and remote manifests.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { createHash } from 'crypto'
import { hostname } from 'os'
import type { SyncManifest, SyncFileEntry, SyncDiff } from './types.ts'

/** Max file size: 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024

/** Max total workspace size: 500MB */
export const MAX_TOTAL_SIZE = 500 * 1024 * 1024

/** Directories to skip entirely */
const SKIP_DIRS = new Set([
  'long_responses',
  'downloads',
  'node_modules',
  '.claude-plugin',
])

/** Files to skip */
const SKIP_FILES = new Set([
  'credentials.enc',
  '.credential-cache.json',
  '.DS_Store',
])

/** Allowed file extensions */
const ALLOWED_EXTENSIONS = new Set([
  '.json', '.jsonl', '.md', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.pdf', '.txt', '.yaml', '.yml',
])

/** Check if a file should be included in sync */
function shouldIncludeFile(name: string): boolean {
  if (SKIP_FILES.has(name)) return false
  const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')) : ''
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase())
}

/** Compute SHA-256 hash of file contents */
async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

/** Recursively walk a directory and collect syncable files */
async function walkDir(
  dirPath: string,
  basePath: string,
  files: SyncFileEntry[],
): Promise<number> {
  let totalSize = 0

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    const relativePath = relative(basePath, fullPath)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      totalSize += await walkDir(fullPath, basePath, files)
    } else if (entry.isFile()) {
      if (!shouldIncludeFile(entry.name)) continue

      const fileStat = await stat(fullPath)
      if (fileStat.size > MAX_FILE_SIZE) continue
      if (fileStat.size === 0) continue

      const sha256 = await hashFile(fullPath)
      const fileEntry: SyncFileEntry = {
        path: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
        size: fileStat.size,
        sha256,
        updatedAt: fileStat.mtimeMs,
      }

      files.push(fileEntry)
      totalSize += fileStat.size
    }
  }

  return totalSize
}

/** Build a manifest from a local workspace directory */
export async function buildLocalManifest(
  workspacePath: string,
  workspaceId: string,
  workspaceName: string,
): Promise<SyncManifest> {
  const files: SyncFileEntry[] = []
  const totalSize = await walkDir(workspacePath, workspacePath, files)

  return {
    version: 1,
    workspaceId,
    workspaceName,
    pushedAt: Date.now(),
    pushedFrom: hostname(),
    totalSize,
    files,
  }
}

/** Compute the diff between local and remote manifests */
export function computeSyncDiff(
  local: SyncManifest,
  remote: SyncManifest | null,
  direction: 'push' | 'pull',
): SyncDiff {
  // For push: local is "new", remote is "old"
  // For pull: remote is "new", local is "old"
  const newManifest = direction === 'push' ? local : remote!
  const oldManifest = direction === 'push' ? remote : local

  if (!oldManifest) {
    // No old manifest — everything is new
    return {
      added: newManifest.files,
      modified: [],
      deleted: [],
      transferSize: newManifest.files.reduce((sum, f) => sum + f.size, 0),
    }
  }

  const oldMap = new Map(oldManifest.files.map(f => [f.path, f]))
  const newMap = new Map(newManifest.files.map(f => [f.path, f]))

  const added: SyncFileEntry[] = []
  const modified: SyncFileEntry[] = []
  const deleted: SyncFileEntry[] = []

  // Find added and modified
  for (const [path, newFile] of newMap) {
    const oldFile = oldMap.get(path)
    if (!oldFile) {
      added.push(newFile)
    } else if (oldFile.sha256 !== newFile.sha256) {
      modified.push(newFile)
    }
  }

  // Find deleted
  for (const [path, oldFile] of oldMap) {
    if (!newMap.has(path)) {
      deleted.push(oldFile)
    }
  }

  const transferSize = [...added, ...modified].reduce((sum, f) => sum + f.size, 0)

  return { added, modified, deleted, transferSize }
}
