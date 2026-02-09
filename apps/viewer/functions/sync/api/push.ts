/**
 * POST /sync/api/push
 *
 * Receives a manifest and base64-encoded files.
 * Writes files to R2, cleans up deleted files, and updates the manifest.
 *
 * Body: { manifest: SyncManifest, files: { path: string, data: string }[] }
 */

interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
  SYNC_BUCKET: R2Bucket;
}

interface SyncData {
  tokenHash: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB total
const MAX_BODY_SIZE = 600 * 1024 * 1024; // 600MB body limit (base64 overhead)

const ALLOWED_EXTENSIONS = new Set([
  '.json', '.jsonl', '.md', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.pdf', '.txt', '.yaml', '.yml',
]);

function getExtension(path: string): string {
  const dotIdx = path.lastIndexOf('.');
  return dotIdx >= 0 ? path.slice(dotIdx).toLowerCase() : '';
}

function isPathSafe(path: string): boolean {
  // Block path traversal and absolute paths
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('..')) return false;
  if (path.includes('\0')) return false;
  return true;
}

interface PushBody {
  manifest: {
    version: number;
    workspaceId: string;
    workspaceName: string;
    pushedAt: number;
    pushedFrom: string;
    totalSize: number;
    files: { path: string; size: number; sha256: string; updatedAt: number }[];
  };
  files: { path: string; data: string }[];
}

export const onRequestPost: PagesFunction<Env, string, SyncData> = async (context) => {
  const { tokenHash } = context.data;

  // Check body size
  const contentLength = Number(context.request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: PushBody;
  try {
    body = await context.request.json() as PushBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { manifest, files } = body;

  // Validate manifest
  if (!manifest || manifest.version !== 1 || !manifest.workspaceId || !Array.isArray(manifest.files)) {
    return new Response(JSON.stringify({ error: 'Invalid manifest' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate total size
  if (manifest.totalSize > MAX_TOTAL_SIZE) {
    return new Response(JSON.stringify({ error: `Total size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit` }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate files
  for (const file of files) {
    if (!isPathSafe(file.path)) {
      return new Response(JSON.stringify({ error: `Unsafe path: ${file.path}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ext = getExtension(file.path);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new Response(JSON.stringify({ error: `Disallowed file extension: ${ext}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Decode and check size
    const decoded = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
    if (decoded.length > MAX_FILE_SIZE) {
      return new Response(JSON.stringify({ error: `File too large: ${file.path} (${decoded.length} bytes)` }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Get old manifest to find deleted files
  const oldManifestKey = `${tokenHash}/manifest.json`;
  const oldManifestObj = await context.env.SYNC_BUCKET.get(oldManifestKey);
  let oldManifest: PushBody['manifest'] | null = null;
  if (oldManifestObj) {
    try {
      oldManifest = await oldManifestObj.json() as PushBody['manifest'];
    } catch {
      // Corrupted old manifest, treat as fresh push
    }
  }

  // Upload files
  for (const file of files) {
    const key = `${tokenHash}/workspace/${file.path}`;
    const decoded = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
    await context.env.SYNC_BUCKET.put(key, decoded);
  }

  // Clean up deleted files (in old manifest but not in new)
  if (oldManifest) {
    const newPaths = new Set(manifest.files.map(f => f.path));
    for (const oldFile of oldManifest.files) {
      if (!newPaths.has(oldFile.path)) {
        const key = `${tokenHash}/workspace/${oldFile.path}`;
        await context.env.SYNC_BUCKET.delete(key);
      }
    }
  }

  // Write new manifest
  await context.env.SYNC_BUCKET.put(oldManifestKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(JSON.stringify({ ok: true, filesUploaded: files.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
