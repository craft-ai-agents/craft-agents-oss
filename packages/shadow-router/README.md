# @shadow/router — Shadow unified gateway

One OpenAI-compatible endpoint over every lane you already pay for: VibeProxy
subscriptions (Claude / Codex / Gemini / Antigravity + Z.AI), OpenRouter (BYOK,
356-model catalog), local Ollama, with **tri-harness privacy routing** and
**local fusion** (OpenRouter-Fusion style) on top.

It does *not* replace [VibeProxy](../../../) — VibeProxy already multiplexes your
OAuth subscriptions into one OpenAI API. This layer adds the two things VibeProxy
doesn't do — **routing** and **fusion** — and aggregates the other providers.

```
clients (Craft / Cursor / CLI / mesh)
        │  OpenAI /v1/chat/completions
        ▼
   shadow-router  ──┬─ tri-harness router (privacy · cost · jurisdiction)
                    ├─ virtual models: auto · private · fusion
                    └─ fusion synthesis (fan-out N → fuse)
        │
        ├─→ VibeProxy 8319   (BYOM — your subscriptions)
        ├─→ OpenRouter        (BYOK — your keys + catalog)   [dark until OPENROUTER_API_KEY]
        └─→ Ollama            (local — the only lane for sensitive content)
```

## Run

```bash
bun run start            # listens on 127.0.0.1:8787
bun test                 # unit tests (privacy + routing, no network)
curl localhost:8787/healthz
```

Point any OpenAI client at `http://127.0.0.1:8787/v1` with any bearer token.

## Virtual models

| model | behaviour |
|-------|-----------|
| `auto` | router picks the cheapest **privacy-safe** lane for the request (task + content category) |
| `private` | forces a `local_only` lane (Ollama) regardless of content |
| `fusion` | fans out to diverse lanes, synthesizes the best answer; privacy-gated members |

Concrete ids pass through: `gpt-5.5`, `claude-opus-4-7`, or `provider/model`
(`vibeproxy/claude-sonnet-4-6`). An explicit pick that violates the content's
privacy floor is **redirected to `auto`** — it never leaks.

## Privacy floor (tri-harness)

Mirrors `system/controls/tri-harness-routing.json`. Sensitive content
(health / financial / identity, detected by `privacy.ts`) may only route to lanes
that are `never_trains`/`local_only`, `piiSafe`, and **non-CN** jurisdiction. The
Z.AI / GLM lane (`trains_no_opt_out`, SG/CN-backed) is auto-excluded for sensitive
content. Every client gets this — not just Craft.

## Config

`config/shadow-router.config.json` (override path with `SHADOW_ROUTER_CONFIG`):
providers (baseUrl, key env, privacy metadata), virtual models, and the
task→lane table. OpenRouter is gated by `enabledIfKey` — it stays dark until
`OPENROUTER_API_KEY` is present, then Phase 2 lights up automatically.

Provider keys come from env: `VIBEPROXY_KEY` (default `vibe-factory-local-2026`),
`OPENROUTER_API_KEY` (you set this).

## Endpoints

- `POST /v1/chat/completions` — OpenAI chat (streaming passes through; response
  carries `x-shadow-route` + `x-shadow-reason` trace headers)
- `GET  /v1/models` — virtual models + every enabled provider's catalog (`provider/id`)
- `POST /v1/route` — debug: returns the routing decision without calling upstream
- `GET  /healthz` — provider enablement + privacy tiers

## Phase status

- [x] **Phase 1** — gateway core, tri-harness routing, `auto`/`private`, fusion, OR-ready
- [x] **Phase 2** — OpenRouter BYOK live (env → Keychain key resolution); OR + fusion verified end-to-end
- [x] **Auth** — bearer key (env → Keychain `SHADOW_ROUTER_KEY`) + anti-DNS-rebinding host allowlist on `/v1/*`
- [x] **Run** — persistent via launchd `com.shadow.shadow-router` (127.0.0.1:8787)
- [x] **Phase 4** — `shadow-router` connection in Craft (default `auto`); dead 8318 lane disabled.
      One-time: validate the connection's key in Craft Settings → AI → Connections (same quirk as any CLI-added key).
- [x] **Phase 6** — routing DOE harness (`doe/run-doe.ts`): strategy × temp × eval-set → PI
      (quality·latency·cost), LLM-judge, factory-compatible `doe-results.jsonl`. Drove a real
      gateway fix (param sanitization for Claude lanes). PI ranking still **preliminary** — judge
      reliability needs a hardened full run before acting on weights.
- [ ] **Phase 3** — fusion tuning (diverse-pool selection, cost caps)
- [ ] **Phase 5** — global on sentry (OCI) via `tailscale serve` (TLS + tailnet identity, ACL `tag:devices`)

### Routing DOE

```bash
bun run doe/run-doe.ts --strategies auto,fusion,vibeproxy/gpt-5.5 --temps 0 --out /tmp/doe.jsonl
```

Each cell calls the gateway, the judge scores against a rubric, PI =
`0.6·quality + 0.25·(1/latency) + 0.15·(1/cost)`. Errored generations and
unparseable judge verdicts are excluded (never scored 0). Pilot finding: Claude
thinking lanes 400 on `temperature` → now stripped in `forward()`.
