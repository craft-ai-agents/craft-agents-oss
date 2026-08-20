// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.
import crypto from "node:crypto";

import { loadConfigBotAgent, loadConfigRouteTag } from "../auth/accounts";
import { logger } from "../util/logger";
import { redactBody, redactUrl } from "../util/redact";

import type {
  BaseInfo,
  GetUploadUrlReq,
  GetUploadUrlResp,
  GetUpdatesReq,
  GetUpdatesResp,
  NotifyStopResp,
  NotifyStartResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
  GetConfigResp,
} from "./types";

export type WeixinApiOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  /** Long-poll timeout for getUpdates (server may hold the request up to this). */
  longPollTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// BaseInfo — attached to every outgoing CGI request
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT). Upstream reads
// these from its own package.json via a walk-up search; here they are pinned
// to the ported snapshot. iLink-App-Id is the generic "bot" app id used by the
// official WeChat ClawBot channel (not OpenClaw-specific), and bot_agent is an
// honest CraftAgent identifier (observability only per the upstream protocol
// docs — not used for authentication or routing).
// ---------------------------------------------------------------------------

/** Ported snapshot version; encoded into iLink-App-ClientVersion. */
const CHANNEL_VERSION = "2.4.4";

/** iLink-App-Id: generic "bot" app id. */
const ILINK_APP_ID = "bot";

/**
 * iLink-App-ClientVersion: uint32 encoded as 0x00MMNNPP
 * High 8 bits fixed to 0; remaining bits: major<<16 | minor<<8 | patch.
 */
function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

const ILINK_APP_CLIENT_VERSION: number = buildClientVersion(CHANNEL_VERSION);

/** Default `bot_agent` when no override is configured (honest UA). */
const DEFAULT_BOT_AGENT = "CraftAgent/0.9.6";

/** Maximum length (bytes) of the sanitized `bot_agent` string. */
const BOT_AGENT_MAX_LEN = 256;

/**
 * Sanitize a user-supplied `botAgent` config value into a wire-safe string.
 *
 * Grammar (UA-style):
 *   bot_agent = product *( SP product )
 *   product   = name "/" version [ SP "(" comment ")" ]
 *   name      = 1*32( ALPHA / DIGIT / "_" / "." / "-" )
 *   version   = 1*32( ALPHA / DIGIT / "_" / "." / "+" / "-" )
 *   comment   = 1*64( printable ASCII minus "(" ")" )
 *
 * Tokens that fail to parse are dropped silently (no partial tokens kept).
 * Returns `DEFAULT_BOT_AGENT` when the input is empty / all tokens dropped /
 * the result exceeds the length cap after truncation.
 */
export function sanitizeBotAgent(raw: string | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_BOT_AGENT;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_BOT_AGENT;

  const productRe = /^[A-Za-z0-9_.\-]{1,32}\/[A-Za-z0-9_.+\-]{1,32}$/;
  const commentCharRe = /^[\x20-\x27\x2A-\x7E]{1,64}$/;

  // Tokenize on whitespace, but keep `(comment)` glued to the preceding product.
  // Strategy: split by spaces, then re-attach any token that starts with "(".
  const rawTokens = trimmed.split(/\s+/);
  const tokens: string[] = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    const tok = rawTokens[i];
    if (tok === undefined) continue;
    if (tok.startsWith("(") && !tok.endsWith(")")) {
      // Multi-word comment; greedily collect until we find the closing ")".
      let acc = tok;
      while (i + 1 < rawTokens.length && !acc.endsWith(")")) {
        i += 1;
        acc += " " + (rawTokens[i] ?? "");
      }
      tokens.push(acc);
    } else {
      tokens.push(tok);
    }
  }

  const accepted: string[] = [];
  let pendingProduct: string | null = null;
  for (const tok of tokens) {
    if (tok.startsWith("(") && tok.endsWith(")")) {
      const inner = tok.slice(1, -1);
      if (pendingProduct && commentCharRe.test(inner)) {
        accepted.push(`${pendingProduct} (${inner})`);
        pendingProduct = null;
      } else {
        if (pendingProduct) {
          accepted.push(pendingProduct);
          pendingProduct = null;
        }
      }
      continue;
    }
    if (pendingProduct) {
      accepted.push(pendingProduct);
      pendingProduct = null;
    }
    if (productRe.test(tok)) {
      pendingProduct = tok;
    }
  }
  if (pendingProduct) accepted.push(pendingProduct);

  if (accepted.length === 0) return DEFAULT_BOT_AGENT;

  const joined = accepted.join(" ");
  if (Buffer.byteLength(joined, "utf-8") <= BOT_AGENT_MAX_LEN) return joined;

  // Truncate by dropping trailing tokens until under the cap.
  const truncated: string[] = [];
  let len = 0;
  for (const t of accepted) {
    const add = (truncated.length === 0 ? 0 : 1) + Buffer.byteLength(t, "utf-8");
    if (len + add > BOT_AGENT_MAX_LEN) break;
    truncated.push(t);
    len += add;
  }
  return truncated.length > 0 ? truncated.join(" ") : DEFAULT_BOT_AGENT;
}

