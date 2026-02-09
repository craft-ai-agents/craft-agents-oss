/**
 * Sync Engine
 *
 * Orchestrates push and pull operations using the manifest builder,
 * diff calculator, and HTTP client.
 */

import { readFile, writeFile, mkdir, unlink, rm } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { SyncClient } from './client.ts'
import { buildLocalManifest, computeSyncDiff, MAX_TOTAL_SIZE } from './manifest.ts'
import type { SyncProgress, SyncResult, PullPreview, SyncManifest, SyncDiff } from './types.ts'

export class SyncEngine {
  private client: SyncClient
  private workspacePath: string
  private workspaceId: string
  private workspaceName: string
  private onProgress: (progress: SyncProgress) => void

  constructor(opts: {
    token: string
    workspacePath: string
    workspaceId: string
    workspaceName: string
    onProgress?: (progress: SyncProgress) => void
  }) {
    this.client = new SyncClient(opts.token)
    this.workspacePath = opts.workspacePath
    this.workspaceId = opts.workspaceId
    this.workspaceName = opts.workspaceName
    this.onProgress = opts.onProgress ?? (() => {})
  }

  /** Push local workspace to cloud */
  async push(): Promise<SyncResult> {
    const startTime = Date.now()

    try {
      // Phase 1: Scan local files
      this.emitProgress('scanning', 0, 0, 0, 0)
      const localManifest = await buildLocalManifest(
        this.workspacePath,
        this.workspaceId,
        this.workspaceName,
      )

      if (localManifest.totalSize > MAX_TOTAL_SIZE) {
        throw new Error(`Workspace too large: ${(localManifest.totalSize / 1024 / 1024).toFixed(1)}MB (max 500MB)`)
      }

      // Phase 2: Get remote manifest and compute diff
      this.emitProgress('comparing', 0, localManifest.files.length, 0, 0)
      const remoteManifest = await this.client.getRemoteManifest()
      const diff = computeSyncDiff(localManifest, remoteManifest, 'push')

      const filesToUpload = [...diff.added, ...diff.modified]
      if (filesToUpload.length === 0 && diff.deleted.length === 0) {
        this.emitProgress('done', 0, 0, 0, 0)
        return {
          success: true,
          filesTransferred: 0,
          filesDeleted: 0,
          bytesTransferred: 0,
          durationMs: Date.now() - startTime,
        }
      }

      // Phase 3: Read and encode files to upload
      this.emitProgress('uploading', 0, filesToUpload.length, 0, diff.transferSize)
      const encodedFiles: { path: string; data: string }[] = []
      let processedBytes = 0

      for (let i = 0; i < filesToUpload.length; i++) {
        const entry = filesToUpload[i]!
        const fullPath = join(this.workspacePath, entry.path)
        const content = await readFile(fullPath)
        encodedFiles.push({
          path: entry.path,
          data: content.toString('base64'),
        })
        processedBytes += entry.size
        this.emitProgress('uploading', i + 1, filesToUpload.length, processedBytes, diff.transferSize, entry.path)
      }

      // Phase 4: Push to cloud
      await this.client.pushFiles(localManifest, encodedFiles)

      this.emitProgress('done', filesToUpload.length, filesToUpload.length, processedBytes, diff.transferSize)
      return {
        success: true,
        filesTransferred: filesToUpload.length,
        filesDeleted: diff.deleted.length,
        bytesTransferred: processedBytes,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.emitProgress('error', 0, 0, 0, 0, undefined, msg)
      return {
        success: false,
        filesTransferred: 0,
        filesDeleted: 0,
        bytesTransferred: 0,
        durationMs: Date.now() - startTime,
        error: msg,
      }
    }
  }

  /** Get a preview of what pulling would do (without actually pulling) */
  async getPullPreview(): Promise<PullPreview> {
    const localManifest = await buildLocalManifest(
      this.workspacePath,
      this.workspaceId,
      this.workspaceName,
    )

    const remoteManifest = await this.client.getRemoteManifest()
    if (!remoteManifest) {
      throw new Error('No data found in the cloud for this token')
    }

    const diff = computeSyncDiff(localManifest, remoteManifest, 'pull')

    return {
      remoteWorkspaceName: remoteManifest.workspaceName,
      remotePushedAt: remoteManifest.pushedAt,
      remotePushedFrom: remoteManifest.pushedFrom,
      added: diff.added.length,
      modified: diff.modified.length,
      deleted: diff.deleted.length,
      downloadSize: diff.transferSize,
      diff,
    }
  }

  /** Pull remote workspace data to local */
  async pull(): Promise<SyncResult> {
    const startTime = Date.now()

    try {
      // Phase 1: Scan local
      this.emitProgress('scanning', 0, 0, 0, 0)
      const localManifest = await buildLocalManifest(
        this.workspacePath,
        this.workspaceId,
        this.workspaceName,
      )

      // Phase 2: Get remote and diff
      this.emitProgress('comparing', 0, 0, 0, 0)
      const remoteManifest = await this.client.getRemoteManifest()
      if (!remoteManifest) {
        throw new Error('No data found in the cloud for this token')
      }

      const diff = computeSyncDiff(localManifest, remoteManifest, 'pull')
      const filesToDownload = [...diff.added, ...diff.modified]

      if (filesToDownload.length === 0 && diff.deleted.length === 0) {
        this.emitProgress('done', 0, 0, 0, 0)
        return {
          success: true,
          filesTransferred: 0,
          filesDeleted: 0,
          bytesTransferred: 0,
          durationMs: Date.now() - startTime,
        }
      }

      // Phase 3: Download files
      this.emitProgress('downloading', 0, filesToDownload.length, 0, diff.transferSize)
      const paths = filesToDownload.map(f => f.path)
      const downloadedFiles = await this.client.pullFiles(paths)

      // Phase 4: Write files to disk
      let processedBytes = 0
      for (let i = 0; i < downloadedFiles.length; i++) {
        const file = downloadedFiles[i]!
        const fullPath = join(this.workspacePath, file.path)
        const dir = dirname(fullPath)
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true })
        }
        const buffer = Buffer.from(file.data, 'base64')
        await writeFile(fullPath, buffer)
        processedBytes += buffer.length
        this.emitProgress('downloading', i + 1, filesToDownload.length, processedBytes, diff.transferSize, file.path)
      }

      // Phase 5: Delete removed files
      if (diff.deleted.length > 0) {
        this.emitProgress('cleaning', 0, diff.deleted.length, processedBytes, diff.transferSize)
        for (const entry of diff.deleted) {
          const fullPath = join(this.workspacePath, entry.path)
          try {
            await unlink(fullPath)
          } catch {
            // File may already be gone
          }
        }
      }

      this.emitProgress('done', filesToDownload.length, filesToDownload.length, processedBytes, diff.transferSize)
      return {
        success: true,
        filesTransferred: filesToDownload.length,
        filesDeleted: diff.deleted.length,
        bytesTransferred: processedBytes,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.emitProgress('error', 0, 0, 0, 0, undefined, msg)
      return {
        success: false,
        filesTransferred: 0,
        filesDeleted: 0,
        bytesTransferred: 0,
        durationMs: Date.now() - startTime,
        error: msg,
      }
    }
  }

  private emitProgress(
    phase: SyncProgress['phase'],
    processedFiles: number,
    totalFiles: number,
    processedBytes: number,
    totalBytes: number,
    currentFile?: string,
    error?: string,
  ) {
    this.onProgress({
      phase,
      currentFile,
      processedFiles,
      totalFiles,
      processedBytes,
      totalBytes,
      error,
    })
  }
}
