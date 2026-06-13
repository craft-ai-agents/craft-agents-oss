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

## Access to sub-exclusive models (not just overflow)

The bigger value: chatgpt.com web reaches models the API/OAuth lane **cannot** —
`gpt-5.5-pro`, `o3-pro`, `gpt-5.5-thinking` — at **zero metered cost** (they're in the
Pro sub). The gateway advertises them as first-class lanes via the command provider's
static `models` list, so any client can pick `chatgpt-web/gpt-5.5-pro` directly. The
adapter selects that model in the web UI. Same models via OpenRouter would be metered;
here they're free with the sub.

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

## gpt-5.5-pro RIGHT NOW (metered)

`openrouter/openai/gpt-5.5-pro` routes through the gateway today — verified (OpenAI
served `gpt-5.5-pro-20260423`). Metered (OR credits); reliable; no browser. Use this
for Pro models until the free web lane is activated.

## Enabling the chatgpt-web lane (free Pro models)

**Preferred — CDP to your real Chrome** (human session, passes chatgpt.com anti-bot; a fresh
Playwright Chrome gets blocked):
1. `bash adapters/chatgpt-web/cdp-launch.sh` — relaunches your Chrome with `--remote-debugging-port=9222` (tabs preserved).
2. Be logged into chatgpt.com in that Chrome.
3. Set `SHADOW_CHATGPT_CDP=http://127.0.0.1:9222` in the gateway launchd env, flip `providers.chatgpt-web.enabled=true`, restart the gateway.
4. The adapter drives your real session and selects the requested model (gpt-5.5-pro, o3-pro).

Fallback — dedicated profile (`SHADOW_CHATGPT_PROFILE` + `auth-setup.ts`): only works if anti-bot lets the automated browser through (often it doesn't).

Selectors on chatgpt.com drift — the adapter (`adapters/chatgpt-web/adapter.ts`) is
best-effort and may need updating. It is a `command` provider: any future web session
(claude.ai, gemini) plugs in the same way.
