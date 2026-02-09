interface Env {
  SESSIONS_BUCKET: R2Bucket;
}

const MAX_BODY_SIZE = 25 * 1024 * 1024; // 25 MB

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string;
  const object = await context.env.SESSIONS_BUCKET.get(id);

  if (!object) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string;
  const existing = await context.env.SESSIONS_BUCKET.head(id);

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  await context.env.SESSIONS_BUCKET.put(id, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  return new Response(JSON.stringify({ id }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string;
  await context.env.SESSIONS_BUCKET.delete(id);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
