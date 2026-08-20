import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  downloadArtifact,
  HttpError,
  NetworkError,
  ShaMismatchError,
} from '../downloader';

const FIXTURES = path.join(import.meta.dir, 'fixtures');
const RAW_FIXTURE = path.join(FIXTURES, 'demo-raw.bin');
const RAW_SHA256 = '8d9e1cca2886be54ebfcb25cb0c4c8a35f7d692e1017ea16dd34a6fe0a75bb58';

let tmpDir: string;
let server: Bun.Server<undefined>;
let hits = 0;
let failFirstN = 0;
let body = fs.readFileSync(RAW_FIXTURE);

const sleepNoop = () => Promise.resolve();

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dl-'));
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch() {
      hits++;
      if (failFirstN > 0) {
        failFirstN--;
        return new Response('boom', { status: 500 });
      }
      return new Response(body, { headers: { 'content-length': String(body.byteLength) } });
    },
  });
});

afterAll(() => {
  server.stop(true);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function url(): string {
  return `http://127.0.0.1:${server.port}/artifact`;
}

describe('downloader (localhost http server)', () => {
  it('happy path: скачивает, верифицирует sha256, атомарно кладёт файл', async () => {
    const dest = path.join(tmpDir, 'ok.bin');
    const progress: Array<[number, number | undefined]> = [];
    await downloadArtifact({
      url: url(),
      dest,
      sha256: RAW_SHA256,
      size: body.byteLength,
      onProgress: (d, t) => progress.push([d, t]),
      retryDelaysMs: [1, 1, 1],
      sleepImpl: sleepNoop,
    });
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)![0]).toBe(body.byteLength);
    expect(progress.at(-1)![1]).toBe(body.byteLength);
  });

  it('retry на 5xx с backoff, затем успех', async () => {
    hits = 0;
    failFirstN = 2;
    const dest = path.join(tmpDir, 'retry.bin');
    await downloadArtifact({
      url: url(),
      dest,
      sha256: RAW_SHA256,
      retryDelaysMs: [1, 1, 1],
      sleepImpl: sleepNoop,
    });
    expect(hits).toBe(3);
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('sha256 mismatch: partial удаляется, бросает ShaMismatchError без ретраев', async () => {
    const realBody = body;
    body = Buffer.from('tampered');
    const dest = path.join(tmpDir, 'tampered.bin');
    hits = 0;
    try {
      await expect(
        downloadArtifact({
          url: url(),
          dest,
          sha256: RAW_SHA256,
          retryDelaysMs: [1, 1, 1],
          sleepImpl: sleepNoop,
        }),
      ).rejects.toBeInstanceOf(ShaMismatchError);
      expect(hits).toBe(1); // без ретраев
      expect(fs.existsSync(dest)).toBe(false);
      expect(fs.existsSync(`${dest}.partial`)).toBe(false);
    } finally {
      body = realBody;
    }
  });

  it('исчерпание ретраев на 5xx -> HttpError', async () => {
    failFirstN = 10;
    hits = 0;
    const dest = path.join(tmpDir, 'dead.bin');
    await expect(
      downloadArtifact({ url: url(), dest, sha256: RAW_SHA256, retryDelaysMs: [1, 1], sleepImpl: sleepNoop }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(hits).toBe(3);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('сетевой сбой -> NetworkError', async () => {
    const dest = path.join(tmpDir, 'offline.bin');
    // A port that is guaranteed closed: bind an ephemeral TCP server, read its
    // port, then stop it. Hard-coding 127.0.0.1:1 races with anything actually
    // listening there (in the full suite another test's server won that race
    // and answered 404 instead of refusing the connection).
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('x') });
    const deadPort = probe.port;
    probe.stop(true);
    await expect(
      downloadArtifact({
        url: `http://127.0.0.1:${deadPort}/unreachable`,
        dest,
        sha256: RAW_SHA256,
        retryDelaysMs: [1],
        sleepImpl: sleepNoop,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
  });
});
