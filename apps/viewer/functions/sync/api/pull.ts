/**
 * POST /sync/api/pull
 *
 * Returns base64-encoded file contents for the requested paths.
 *
 * Body: { paths: string[] }
 * Response: { files: { path: string, data: string }[] }
 */

interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
  SYNC_BUCKET: R2Bucket;
}

interface SyncData {
  tokenHash: string;
}

interface PullBody {
  paths: string[];
}

export const onRequestPost: PagesFunction<Env, string, SyncData> = async (context) => {
  const { tokenHash } = context.data;

  let body: PullBody;
  try {
    body = await context.request.json() as PullBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return new Response(JSON.stringify({ error: 'paths must be a non-empty array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Limit number of files per request
  if (body.paths.length > 1000) {
    return new Response(JSON.stringify({ error: 'Too many files requested (max 1000)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const files: { path: string; data: string }[] = [];

  for (const path of body.paths) {
    // Validate path safety
    if (path.startsWith('/') || path.startsWith('\\') || path.includes('..') || path.includes('\0')) {
      continue; // Skip unsafe paths
    }

    const key = `${tokenHash}/workspace/${path}`;
    const object = await context.env.SYNC_BUCKET.get(key);

    if (object) {
      const arrayBuffer = await object.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      // Convert to base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      files.push({ path, data: base64 });
    }
  }

  return new Response(JSON.stringify({ files }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
