import { afterEach, describe, expect, it } from 'bun:test';
import { ChatGPTBackendSearchProvider, extractChatGptAccountId } from './chatgpt.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Build a minimal JWT with the given claims payload. */
function makeJwt(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(claims));
  return `${header}.${payload}.fakesignature`;
}

describe('extractChatGptAccountId', () => {
  it('extracts accountId from a valid ChatGPT JWT', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acc_12345',
      },
    });

    expect(extractChatGptAccountId(token)).toBe('acc_12345');
  });

  it('returns null for a JWT without the claim path', () => {
    const token = makeJwt({ sub: 'user_abc', iat: 1234567890 });

    expect(extractChatGptAccountId(token)).toBeNull();
  });

  it('returns null for a JWT with empty accountId', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: '',
      },
    });

    expect(extractChatGptAccountId(token)).toBeNull();
  });

  it('returns null for a non-JWT string', () => {
    expect(extractChatGptAccountId('not-a-jwt')).toBeNull();
    expect(extractChatGptAccountId('')).toBeNull();
  });

  it('returns null for malformed base64', () => {
    expect(extractChatGptAccountId('a.!!!invalid!!!.c')).toBeNull();
  });
});

describe('ChatGPTBackendSearchProvider', () => {
  it('calls ChatGPT backend endpoint with correct auth headers', async () => {
    let calledUrl = '';
    let calledHeaders: Record<string, string> = {};
    let calledBody: any = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = typeof input === 'string' ? input : input.toString();
      calledHeaders = (init?.headers as Record<string, string>) || {};
      calledBody = init?.body ? JSON.parse(String(init.body)) : null;

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'ChatGPT search results.',
                  annotations: [
                    { type: 'url_citation', url: 'https://example.com', title: 'Example' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('my-access-token', 'acc_12345');
    const results = await provider.search('test query', 5);

    expect(provider.name).toBe('ChatGPT');
    expect(calledUrl).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(calledHeaders.Authorization).toBe('Bearer my-access-token');
    expect(calledHeaders['chatgpt-account-id']).toBe('acc_12345');
    expect(calledBody.model).toBe('gpt-5.3-codex');
    expect(calledBody.store).toBe(false);
    expect(calledBody.stream).toBe(true);
    expect(calledBody.instructions).toContain('web search assistant');
    expect(calledBody.tools).toEqual([{ type: 'web_search' }]);
    expect(calledBody.tool_choice).toBe('auto');
    expect(calledBody.parallel_tool_calls).toBe(true);
    expect(calledBody.text).toEqual({ verbosity: 'medium' });
    expect(Array.isArray(calledBody.input)).toBe(true);
    expect(calledBody.input[0]?.role).toBe('user');
    expect(calledBody.input[0]?.content?.[0]?.type).toBe('input_text');
    expect(calledBody.input[0]?.content?.[0]?.text).toContain('Search the web for: test query');
    expect(calledHeaders['OpenAI-Beta']).toBe('responses=experimental');
    expect(results).toHaveLength(1);
    expect(results[0]?.url).toBe('https://example.com');
  });

  it('parses SSE payload even when content-type is not event-stream', async () => {
    globalThis.fetch = (async () => {
      const sse = [
        'event: response.created',
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Status page","annotations":[{"type":"url_citation","url":"https://status.openai.com/","title":"OpenAI Status"}]}]}]}}',
        '',
      ].join('\n');

      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('token', 'acc_123');
    const results = await provider.search('openai status', 3);

    expect(results[0]?.url).toBe('https://status.openai.com/');
  });

  it('retries with web_search_preview when first attempt returns 400', async () => {
    const attempts: Array<{
      tools: unknown;
      model: unknown;
      instructions: unknown;
      store: unknown;
      stream: unknown;
      tool_choice: unknown;
      parallel_tool_calls: unknown;
      text: unknown;
      input: unknown;
    }> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      attempts.push({
        tools: body?.tools,
        model: body?.model,
        instructions: body?.instructions,
        store: body?.store,
        stream: body?.stream,
        tool_choice: body?.tool_choice,
        parallel_tool_calls: body?.parallel_tool_calls,
        text: body?.text,
        input: body?.input,
      });

      if (attempts.length === 1) {
        return new Response('Bad Request', { status: 400 });
      }

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Recovered search results.',
                  annotations: [
                    { type: 'url_citation', url: 'https://retry.example', title: 'Retry Result' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('token', 'acc_123');
    const results = await provider.search('retry query', 3);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.tools).toEqual([{ type: 'web_search' }]);
    expect(attempts[0]?.instructions).toContain('web search assistant');
    expect(attempts[0]?.store).toBe(false);
    expect(attempts[0]?.stream).toBe(true);
    expect(attempts[0]?.tool_choice).toBe('auto');
    expect(attempts[0]?.parallel_tool_calls).toBe(true);
    expect(attempts[0]?.text).toEqual({ verbosity: 'medium' });
    expect(Array.isArray(attempts[0]?.input)).toBe(true);
    expect((attempts[0]?.input as any[])[0]?.role).toBe('user');
    expect((attempts[0]?.input as any[])[0]?.content?.[0]?.type).toBe('input_text');
    expect(attempts[1]?.tools).toEqual([{ type: 'web_search_preview' }]);
    expect(attempts[1]?.instructions).toContain('web search assistant');
    expect(attempts[1]?.store).toBe(false);
    expect(attempts[1]?.stream).toBe(true);
    expect(attempts[1]?.tool_choice).toBe('auto');
    expect(attempts[1]?.parallel_tool_calls).toBe(true);
    expect(attempts[1]?.text).toEqual({ verbosity: 'medium' });
    expect(Array.isArray(attempts[1]?.input)).toBe(true);
    expect((attempts[1]?.input as any[])[0]?.role).toBe('user');
    expect((attempts[1]?.input as any[])[0]?.content?.[0]?.type).toBe('input_text');
    expect(results[0]?.url).toBe('https://retry.example');
  });

  it('retries with web_search_preview when first attempt returns 200 with non-JSON body', async () => {
    const attempts: Array<{ tools: unknown }> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      attempts.push({ tools: body?.tools });

      if (attempts.length === 1) {
        return new Response('Bad Request', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Recovered from parse failure.',
                  annotations: [
                    { type: 'url_citation', url: 'https://parse-retry.example', title: 'Parse Retry Result' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('token', 'acc_123');
    const results = await provider.search('parse retry query', 3);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.tools).toEqual([{ type: 'web_search' }]);
    expect(attempts[1]?.tools).toEqual([{ type: 'web_search_preview' }]);
    expect(results[0]?.url).toBe('https://parse-retry.example');
  });

  it('retries with web_search_preview when first attempt returns invalid SSE payload', async () => {
    const attempts: Array<{ tools: unknown }> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      attempts.push({ tools: body?.tools });

      if (attempts.length === 1) {
        const invalidSse = [
          'event: response.created',
          'data: {"type":"response.created","response":{"id":"resp_1"}}',
          '',
          'event: ping',
          'data: {"type":"response.in_progress"}',
          '',
        ].join('\n');

        return new Response(invalidSse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Recovered from SSE parse failure.',
                  annotations: [
                    { type: 'url_citation', url: 'https://sse-retry.example', title: 'SSE Retry Result' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('token', 'acc_123');
    const results = await provider.search('invalid sse query', 3);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.tools).toEqual([{ type: 'web_search' }]);
    expect(attempts[1]?.tools).toEqual([{ type: 'web_search_preview' }]);
    expect(results[0]?.url).toBe('https://sse-retry.example');
  });

  it('aggregates parse failures when both attempts fail to parse', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const toolType = body?.tools?.[0]?.type;
      return new Response(`Bad Request from ${toolType}`, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('token', 'acc_123');

    let message = '';
    try {
      await provider.search('always parse fail', 5);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('ChatGPT search failed');
    expect(message).toContain('web_search parse failed');
    expect(message).toContain('web_search_preview parse failed');
    expect(message).toContain('content-type=text/plain');
  });

  it('throws immediately on non-400 errors (no retry) with request fingerprint', async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    const provider = new ChatGPTBackendSearchProvider('bad-token', 'acc_123');

    let message = '';
    try {
      await provider.search('test', 5);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('HTTP 401');
    expect(message).toContain('tool=web_search');
    expect(message).toContain('stream=true');
    expect(callCount).toBe(1);
  });
});
