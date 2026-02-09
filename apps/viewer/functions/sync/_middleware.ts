/**
 * Sync API Middleware
 *
 * Validates the X-Sync-Token header and computes the SHA-256 hash
 * that serves as the R2 key prefix. Attaches to context.data.
 */

interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
  SYNC_BUCKET: R2Bucket;
}

interface SyncData {
  tokenHash: string;
}

const TOKEN_REGEX = /^g4sync_[0-9a-f]{32}$/;

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const onRequest: PagesFunction<Env, string, SyncData> = async (context) => {
  const token = context.request.headers.get('X-Sync-Token');

  if (!token || !TOKEN_REGEX.test(token)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing sync token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tokenHash = await sha256(token);
  context.data = { tokenHash } as SyncData;

  return context.next();
};
