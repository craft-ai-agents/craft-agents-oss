#!/usr/bin/env bun
// Shadow unified gateway — one OpenAI-compatible endpoint over all lanes.

import { resolveAll, forward, listModels, isQuotaError, type ResolvedProvider } from "./providers.ts";
import { resolveModel } from "./router.ts";
import { runFusion } from "./fusion.ts";
import { checkAuth, resolveAuthKey } from "./auth.ts";
import type { ChatRequest, RouterConfig } from "./types.ts";

const CONFIG_PATH =
  process.env.SHADOW_ROUTER_CONFIG ??
  new URL("../config/shadow-router.config.json", import.meta.url).pathname;

const config = (await Bun.file(CONFIG_PATH).json()) as RouterConfig;
const providers = resolveAll(config);
const authKey = config.auth ? resolveAuthKey(config.auth) : null;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function handleChat(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return json({ error: { message: "invalid json body" } }, 400);
  }
  if (!body.model || !Array.isArray(body.messages)) {
    return json({ error: { message: "missing model or messages" } }, 400);
  }

  // Fusion virtual model: fan-out + synthesize, return a normal completion.
  const vm = config.virtualModels[body.model];
  if (vm?.strategy === "fusion") {
    try {
      const result = await runFusion(body, vm, config, providers);
      return json({
        id: `fusion-${Date.now()}`,
        object: "chat.completion",
        model: "fusion",
        choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: "stop" }],
        shadow_fusion: { members: result.members, dropped: result.dropped },
      });
    } catch (e) {
      return json({ error: { message: `fusion failed: ${(e as Error).message}` } }, 502);
    }
  }

  // Route to a concrete lane.
  const decision = resolveModel(body, config, providers);
  if (!decision.provider) {
    return json({ error: { message: `no route: ${decision.reason}`, shadow_route: decision } }, 503);
  }

  // Build the overflow chain: the chosen lane, then its quota fallbacks. This is how
  // subscription overflow works — Codex weekly-limited → chatgpt-web → openrouter.
  const chain: Array<{ provider: string; model: string }> = [{ provider: decision.provider, model: decision.model }];
  for (const spec of config.routing.fallbacks?.[decision.provider] ?? []) {
    const [p, ...m] = spec.split("/");
    chain.push({ provider: p, model: m.join("/") });
  }
  const usable = chain.filter((l) => providers.get(l.provider)?.enabled);
  if (usable.length === 0) return json({ error: { message: `provider ${decision.provider} unavailable` } }, 503);

  // Streaming: single-lane passthrough (can't re-stream after a quota error mid-flight).
  if (body.stream) {
    const prov = providers.get(usable[0].provider)!;
    const upstream = await forward(prov, { ...body, model: usable[0].model });
    const headers = new Headers(upstream.headers);
    headers.set("x-shadow-route", `${usable[0].provider}/${usable[0].model}`);
    headers.set("x-shadow-reason", decision.reason);
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // Non-streaming: walk the chain, overflowing only on quota/empty.
  let lastText = "{}", lastStatus = 502;
  for (let i = 0; i < usable.length; i++) {
    const lane = usable[i];
    const prov = providers.get(lane.provider)!;
    const upstream = await forward(prov, { ...body, model: lane.model, stream: false });
    lastText = await upstream.text();
    lastStatus = upstream.status;
    let parsed: any = {};
    try { parsed = JSON.parse(lastText); } catch { /* keep {} */ }
    const served = upstream.ok && Array.isArray(parsed.choices) && parsed.choices.length > 0;
    const overflow = isQuotaError(upstream.status, parsed) || (upstream.ok && !served);
    if (served) {
      return new Response(lastText, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-shadow-route": `${lane.provider}/${lane.model}`,
          "x-shadow-reason": decision.reason,
          "x-shadow-overflow": String(i), // 0 = primary served; >0 = how many lanes we overflowed past
        },
      });
    }
    if (!overflow) break; // real (non-quota) error — surface it, don't mask by falling back
  }
  return new Response(lastText, { status: lastStatus, headers: { "content-type": "application/json", "x-shadow-overflow": "exhausted" } });
}

async function handleModels(): Promise<Response> {
  const hidden = new Set(config.hiddenModels ?? []);
  const virtual = Object.keys(config.virtualModels).map((id) => ({ id, object: "model", owned_by: "shadow-router" }));
  const real = await Promise.all(
    [...providers.values()].map(async (p: ResolvedProvider) =>
      (await listModels(p))
        .filter((id) => !hidden.has(id)) // drop probe-vetted broken/deprecated lanes
        .map((id) => ({ id: `${p.name}/${id}`, object: "model", owned_by: p.name })),
    ),
  );
  return json({ object: "list", data: [...virtual, ...real.flat()] });
}

const server = Bun.serve({
  hostname: config.listen.host,
  port: config.listen.port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return json({
        ok: true,
        auth: config.auth?.required ? "required" : "off",
        providers: [...providers.values()].map((p) => ({ name: p.name, enabled: p.enabled, tier: p.privacyTier })),
      });
    }
    // Everything below /v1 requires auth (bearer + host allowlist).
    if (url.pathname.startsWith("/v1")) {
      const a = checkAuth(req, config.auth, authKey);
      if (!a.ok) return json({ error: { message: `unauthorized: ${a.reason}` } }, a.status);
    }
    if (url.pathname === "/v1/route" && req.method === "POST") {
      const body = (await req.json()) as ChatRequest;
      return json(resolveModel(body, config, providers));
    }
    if (url.pathname === "/v1/models") return handleModels();
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") return handleChat(req);
    return json({ error: { message: "not found" } }, 404);
  },
});

console.log(`shadow-router on http://${server.hostname}:${server.port}`);
console.log(`  providers: ${[...providers.values()].map((p) => `${p.name}${p.enabled ? "" : "(off)"}`).join(", ")}`);
console.log(`  virtual:   ${Object.keys(config.virtualModels).join(", ")}`);
