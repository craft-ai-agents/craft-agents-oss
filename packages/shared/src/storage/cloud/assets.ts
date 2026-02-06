/**
 * Cloud Asset Storage
 *
 * Implements IAssetStorage using R2 via REST API endpoints
 * in the Cloudflare Worker. Workspace-scoped (not session-scoped).
 *
 * R2 key format: {workspace}/_assets/{relativePath}
 */

import type { IAssetStorage } from '../types.ts';

export class CloudAssetStorage implements IAssetStorage {
  constructor(
    private baseUrl: string,
    private workspaceSlug: string,
    private apiKey: string
  ) {}

  private getUrl(relativePath: string): string {
    return `${this.baseUrl}/assets/${this.workspaceSlug}/${relativePath}`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async upload(relativePath: string, data: Buffer | string, mimeType: string): Promise<void> {
    const url = this.getUrl(relativePath);
    // Convert to types accepted by fetch body
    const body: string | Uint8Array = typeof data === 'string' ? data : new Uint8Array(data);

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...this.headers,
        'Content-Type': mimeType,
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Asset upload failed: ${response.status} - ${error}`);
    }
  }

  async download(relativePath: string): Promise<string | null> {
    const url = this.getUrl(relativePath);
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Asset download failed: ${response.status} - ${error}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // SVGs return as UTF-8 string (same as local readFileSync().toString('utf-8'))
    if (contentType.includes('svg') || relativePath.endsWith('.svg')) {
      return response.text();
    }

    // Binary images return as data URL (same as local handler)
    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mime = contentType || 'image/png';
    return `data:${mime};base64,${base64}`;
  }

  async delete(relativePath: string): Promise<boolean> {
    const url = this.getUrl(relativePath);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Asset delete failed: ${response.status} - ${error}`);
    }

    return true;
  }

  async getSignedUrl(relativePath: string, expiresIn = 900): Promise<string> {
    const url = `${this.baseUrl}/assets/${this.workspaceSlug}/sign/${relativePath}`;
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
