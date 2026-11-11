/** Offline provider for the real bundle: only the synthetic endpoint is accepted. */
const encoder = new TextEncoder();
const endpoint = 'https://streaming-ipc.invalid/v1/chat/completions';
let timer: ReturnType<typeof setInterval> | undefined;
let writes = 0;
let blockedWrites = 0;
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
  writes++;
  const accepted = originalWrite(...args);
  if (!accepted) blockedWrites++;
  return accepted;
}) as typeof process.stdout.write;

globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== endpoint) throw new Error(`OFFLINE_FETCH_BLOCKED: ${url}`);
  const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : '{}')));
  const messages = body.messages as Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  const content = [...messages].reverse().find(message => message.role === 'user')?.content ?? '';
  const prompt = typeof content === 'string' ? content : content.map(part => part.text ?? '').join('');
  const size = Number(/linear:(\d+)/.exec(prompt)?.[1] ?? 0);
  const slow = prompt === 'slow-reader';
  const toolFollowUp = messages.at(-1)?.role === 'tool';
  const deltas: Array<Record<string, unknown>> = [];
  if (size && !toolFollowUp) {
    for (let offset = 0; offset < size; offset += 32) deltas.push({ reasoning_content: 'r'.repeat(Math.min(32, size - offset)) });
    for (let offset = 0; offset < size; offset += 32) deltas.push({ content: 't'.repeat(Math.min(32, size - offset)) });
    const args = JSON.stringify({ payload: 'a'.repeat(size) });
    deltas.push({ tool_calls: [{ index: 0, id: 'offline-tool', type: 'function', function: { name: 'mcp__offline__echo', arguments: '' } }] });
    for (let offset = 0; offset < args.length; offset += 32) {
      deltas.push({ tool_calls: [{ index: 0, function: { arguments: args.slice(offset, offset + 32) } }] });
    }
  } else if (slow) {
    for (let index = 0; index < 1024; index++) deltas.push({ content: 's'.repeat(128) });
    // stderr remains drainable while the test deliberately stops reading stdout.
    timer ??= setInterval(() => process.stderr.write(`IPC_WRITES:${writes}:${blockedWrites}\n`), 25);
    timer.unref();
  } else {
    deltas.push({ content: 'completed' });
  }

  let index = 0;
  let closed = false;
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => {
        process.stderr.write('IPC_PROVIDER_ABORTED\n');
        if (!closed) {
          closed = true;
          controller.error(new DOMException('Aborted', 'AbortError'));
        }
      }, { once: true });
    },
    async pull(controller) {
      // A real streamed response yields between chunks; do not preload the whole
      // response into the SDK before its first event reaches the pipe.
      await Bun.sleep(1);
      if (closed) return;
      if (index < deltas.length) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id: 'offline-response', object: 'chat.completion.chunk', created: 1, model: 'offline-ipc',
          choices: [{ index: 0, delta: deltas[index++], finish_reason: null }],
        })}\n\n`));
      } else {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          id: 'offline-response', choices: [{ index: 0, delta: {}, finish_reason: size && !toolFollowUp ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        })}\n\ndata: [DONE]\n\n`));
        closed = true;
        controller.close();
      }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}, {
  preconnect(url: string | URL): never { throw new Error(`OFFLINE_FETCH_BLOCKED: ${url}`); },
}) as typeof fetch;
