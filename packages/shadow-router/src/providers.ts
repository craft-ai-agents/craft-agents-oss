// Provider registry — resolves API keys and forwards OpenAI-compatible requests.

import type { ChatRequest, ProviderConfig, RouterConfig } from "./types.ts";

export interface ResolvedProvider extends ProviderConfig {
  name: string;
  apiKey: string | null;
  enabled: boolean;
}

/**
 * macOS Keychain fallback so secrets never live in env/argv/config.
 * No-op off darwin or if `security` is unavailable (e.g. the OCI/Linux host,
 * where the env var is the source of truth).
 */
function keychainLookup(service: string): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const out = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"]);
    if (out.exitCode !== 0) return null;
    const v = out.stdout.toString().trim();
    return v.length ? v : null;
  } catch {
    return null;
  }
}

/** Resolve a provider's key: env → Keychain (by the env-var name) → baked default. */
export function resolveProvider(
  name: string,
  cfg: ProviderConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedProvider {
  const allowKeychain = !env.SHADOW_ROUTER_NO_KEYCHAIN;
  let apiKey: string | null = null;
  if (cfg.apiKeyEnv) {
    apiKey =
      env[cfg.apiKeyEnv] ??
      (allowKeychain ? keychainLookup(cfg.apiKeyEnv) : null) ??
      cfg.apiKeyDefault ??
      null;
  } else {
    apiKey = cfg.apiKeyDefault ?? null;
  }
  // command lanes (web sessions) default OFF until explicitly enabled (adapter must exist).
  // openai lanes gated by enabledIfKey are dark until their key resolves.
  const enabled =
    cfg.type === "command" ? cfg.enabled === true : cfg.enabledIfKey ? Boolean(apiKey) : true;
  return { ...cfg, name, apiKey, enabled };
}

export function resolveAll(
  config: RouterConfig,
  env: Record<string, string | undefined> = process.env,
): Map<string, ResolvedProvider> {
  const m = new Map<string, ResolvedProvider>();
  for (const [name, cfg] of Object.entries(config.providers)) {
    m.set(name, resolveProvider(name, cfg, env));
  }
  return m;
}

/**
 * Drop sampling params a given model rejects. Claude (and other reasoning models)
 * 400 on `temperature`/`top_p` ("deprecated for this model"). Surfaced by the routing DOE.
 */
export function sanitizeBody(body: ChatRequest): ChatRequest {
  const m = String(body.model ?? "");
  if (/claude|opus|sonnet|haiku|thinking|reasoning/i.test(m)) {
    const { temperature, top_p, ...rest } = body as ChatRequest & { top_p?: unknown };
    return rest as ChatRequest;
  }
  return body;
}

/** True if a response is a quota/limit/rate error — the trigger to overflow to the next lane. */
export function isQuotaError(status: number, body: unknown): boolean {
  if (status === 429) return true;
  const msg = JSON.stringify(body ?? "").toLowerCase();
  return /quota|rate.?limit|exhaust|weekly limit|insufficient|too many requests|capacity/.test(msg);
}

/** Run a command-type provider: argv with request JSON on stdin → OpenAI JSON on stdout. */
async function forwardCommand(provider: ResolvedProvider, body: ChatRequest): Promise<Response> {
  const cmd = provider.command;
  if (!cmd || cmd.length === 0) {
    return new Response(JSON.stringify({ error: { message: `command provider ${provider.name} has no command` } }), { status: 503 });
  }
  try {
    const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    proc.stdin.write(JSON.stringify(body));
    await proc.stdin.end();
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      return new Response(JSON.stringify({ error: { message: `adapter exit ${code}: ${err.slice(0, 300)}` } }), { status: 502 });
    }
    return new Response(out, { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: `adapter failed: ${(e as Error).message}` } }), { status: 502 });
  }
}

/** Forward an OpenAI chat request to a provider. Returns the raw upstream Response (streaming passes through). */
export async function forward(
  provider: ResolvedProvider,
  body: ChatRequest,
  signal?: AbortSignal,
): Promise<Response> {
  body = sanitizeBody(body);
  if (provider.type === "command") return forwardCommand(provider, body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers["authorization"] = `Bearer ${provider.apiKey}`;
  // OpenRouter uses these for app attribution / rankings (optional but recommended).
  if (provider.name === "openrouter") {
    headers["http-referer"] = "https://shadowlab.cc";
    headers["x-title"] = "shadow-router";
  }
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
}

/** List models a provider advertises (best-effort; empty on failure). */
export async function listModels(provider: ResolvedProvider): Promise<string[]> {
  if (!provider.enabled) return [];
  // command lanes (web sessions) have no /models endpoint — use their static catalog,
  // which is how sub-exclusive models (gpt-5.5-pro, o3-pro) become selectable.
  if (provider.type === "command") return provider.models ?? [];
  try {
    const headers: Record<string, string> = {};
    if (provider.apiKey) headers["authorization"] = `Bearer ${provider.apiKey}`;
    const r = await fetch(`${provider.baseUrl}/models`, { headers });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: Array<{ id: string }> };
    return (j.data ?? []).map((d) => d.id);
  } catch {
    return [];
  }
}
