/**
 * Загрузчик артефактов toolchain.
 * fetch (с redirect-follow) -> downloads/partial, потоковый sha256, атомарный rename.
 * Retry x3 с backoff [5s, 30s, 2m] на все 5xx и сетевые сбои; 4xx — сразу ошибка.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** sha256 артефакта не совпал с манифестом: partial удалён, ретрай — следующим ensureAll. */
export class ShaMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`sha256 mismatch: expected ${expected}, got ${actual}`);
    this.name = 'ShaMismatchError';
  }
}

/** HTTP-ошибка ответа (4xx/5xx после исчерпания ретраев). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

/** Сетевой сбой до получения HTTP-ответа (DNS, TCP, TLS…): трактуем как offline. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(`network failure: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;

export interface DownloadOptions {
  url: string;
  /** Куда положить готовый файл (пишется в <dest>.partial и переименовывается). */
  dest: string;
  /** Ожидаемый sha256 в hex (lowercase). */
  sha256: string;
  /** Ожидаемый размер — для прогресса, если сервер не отдал Content-Length. */
  size?: number;
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void;
  /** DI-швы для тестов. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

async function cleanupPartial(partialPath: string): Promise<void> {
  await fs.promises.rm(partialPath, { force: true });
}

/**
 * Один заход на скачивание (без ретраев). Бросает NetworkError/HttpError/ShaMismatchError.
 * Partial-файл удаляется при любой ошибке.
 */
async function downloadOnce(opts: DownloadOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const partialPath = `${opts.dest}.partial`;

  let response: Response;
  try {
    // redirect: 'follow' — дефолт fetch, указываем явно для читаемости контракта
    response = await fetchImpl(opts.url, { redirect: 'follow' });
  } catch (cause) {
    await cleanupPartial(partialPath);
    throw new NetworkError(cause);
  }
  if (!response.ok) {
    await cleanupPartial(partialPath);
    throw new HttpError(response.status, opts.url);
  }
  if (!response.body) {
    await cleanupPartial(partialPath);
    throw new Error(`empty body for ${opts.url}`);
  }

  await fs.promises.mkdir(path.dirname(partialPath), { recursive: true });

  const hash = createHash('sha256');
  const file = fs.createWriteStream(partialPath);
  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : opts.size;
  let downloaded = 0;

  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      downloaded += value.byteLength;
      opts.onProgress?.(downloaded, total);
      if (!file.write(value)) {
        await new Promise<void>((resolve, reject) => {
          // Каждый drain-цикл не должен оставлять висеть 'error'-слушатель
          // (мешай слушателей при больших артефактах → MaxListenersExceededWarning).
          const onError = (err: Error) => reject(err);
          file.once('error', onError);
          file.once('drain', () => {
            file.off('error', onError);
            resolve();
          });
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      file.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (cause) {
    file.destroy();
    await cleanupPartial(partialPath);
    if (cause instanceof NetworkError) throw cause;
    throw new NetworkError(cause);
  }

  const actual = hash.digest('hex');
  if (actual !== opts.sha256.toLowerCase()) {
    await cleanupPartial(partialPath);
    throw new ShaMismatchError(opts.sha256.toLowerCase(), actual);
  }

  await fs.promises.mkdir(path.dirname(opts.dest), { recursive: true });
  await fs.promises.rename(partialPath, opts.dest);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return error instanceof HttpError && error.status >= 500;
}

/**
 * Скачать артефакт с ретраями. Возвращает путь готового файла (opts.dest).
 * ShaMismatchError не ретраится — битый артефакт не вылечится повторной скачкой.
 */
export async function downloadArtifact(opts: DownloadOptions): Promise<string> {
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // attempts = 1 + delays.length (первая попытка + по ретраю на каждый backoff)
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await downloadOnce(opts);
      return opts.dest;
    } catch (error) {
      lastError = error;
      if (error instanceof ShaMismatchError || !isRetryable(error)) throw error;
      if (attempt < delays.length) await sleep(delays[attempt]!);
    }
  }
  throw lastError;
}