/** Build the `base_info` payload included in every API request. */
export function buildBaseInfo(): BaseInfo {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: sanitizeBotAgent(loadConfigBotAgent()),
  };
}

/** Default timeout for long-poll getUpdates requests. */
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
/** Default timeout for regular API requests (sendMessage, getUploadUrl). */
const DEFAULT_API_TIMEOUT_MS = 15_000;
/** Default timeout for lightweight API requests (getConfig, sendTyping). */
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** X-WECHAT-UIN header: random uint32 -> decimal string -> base64. */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

/** Build headers shared by both GET and POST requests. */
function buildCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
  const routeTag = loadConfigRouteTag();
  if (routeTag) {
    headers.SKRouteTag = routeTag;
  }
  return headers;
}

function buildHeaders(opts: { token?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  logger.debug(
    `requestHeaders: ${JSON.stringify({ ...headers, Authorization: headers.Authorization ? "Bearer ***" : undefined })}`,
  );
  return headers;
}

/**
 * GET fetch wrapper: send a GET request to a Weixin API endpoint.
 * When `timeoutMs` is set, the request is aborted after that many milliseconds.
 * Query parameters should already be encoded in `endpoint`.
 * Returns the raw response text on success; throws on HTTP error or (if used) timeout abort.
 */
export async function apiGetFetch(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs?: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildCommonHeaders();
  logger.debug(`GET ${redactUrl(url.toString())}`);

  const timeoutMs = params.timeoutMs;
  const controller =
    timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
  const t =
    controller != null && timeoutMs != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: hdrs,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (t !== undefined) clearTimeout(t);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    if (t !== undefined) clearTimeout(t);
    throw err;
  }
}

/**
 * Combine an internal timeout controller with an optional external abort signal.
 * This lets gateway channel-stop aborts cancel in-flight long-poll requests
 * immediately while preserving the existing timeout-driven AbortError path.
 */
function combineAbortSignals(params: {
  internal?: AbortController;
  external?: AbortSignal;
}): { signal?: AbortSignal; cleanup: () => void } {
  const { internal, external } = params;
  if (!external) {
    return { signal: internal?.signal, cleanup: () => {} };
  }
  if (!internal) {
    return { signal: external, cleanup: () => {} };
  }
  if (external.aborted) {
    internal.abort();
    return { signal: internal.signal, cleanup: () => {} };
  }
  const onExternalAbort = () => internal.abort();
  external.addEventListener("abort", onExternalAbort, { once: true });
  return {
    signal: internal.signal,
    cleanup: () => external.removeEventListener("abort", onExternalAbort),
  };
}

/**
 * Common fetch wrapper: POST JSON to a Weixin API endpoint.
 * When `timeoutMs` is provided, the request is aborted after that many milliseconds.
 * When omitted, no client-side timeout is applied (relies on OS/TCP stack).
 * Returns the raw response text on success; throws on HTTP error or timeout.
 *
 * When `abortSignal` is provided, an external abort (e.g. gateway channel stop)
 * cancels the in-flight request immediately instead of waiting for `timeoutMs`.
 */
export async function apiPostFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs?: number;
  label: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders({ token: params.token });
  logger.debug(`POST ${redactUrl(url.toString())} body=${redactBody(params.body)}`);

  const controller =
    params.timeoutMs !== undefined ? new AbortController() : undefined;
  const t =
    controller != null && params.timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), params.timeoutMs)
      : undefined;
  const { signal, cleanup } = combineAbortSignals({
    internal: controller,
    external: params.abortSignal,
  });
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: params.body,
      ...(signal ? { signal } : {}),
    });
    if (t !== undefined) clearTimeout(t);
    const rawText = await res.text();
    logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    if (t !== undefined) clearTimeout(t);
    throw err;
  } finally {
    cleanup();
  }
}

/**
 * Long-poll getUpdates. Server should hold the request until new messages or timeout.
 *
 * On client-side timeout (no server response within timeoutMs), returns an empty response
 * with ret=0 so the caller can simply retry. This is normal for long-poll.
 */
