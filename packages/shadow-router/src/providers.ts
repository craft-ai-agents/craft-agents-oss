// Provider registry — resolves API keys and forwards OpenAI-compatible requests.

import type { ChatRequest, ProviderConfig, RouterConfig } from "./types.ts";

export interface ResolvedProvider extends ProviderConfig {
  name: string;
  apiKey: string | null;
  enabled: boolean;
}

/** Resolve a provider's key from env (falling back to a baked default), and decide if it's enabled. */
export function resolveProvider(
  name: string,
  cfg: ProviderConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedProvider {
  const apiKey = cfg.apiKeyEnv ? (env[cfg.apiKeyEnv] ?? cfg.apiKeyDefault ?? null) : (cfg.apiKeyDefault ?? null);
  // A provider gated by `enabledIfKey` is dark until its key is present.
  const enabled = cfg.enabledIfKey ? Boolean(apiKey) : true;
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

/** Forward an OpenAI chat request to a provider. Returns the raw upstream Response (streaming passes through). */
export async function forward(
  provider: ResolvedProvider,
  body: ChatRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers["authorization"] = `Bearer ${provider.apiKey}`;
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
