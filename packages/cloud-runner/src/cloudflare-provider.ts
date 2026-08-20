/**
 * CloudflareComputerProvider — Cloud Runs via apps/cloud-gateway
 * (Cloudflare Worker + RunDO + container runner).
 *
 * Thin HTTP client over the gateway contract; all state lives
 * server-side. subscribeEvents polls getStatus (v1; a WS channel is
 * deferred work — see PRD §G2.2 note on DO single-threading).
 */
import type {
  ArtifactMeta,
  CloudRunProvider,
  RunEvent,
  RunHandle,
  RunSpec,
  RunStatus,
} from './types.ts';
import { CloudRunnerError, assertSafeArtifactPath } from './types.ts';

export interface CloudflareProviderOptions {
  /** Gateway base URL, e.g. https://craft-cloud-gateway.<sub>.workers.dev */
  baseUrl: string;
  /** Bearer token (CLOUD_RUNS_TOKEN on the gateway). */
  token: string;
  /** Poll interval for subscribeEvents, ms. */
  pollMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

interface GatewayError {
  error: string;
  code?: string;
}

export class CloudflareComputerProvider implements CloudRunProvider {
  readonly providerId: string = 'cloudflare';
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly pollMs: number;
  private readonly http: typeof fetch;

  constructor(opts: CloudflareProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.pollMs = opts.pollMs ?? 2_000;
    this.http = opts.fetchImpl ?? fetch;
  }

  async createRun(spec: RunSpec): Promise<RunHandle> {
    const res = await this.request('POST', '/runs', spec);
    const body = (await res.json()) as { id?: string; createdAt?: number } & GatewayError;
    if (!res.ok) this.throwGateway(res.status, body);
    return { id: body.id ?? spec.id, provider: this.providerId, createdAt: body.createdAt ?? Date.now() };
  }

  async getStatus(id: string): Promise<RunStatus> {
    const res = await this.request('GET', `/runs/${encodeURIComponent(id)}/status`);
    const body = (await res.json()) as RunStatus & GatewayError;
    if (!res.ok) this.throwGateway(res.status, body);
    return body;
  }

  async cancel(id: string): Promise<void> {
    const res = await this.request('DELETE', `/runs/${encodeURIComponent(id)}`);
    if (!res.ok) this.throwGateway(res.status, (await res.json()) as GatewayError);
  }

  async listArtifacts(id: string): Promise<ArtifactMeta[]> {
    const res = await this.request('GET', `/runs/${encodeURIComponent(id)}/artifacts`);
    const body = (await res.json()) as ArtifactMeta[] & GatewayError;
    if (!res.ok) this.throwGateway(res.status, Array.isArray(body) ? { error: 'unknown' } : body);
    return Array.isArray(body) ? body : [];
  }

  async fetchArtifact(id: string, path: string): Promise<Uint8Array> {
    assertSafeArtifactPath(path);
    const res = await this.request('GET', `/runs/${encodeURIComponent(id)}/artifacts/${path}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as GatewayError;
      this.throwGateway(res.status, body);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** F15: mint the tokenized public share URL (done runs only). */
  async shareRun(id: string): Promise<{ url: string }> {
    const res = await this.request('POST', `/runs/${encodeURIComponent(id)}/share`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as GatewayError;
      this.throwGateway(res.status, body);
    }
    const { token } = (await res.json()) as { token: string };
    return { url: `${this.baseUrl}/share/${encodeURIComponent(id)}/${token}` };
  }

  /** F15: revoke the public share. */
  async revokeShare(id: string): Promise<void> {
    const res = await this.request('POST', `/runs/${encodeURIComponent(id)}/revoke`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as GatewayError;
      this.throwGateway(res.status, body);
    }
  }

  /** F14-WS: live event stream over websocket; converts to our RunEvent. */
  async *subscribeEventsWs(id: string): AsyncIterable<{ t: number; message: string }> {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + `/runs/${encodeURIComponent(id)}/ws`;
    const ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${this.token}` } } as never);
    const queue: ({ t: number; message: string } | null)[] = [];
    let done = false;
    ws.onmessage = (event) => {
      try { queue.push(JSON.parse(String(event.data))); } catch { /* keep-alive */ }
    };
    ws.onclose = () => { done = true; queue.push(null); };
    ws.onerror = () => { done = true; queue.push(null); };
    for (;;) {
      while (queue.length === 0 && !done) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 200);
        await promise;
      }
      const item = queue.shift();
      if (item === null || item === undefined) {
        if (done && queue.length === 0) return;
        continue;
      }
      yield item;
      if (done && queue.length === 0) return;
    }
  }

  /** F14: capped server-side event log (transitions, pack starts, retries). */
  async getEvents(id: string): Promise<{ t: number; message: string }[]> {
    const res = await this.request('GET', `/runs/${encodeURIComponent(id)}/events`);
    if (!res.ok) return [];
    return (await res.json()) as { t: number; message: string }[];
  }

  async *subscribeEvents(id: string): AsyncIterable<RunEvent> {
    let lastState: RunStatus['state'] | null = null;
    let lastCompleted = -1;
    for (;;) {
      const status = await this.getStatus(id);
      if (status.state !== lastState) {
        lastState = status.state;
        yield { type: 'state', status };
      }
      if (status.progress && status.progress.completed !== lastCompleted) {
        lastCompleted = status.progress.completed;
        yield { type: 'progress', completed: status.progress.completed, total: status.progress.total };
      }
      if (status.state !== 'queued' && status.state !== 'running') return;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, this.pollMs);
      await promise;
    }
  }

  // ----------------------------------------------------------

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.http(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private throwGateway(status: number, body: GatewayError): never {
    const code =
      status === 404 || body.code === 'not_found'
        ? 'not_found'
        : status === 400 && body.code === 'invalid_spec'
          ? 'invalid_spec'
          : body.code === 'path_traversal'
            ? 'path_traversal'
            : 'provider_error';
    throw new CloudRunnerError(`cloud gateway ${status}: ${body.error ?? 'unknown error'}`, code);
  }
}
