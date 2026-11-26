/**
 * Preloaded by credential-routing.subprocess.test.ts. Every request is blocked, as in
 * block-network.ts, after it reports where its credential was going:
 * `CREDENTIAL_REQUEST <origin> <credential> model=<model>` (the bearer token or
 * API-key header, `-` when the request carries none; the model the body asks for).
 *
 * With CREDENTIAL_TEST_REJECT_ORIGIN set, requests to that origin get the
 * "model does not exist" 404 an OpenAI-compatible server sends for a model it
 * doesn't serve, instead of the network error.
 */
function targetOf(input: string | URL | Request): string {
  return typeof input === 'string' || input instanceof URL ? String(input) : input.url;
}

function credentialOf(input: string | URL | Request, init?: RequestInit): string {
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  return headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? headers.get('x-api-key')
    ?? headers.get('x-goog-api-key')
    ?? '-';
}

async function requestedModel(input: string | URL | Request, init?: RequestInit): Promise<string> {
  const body = input instanceof Request ? await input.clone().text() : typeof init?.body === 'string' ? init.body : '';
  try {
    return String(JSON.parse(body).model ?? '');
  } catch {
    return '';
  }
}

const recordingFetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = targetOf(input);
    const origin = new URL(target).origin;
    const model = await requestedModel(input, init);
    console.error(`CREDENTIAL_REQUEST ${origin} ${credentialOf(input, init)} model=${model}`);
    if (origin === process.env.CREDENTIAL_TEST_REJECT_ORIGIN) {
      return new Response(
        JSON.stringify({ error: { message: `The model \`${model}\` does not exist`, type: 'invalid_request_error', code: 'model_not_found' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`OFFLINE_FETCH_BLOCKED: unexpected network request to ${target}`);
  },
  {
    preconnect: (url: string | URL): void => {
      throw new Error(`OFFLINE_FETCH_BLOCKED: unexpected network request to ${String(url)}`);
    },
  },
) satisfies typeof globalThis.fetch;

globalThis.fetch = recordingFetch;
