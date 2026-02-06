/**
 * Cloud File Storage
 *
 * Implements IFileStorage using R2 via REST API endpoints
 * in the Cloudflare Worker.
 */

import type { IFileStorage, FileType, FileMetadata } from '../types.ts';

export class CloudFileStorage implements IFileStorage {
  constructor(
    private baseUrl: string,
    private workspaceSlug: string,
    private apiKey: string
  ) {}

  private getUrl(sessionId: string, type: FileType, filename?: string): string {
    const base = `${this.baseUrl}/files/${this.workspaceSlug}/${sessionId}/${type}`;
    return filename ? `${base}/${encodeURIComponent(filename)}` : base;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async upload(
    sessionId: string,
    type: FileType,
    filename: string,
    data: Buffer,
    mimeType = 'application/octet-stream'
  ): Promise<FileMetadata> {
    const url = this.getUrl(sessionId, type, filename);
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...this.headers,
        'Content-Type': mimeType,
      },
      body: data,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`File upload failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<FileMetadata>;
  }

  async download(sessionId: string, type: FileType, filename: string): Promise<Buffer | null> {
    const url = this.getUrl(sessionId, type, filename);
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`File download failed: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(sessionId: string, type: FileType, filename: string): Promise<boolean> {
    const url = this.getUrl(sessionId, type, filename);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`File delete failed: ${response.status} - ${error}`);
    }

    return true;
  }

  async list(sessionId: string, type: FileType): Promise<FileMetadata[]> {
    const url = this.getUrl(sessionId, type);
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`File list failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<FileMetadata[]>;
  }

  async deleteAllForSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/files/${this.workspaceSlug}/${sessionId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Delete all files failed: ${response.status} - ${error}`);
    }
  }

  /**
   * Get a signed URL for direct file access (browser, <img> tags, etc.)
   * @param expiresIn - Expiration time in seconds (default 900 = 15 minutes)
   */
  async getFileUrl(
    sessionId: string,
    type: FileType,
    filename: string,
    expiresIn = 900
  ): Promise<string> {
    const url = `${this.getUrl(sessionId, type, filename)}/sign`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate signed URL: ${response.status} - ${error}`);
    }

    const { url: signedUrl } = (await response.json()) as { url: string };
    return signedUrl;
  }
}
