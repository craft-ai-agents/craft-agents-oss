/**
 * GET /sync/api/manifest
 *
 * Returns the remote sync manifest for the authenticated token.
 * Returns 404 if no manifest exists (workspace never pushed).
 */

interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
  SYNC_BUCKET: R2Bucket;
}

interface SyncData {
  tokenHash: string;
}

export const onRequestGet: PagesFunction<Env, string, SyncData> = async (context) => {
  const { tokenHash } = context.data;
  const key = `${tokenHash}/manifest.json`;

  const object = await context.env.SYNC_BUCKET.get(key);
  if (!object) {
    return new Response(JSON.stringify({ error: 'No manifest found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
};
