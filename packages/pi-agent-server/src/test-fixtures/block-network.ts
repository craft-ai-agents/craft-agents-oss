/**
 * Preloaded by bundle-smoke.test.ts so no test can make a real provider request.
 * A blocked request first reports whether its body carried the prompt image
 * (`REQUEST_IMAGE=present|omitted|none`), so image tests can assert on it.
 */
function blockedNetworkTarget(input: string | URL | Request): never {
  const target = typeof input === 'string' || input instanceof URL
    ? String(input)
    : input.url;
  throw new Error(`OFFLINE_FETCH_BLOCKED: unexpected network request to ${target}`);
}

async function requestBody(input: string | URL | Request, init?: RequestInit): Promise<string> {
  if (input instanceof Request) return input.clone().text();
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  return '';
}

function describeImage(body: string): 'present' | 'omitted' | 'none' {
  if (body.includes('Image omitted')) return 'omitted';
  return body.includes('image/png') ? 'present' : 'none';
}

const blockedFetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    console.error(`REQUEST_IMAGE=${describeImage(await requestBody(input, init))}`);
    return blockedNetworkTarget(input);
  },
  {
    preconnect: (url: string | URL): void => blockedNetworkTarget(url),
  },
) satisfies typeof globalThis.fetch;

globalThis.fetch = blockedFetch;
