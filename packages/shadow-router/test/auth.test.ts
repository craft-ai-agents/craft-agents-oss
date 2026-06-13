import { test, expect } from "bun:test";
import { checkAuth, resolveAuthKey } from "../src/auth.ts";
import type { AuthConfig } from "../src/types.ts";

const cfg: AuthConfig = { required: true, keyEnv: "SHADOW_ROUTER_KEY", allowedHosts: ["127.0.0.1", "localhost"] };
const KEY = "shr-test-key";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:8787/v1/chat/completions", { method: "POST", headers });
}

test("missing bearer → 401", () => {
  const r = checkAuth(reqWith({ host: "127.0.0.1:8787" }), cfg, KEY);
  expect(r.ok).toBe(false);
  expect(r.status).toBe(401);
});

test("wrong bearer → 401", () => {
  const r = checkAuth(reqWith({ host: "127.0.0.1:8787", authorization: "Bearer nope" }), cfg, KEY);
  expect(r.status).toBe(401);
});

test("correct bearer → ok", () => {
  const r = checkAuth(reqWith({ host: "127.0.0.1:8787", authorization: `Bearer ${KEY}` }), cfg, KEY);
  expect(r.ok).toBe(true);
});

test("disallowed host (DNS rebinding) → 403", () => {
  const r = checkAuth(reqWith({ host: "evil.example.com", authorization: `Bearer ${KEY}` }), cfg, KEY);
  expect(r.status).toBe(403);
});

test("no server key configured → 503", () => {
  const r = checkAuth(reqWith({ host: "127.0.0.1", authorization: `Bearer ${KEY}` }), cfg, null);
  expect(r.status).toBe(503);
});

test("auth disabled → always ok", () => {
  const r = checkAuth(reqWith({ host: "anything" }), { ...cfg, required: false }, null);
  expect(r.ok).toBe(true);
});

test("resolveAuthKey prefers env", () => {
  expect(resolveAuthKey(cfg, { SHADOW_ROUTER_KEY: "envkey" })).toBe("envkey");
  expect(resolveAuthKey(cfg, { SHADOW_ROUTER_NO_KEYCHAIN: "1" })).toBe(null);
});
