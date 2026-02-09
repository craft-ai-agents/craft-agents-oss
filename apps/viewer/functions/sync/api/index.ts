/**
 * DELETE /sync/api
 *
 * Deletes all synced data for the authenticated token.
 * Removes all objects under the token's hash prefix.
 */

interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
  SYNC_BUCKET: R2Bucket;
}

interface SyncData {
  tokenHash: string;
}

export const onRequestDelete: PagesFunction<Env, string, SyncData> = async (context) => {
  const { tokenHash } = context.data;
  const prefix = `${tokenHash}/`;

  // List and delete all objects under this prefix
  let cursor: string | undefined;
  let totalDeleted = 0;

  do {
    const listed = await context.env.SYNC_BUCKET.list({
      prefix,
      cursor,
      limit: 1000,
    });

    if (listed.objects.length > 0) {
      const keys = listed.objects.map(obj => obj.key);
      // R2 supports batch delete of up to 1000 keys
      await context.env.SYNC_BUCKET.delete(keys);
      totalDeleted += keys.length;
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return new Response(JSON.stringify({ ok: true, deleted: totalDeleted }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
