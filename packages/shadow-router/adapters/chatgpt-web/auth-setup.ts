#!/usr/bin/env bun
// One-time auth setup for the chatgpt-web lane.
// Opens a dedicated Chrome window (separate user-data-dir — does NOT touch your main
// Chrome profile) at chatgpt.com. Log in there, then close the window. The session
// cookies persist in SHADOW_CHATGPT_PROFILE for the adapter to reuse.
//
//   SHADOW_CHATGPT_PROFILE=~/.shadow-router/chatgpt-profile bun run adapters/chatgpt-web/auth-setup.ts

const profile = process.env.SHADOW_CHATGPT_PROFILE;
if (!profile) {
  console.error("Set SHADOW_CHATGPT_PROFILE to a directory to hold the dedicated Chrome session.");
  process.exit(1);
}

const { chromium } = await import("playwright");
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  channel: "chrome",
  viewport: null,
  args: ["--no-first-run", "--no-default-browser-check"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" }).catch(() => {});

console.error("→ Log into chatgpt.com in the opened window (use the account with your Pro/Plus sub).");
console.error("→ Once you see the chat UI, close the window. The session will be saved to:", profile);

await new Promise<void>((resolve) => ctx.on("close", () => resolve()));
console.error("Saved. The chatgpt-web adapter can now reuse this session.");
