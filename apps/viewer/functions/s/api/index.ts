interface Env {
  SESSIONS_BUCKET: R2Bucket;
  RELEASES_BUCKET: R2Bucket;
}

const MAX_BODY_SIZE = 25 * 1024 * 1024; // 25 MB

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const contentLength = Number(context.request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await context.request.text();
  if (body.length > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  await context.env.SESSIONS_BUCKET.put(id, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  const url = new URL(context.request.url);
  const shareUrl = `${url.origin}/s/${id}`;

  return new Response(JSON.stringify({ id, url: shareUrl }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
