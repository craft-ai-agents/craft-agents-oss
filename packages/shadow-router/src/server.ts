#!/usr/bin/env bun
// Shadow unified gateway — one OpenAI-compatible endpoint over all lanes.

import { resolveAll, forward, listModels, type ResolvedProvider } from "./providers.ts";
import { resolveModel } from "./router.ts";
import { runFusion } from "./fusion.ts";
import type { ChatRequest, RouterConfig } from "./types.ts";

const CONFIG_PATH =
  process.env.SHADOW_ROUTER_CONFIG ??
  new URL("../config/shadow-router.config.json", import.meta.url).pathname;

const config = (await Bun.file(CONFIG_PATH).json()) as RouterConfig;
const providers = resolveAll(config);

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
  const provider = providers.get(decision.provider);
  if (!provider || !provider.enabled) {
    return json({ error: { message: `provider ${decision.provider} unavailable` } }, 503);
  }

  const upstream = await forward(provider, { ...body, model: decision.model });
  // Pass through (streaming SSE or JSON) with a header trace of the routing decision.
  const headers = new Headers(upstream.headers);
  headers.set("x-shadow-route", `${decision.provider}/${decision.model}`);
  headers.set("x-shadow-reason", decision.reason);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function handleModels(): Promise<Response> {
  const virtual = Object.keys(config.virtualModels).map((id) => ({ id, object: "model", owned_by: "shadow-router" }));
  const real = await Promise.all(
    [...providers.values()].map(async (p: ResolvedProvider) =>
      (await listModels(p)).map((id) => ({ id: `${p.name}/${id}`, object: "model", owned_by: p.name })),
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
        providers: [...providers.values()].map((p) => ({ name: p.name, enabled: p.enabled, tier: p.privacyTier })),
      });
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
