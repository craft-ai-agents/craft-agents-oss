/**
 * Local File Storage
 *
 * Implements IFileStorage using the local filesystem.
 * Files are stored in: {workspaceRoot}/sessions/{sessionId}/{type}/{filename}
 */

import { mkdir, readFile, writeFile, unlink, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IFileStorage, FileType, FileMetadata } from '../types.ts';

export class LocalFileStorage implements IFileStorage {
  constructor(private workspaceRootPath: string) {}

  private getDir(sessionId: string, type: FileType): string {
    return join(this.workspaceRootPath, 'sessions', sessionId, type);
  }

  private getPath(sessionId: string, type: FileType, filename: string): string {
    return join(this.getDir(sessionId, type), filename);
  }

  async upload(
    sessionId: string,
    type: FileType,
    filename: string,
    data: Buffer,
    mimeType = 'application/octet-stream'
  ): Promise<FileMetadata> {
    const dir = this.getDir(sessionId, type);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, filename);
    await writeFile(filePath, data);

    return {
      name: filename,
      size: data.length,
      mimeType,
      uploadedAt: Date.now(),
    };
  }

  async download(sessionId: string, type: FileType, filename: string): Promise<Buffer | null> {
    const filePath = this.getPath(sessionId, type, filename);
    try {
      return await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(sessionId: string, type: FileType, filename: string): Promise<boolean> {
    const filePath = this.getPath(sessionId, type, filename);
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async list(sessionId: string, type: FileType): Promise<FileMetadata[]> {
    const dir = this.getDir(sessionId, type);

    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const metadata: FileMetadata[] = [];
    for (const name of files) {
      const filePath = join(dir, name);
      try {
        const stats = await stat(filePath);
        if (stats.isFile()) {
          metadata.push({
            name,
            size: stats.size,
            mimeType: 'application/octet-stream', // We don't store mime types locally
            uploadedAt: stats.mtimeMs,
          });
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }

    return metadata;
  }

  async deleteAllForSession(sessionId: string): Promise<void> {
    const sessionDir = join(this.workspaceRootPath, 'sessions', sessionId);

    // Delete each file type folder
    const types: FileType[] = ['attachments', 'downloads', 'long_responses'];
    for (const type of types) {
      const dir = join(sessionDir, type);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore errors - folder may not exist
      }
    }
  }

  /**
   * Get a file:// URL for local file access.
   * For local storage, we just return the file path as a file:// URL.
   * The expiresIn parameter is ignored since local files don't expire.
   */
  async getFileUrl(
    sessionId: string,
    type: FileType,
    filename: string,
    _expiresIn?: number
  ): Promise<string> {
    const filePath = this.getPath(sessionId, type, filename);
    return `file://${filePath}`;
  }
}