export async function getUpdates(
  params: GetUpdatesReq & {
    baseUrl: string;
    token?: string;
    timeoutMs?: number;
    /**
     * Optional external abort signal from the gateway. When stopping the channel,
     * this aborts the in-flight long-poll immediately so hot reload can restart.
     */
    abortSignal?: AbortSignal;
  },
): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? "",
        base_info: buildBaseInfo(),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: "getUpdates",
      abortSignal: params.abortSignal,
    });
    const resp: GetUpdatesResp = JSON.parse(rawText);
    return resp;
  } catch (err) {
    // Long-poll timeout or external abort are both normal control-flow exits.
    // The monitor loop checks abortSignal after return and exits when needed.
    if (err instanceof Error && err.name === "AbortError") {
      if (params.abortSignal?.aborted) {
        logger.debug(`getUpdates: aborted by external signal`);
      } else {
        logger.debug(`getUpdates: client-side timeout after ${timeout}ms, returning empty response`);
      }
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
    }
    throw err;
  }
}

/** Get a pre-signed CDN upload URL for a file. */
export async function getUploadUrl(
  params: GetUploadUrlReq & WeixinApiOptions,
): Promise<GetUploadUrlResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "getUploadUrl",
  });
  const resp: GetUploadUrlResp = JSON.parse(rawText);
  return resp;
}

/**
 * Send a single message downstream.
 *
 * The sendmessage endpoint returns HTTP 200 even when it rejects the reply
 * (e.g. an expired context_token / closed turn) — the user then sees WeChat's
 * own "请稍后再试。" fallback instead of the bot's message. The real status is
 * carried in the response body's ret/errcode, so a non-zero code is surfaced
 * as a thrown error rather than a silent success; otherwise the dropped reply
 * is invisible. Mirrors the inbound getUpdates handling in monitor.ts.
 */
export async function sendMessage(
  params: WeixinApiOptions & { body: SendMessageReq },
): Promise<void> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage",
  });
  const resp = parseSendMessageResp(rawText);
  // Log every send outcome (state 1=GENERATING keep-alive, 2=FINISH final) so a
  // turn that the server still rejects/times-out is diagnosable: the timestamp
  // gives latency-since-inbound and ret/errcode give the server's verdict.
  const msg = params.body.msg;
  logger.info(
    `sendMessage outcome: state=${msg?.message_state} clientId=${msg?.client_id} ` +
      `hasContextToken=${Boolean(msg?.context_token)} ret=${resp?.ret ?? 0} ` +
      `errcode=${resp?.errcode ?? 0}${resp?.errmsg ? ` errmsg=${resp.errmsg}` : ""} ` +
      `raw=${redactBody(rawText).slice(0, 160)}`,
  );
  if (
    resp &&
    ((resp.ret !== undefined && resp.ret !== 0) ||
      (resp.errcode !== undefined && resp.errcode !== 0))
  ) {
    throw new Error(
      `sendMessage rejected by server: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`,
    );
  }
}

/**
 * Parse a sendMessage response body. The endpoint returns an empty body / `{}`
 * on success and `{ret,errcode,errmsg}` on rejection. Returns null when the
 * body is empty or not JSON, which is treated as success so an unexpected but
 * benign body never fails a send the server actually accepted.
 */
function parseSendMessageResp(rawText: string): SendMessageResp | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as SendMessageResp;
  } catch {
    logger.debug(`sendMessage: non-JSON response body: ${redactBody(rawText)}`);
    return null;
  }
}

/** Fetch bot config (includes typing_ticket) for a given user. */
export async function getConfig(
  params: WeixinApiOptions & { ilinkUserId: string; contextToken?: string },
): Promise<GetConfigResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: params.ilinkUserId,
      context_token: params.contextToken,
      base_info: buildBaseInfo(),
    }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "getConfig",
  });
  const resp: GetConfigResp = JSON.parse(rawText);
  return resp;
}

/** Send a typing indicator to a user. */
export async function sendTyping(
  params: WeixinApiOptions & { body: SendTypingReq },
): Promise<void> {
  await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({ ...params.body, base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "sendTyping",
  });
}

/**
 * Notify Weixin that this channel client is stopping (gateway shutdown / channel stop).
 * Uses a standalone timeout (not the gateway abort signal) so the request can finish
 * after OpenClaw has already aborted the long-poll.
 */
export async function notifyStop(params: WeixinApiOptions): Promise<NotifyStopResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/msg/notifystop",
    body: JSON.stringify({ base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "notifyStop",
  });
  return JSON.parse(rawText) as NotifyStopResp;
}

/**
 * Notify Weixin that this channel client is starting (gateway startup / channel start).
 */
export async function notifyStart(params: WeixinApiOptions): Promise<NotifyStartResp> {
  const rawText = await apiPostFetch({
    baseUrl: params.baseUrl,
    endpoint: "ilink/bot/msg/notifystart",
    body: JSON.stringify({ base_info: buildBaseInfo() }),
    token: params.token,
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
    label: "notifyStart",
  });
  return JSON.parse(rawText) as NotifyStartResp;
}
