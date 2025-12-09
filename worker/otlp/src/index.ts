interface Env {
  LANGSMITH_API_KEY: string;
  LANGSMITH_PROJECT?: string;
}

const LANGSMITH_OTLP_ENDPOINT = 'https://api.smith.langchain.com/otel/v1/traces';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/v1/traces' && request.method === 'POST') {
      return handleTraces(request, env);
    }

    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleTraces(request: Request, env: Env): Promise<Response> {
  if (!env.LANGSMITH_API_KEY) {
    console.error('LANGSMITH_API_KEY secret not configured');
    return new Response('Internal Server Error', { status: 500 });
  }

  try {
    const body = await request.arrayBuffer();
    const contentType = request.headers.get('Content-Type') || 'application/x-protobuf';

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('x-api-key', env.LANGSMITH_API_KEY);

    if (env.LANGSMITH_PROJECT) {
      headers.set('Langsmith-Project', env.LANGSMITH_PROJECT);
    }

    const response = await fetch(LANGSMITH_OTLP_ENDPOINT, {
      method: 'POST',
      headers,
      body,
    });

    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error('Error forwarding traces:', error);
    return new Response('Bad Gateway', { status: 502 });
  }
}

function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
