#!/usr/bin/env bun
// chatgpt-web adapter — a command-provider lane for the shadow-router gateway.
//
// Contract: read one OpenAI chat-completions request on stdin, write one OpenAI
// chat.completion JSON on stdout. The gateway treats this like any other lane.
//
// Purpose: extract overflow value from the ChatGPT Pro WEB subscription (chatgpt.com)
// — a quota SEPARATE from the Codex API, plus Pro-only models — by driving a logged-in
// browser session. Used as a fallback when the Codex/VibeProxy GPT lane hits weekly limits.
//
// Modes:
//   SHADOW_CHATGPT_MOCK=1     → canned response (validates gateway plumbing, no browser).
//   else                      → headless chatgpt.com via Playwright persistent context.
//                               Requires SHADOW_CHATGPT_PROFILE = a userDataDir whose Chrome
//                               profile is already logged into chatgpt.com. Selectors may drift.

interface Msg { role: string; content: string }

const raw = await Bun.stdin.text();
let req: { model?: string; messages?: Msg[] } = {};
try { req = JSON.parse(raw); } catch { /* empty */ }
const messages = req.messages ?? [];
const prompt = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
const model = req.model || "gpt-5.5";
const stamp = Number(process.env.SHADOW_NOW ?? "0") || 0;

function emit(content: string, servedModel: string = model): void {
  process.stdout.write(JSON.stringify({
    id: `chatgpt-web-${stamp}`,
    object: "chat.completion",
    model: servedModel,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: 0 },
    shadow_lane: "chatgpt-web",
  }));
}
function fail(message: string, code = 1): never {
  process.stdout.write(JSON.stringify({ error: { message, type: "adapter_error" } }));
  process.exit(code);
}

if (process.env.SHADOW_CHATGPT_MOCK) {
  emit(`[mock chatgpt-web · ${model}] ${prompt.slice(0, 240)}`);
  process.exit(0);
}

// ── Real lane: drive chatgpt.com in a logged-in browser ──────────────────────────────
// Preferred: connect to your REAL Chrome over CDP (SHADOW_CHATGPT_CDP, e.g.
// http://127.0.0.1:9222). Your real session is human-looking and passes chatgpt.com's
// anti-bot — a fresh Playwright-launched Chrome gets blocked. Fallback: a dedicated
// persistent profile (SHADOW_CHATGPT_PROFILE) — works only if anti-bot lets it through.
const cdp = process.env.SHADOW_CHATGPT_CDP;
const profile = process.env.SHADOW_CHATGPT_PROFILE;
if (!cdp && !profile) {
  fail("chatgpt-web not configured: set SHADOW_CHATGPT_CDP (connect to your logged-in Chrome — start it with --remote-debugging-port=9222) or SHADOW_CHATGPT_PROFILE (dedicated profile). Or SHADOW_CHATGPT_MOCK=1 to test plumbing.");
}

let chromium: any;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("playwright not installed for chatgpt-web. `bun add -d playwright`, then connect via CDP or a logged-in profile.");
}

let ctx: any, ownsBrowser = false;
try {
  if (cdp) {
    const browser = await chromium.connectOverCDP(cdp);
    ctx = browser.contexts()[0] ?? (await browser.newContext());
  } else {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: process.env.SHADOW_CHATGPT_HEADLESS === "1",
      channel: "chrome",
      viewport: { width: 1280, height: 900 },
    });
    ownsBrowser = true;
  }

  // Reuse an existing chatgpt.com tab if one is open; else open one.
  let page = ctx.pages().find((p: any) => /chatgpt\.com|chat\.openai\.com/.test(p.url()));
  if (!page) {
    page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  }

  // Auth check — if redirected to login, the session isn't authenticated.
  if (/auth|login/.test(page.url())) {
    if (ownsBrowser) await ctx.close();
    fail("chatgpt.com not authenticated — log into chatgpt.com in that Chrome, then retry.");
  }

  // Select the requested model in the web UI — this is what unlocks sub-exclusive
  // models (gpt-5.5-pro, o3-pro) that the API/OAuth lane can't reach. Best-effort:
  // open the model switcher, click the matching menu item. Selectors drift — on
  // failure we proceed with whatever model is active and tag it.
  let selectedModel = model;
  try {
    const want = model.toLowerCase().replace(/[-_\s]+/g, " ").replace(/^gpt /, "gpt-"); // "gpt-5.5-pro" → "gpt-5.5 pro"
    const switcher = page.locator("button[data-testid='model-switcher-dropdown-button'], button[aria-label*='model' i]").first();
    await switcher.click({ timeout: 8000 });
    const item = page.getByRole("menuitemradio", { name: new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
      .or(page.getByRole("menuitem", { name: new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })).first();
    await item.click({ timeout: 8000 });
  } catch {
    selectedModel = `${model}?active`; // couldn't confirm selection
    await page.keyboard.press("Escape").catch(() => {});
  }

  const box = page.locator("#prompt-textarea, textarea[data-id], div[contenteditable='true']").first();
  await box.waitFor({ timeout: 30000 });
  await box.click();
  await page.keyboard.insertText(prompt);
  await page.keyboard.press("Enter");

  // Wait for a complete assistant turn: the send/stop button returns to idle.
  await page.waitForTimeout(1500);
  await page
    .locator("button[data-testid='stop-button']")
    .waitFor({ state: "detached", timeout: 180000 })
    .catch(() => {});

  const assistant = page.locator("[data-message-author-role='assistant']").last();
  const text = (await assistant.innerText().catch(() => "")) || "";
  if (ownsBrowser) await ctx.close(); // never close the operator's real (CDP) Chrome
  if (!text.trim()) fail("chatgpt-web returned empty (selector drift or model still generating). Inspect chatgpt.com DOM and update selectors.");
  emit(text, selectedModel);
} catch (e) {
  fail(`chatgpt-web adapter error: ${(e as Error).message}`);
}
