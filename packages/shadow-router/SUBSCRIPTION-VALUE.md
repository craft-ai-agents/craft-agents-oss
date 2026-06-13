# Subscription value extraction

The gateway's job is to wring maximum value from subscriptions you already pay for
and only spend metered money as a last resort. Two mechanisms make this work:
**privacy-safe lane preference** (route to the cheapest acceptable lane) and
**quota overflow** (when a subscription lane hits its limit, fall through to the
next lane — including the *web* surface of the same subscription, which has a
separate quota).

## Surfaces per subscription (this machine, 2026-06-13)

| Subscription | Surface in the gateway | Quota | Cost | Notes |
|---|---|---|---|---|
| **ChatGPT Pro / Codex** | `vibeproxy` (Codex OAuth) | weekly Codex limit | sub (free marginal) | primary GPT lane |
| ↳ same sub, web | `chatgpt-web` (command lane → chatgpt.com) | **separate** web quota + Pro-only models (o-series, gpt-5.5-pro) | sub | OVERFLOW when Codex limited; disabled until adapter validated |
| **Claude** | `vibeproxy` (Claude OAuth) | sub | sub | ~1.4–1.9k token system-prompt overhead per call (measured) |
| **Gemini** | `vibeproxy` (Gemini/Antigravity OAuth) | sub | sub | lean (~5 token overhead); 3-pro-high = best |
| **Z.AI GLM** | `vibeproxy` `zai` | flat coding plan | sub | excluded for sensitive content (trains, CN-backed) |
| **OpenRouter** | `openrouter` (BYOK) | metered | **$ per token** | 356 models incl `openai/gpt-5.5-pro`; last-resort breadth |
| **Local** | `ollama` | none | free | only lane for sensitive content |

No standalone OpenAI/Anthropic/Google API keys exist — those subscriptions are
reachable only through VibeProxy OAuth or (for ChatGPT) the web overflow lane.

## Overflow chains (`routing.fallbacks`)

On a quota/limit error (`isQuotaError`: 429, "weekly limit", "quota", "exhausted",
"insufficient", "capacity") the gateway retries the request on the next lane,
**non-streaming only**, tagging the winner with `x-shadow-overflow: N`.

```
GPT request → vibeproxy (Codex)  ──quota──▶  chatgpt-web (ChatGPT Pro web)  ──quota──▶  openrouter/openai/gpt-5.5-pro ($)
```

Default config wires `vibeproxy → chatgpt-web/gpt-5.5`. `chatgpt-web` is **disabled**
until its adapter is validated against a logged-in session, so the chain is currently
inert (safe). List **same-family** lanes only — the chain fires on any quota error
from the keyed provider.

## Enabling the chatgpt-web overflow lane

1. Make a dedicated Chrome profile dir and log into chatgpt.com once in it.
2. `bun add -d playwright && bunx playwright install chromium` (in this package).
3. Set `SHADOW_CHATGPT_PROFILE=<that userDataDir>` in the gateway's launchd env.
4. Flip `providers.chatgpt-web.enabled = true` (edit while the gateway restarts).
5. Validate: `echo '{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}' | SHADOW_CHATGPT_MOCK=1 bun run adapters/chatgpt-web/adapter.ts` (plumbing), then without the mock (live).

Selectors on chatgpt.com drift — the adapter (`adapters/chatgpt-web/adapter.ts`) is
best-effort and may need updating. It is a `command` provider: any future web session
(claude.ai, gemini) plugs in the same way.
