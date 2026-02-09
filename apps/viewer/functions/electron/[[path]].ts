interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
}

/** Content-Type mapping for release artifacts */
const CONTENT_TYPES: Record<string, string> = {
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.json': 'application/json',
  '.dmg': 'application/octet-stream',
  '.zip': 'application/zip',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
  '.sh': 'text/x-shellscript',
  '.ps1': 'text/plain',
};

/** Files that should not be cached (mutable manifests) */
const NO_CACHE_EXTENSIONS = new Set(['.yml', '.yaml', '.json', '.sh', '.ps1']);

function getContentType(key: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (key.endsWith(ext)) return type;
  }
  // Keys without extension (e.g. "latest")
  if (key === 'latest' || key.endsWith('/latest')) return 'application/json';
  return 'application/octet-stream';
}

function getCacheControl(key: string): string {
  if (key === 'latest' || key.endsWith('/latest')) return 'no-cache';
  for (const ext of NO_CACHE_EXTENSIONS) {
    if (key.endsWith(ext)) return 'no-cache';
  }
  return 'public, max-age=31536000, immutable';
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const segments = context.params.path;
  if (!segments || (Array.isArray(segments) && segments.length === 0)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = Array.isArray(segments) ? segments.join('/') : segments;

  const object = await context.env.RELEASES_BUCKET.get(key);
  if (!object) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const contentType =
    object.httpMetadata?.contentType || getContentType(key);

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': getCacheControl(key),
    },
  });
};
