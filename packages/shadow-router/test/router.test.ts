import { test, expect } from "bun:test";
import { resolveAll } from "../src/providers.ts";
import { resolveModel, resolveAuto } from "../src/router.ts";
import { classifyContentSensitivity, checkConnectionPrivacy, privacySafeProviders } from "../src/privacy.ts";
import type { ChatRequest, RouterConfig } from "../src/types.ts";

const config = (await Bun.file(new URL("../config/shadow-router.config.json", import.meta.url).pathname).json()) as RouterConfig;

function req(text: string, model = "auto"): ChatRequest {
  return { model, messages: [{ role: "user", content: text }] };
}

// env without OPENROUTER key → openrouter disabled, vibeproxy + ollama enabled.
// SHADOW_ROUTER_NO_KEYCHAIN keeps the test hermetic (no macOS Keychain lookup).
const env = { VIBEPROXY_KEY: "k", SHADOW_ROUTER_NO_KEYCHAIN: "1" } as Record<string, string | undefined>;

test("content classifier flags sensitive categories", () => {
  expect(classifyContentSensitivity(req("write a python function"))).toBe("general");
  expect(classifyContentSensitivity(req("my diagnosis and prescription details"))).toBe("health");
  expect(classifyContentSensitivity(req("here is my account number and routing number"))).toBe("financial");
  expect(classifyContentSensitivity(req("scan of my passport and date of birth"))).toBe("identity");
});

test("openrouter is dark without a key", () => {
  const provs = resolveAll(config, env);
  expect(provs.get("openrouter")!.enabled).toBe(false);
  expect(provs.get("vibeproxy")!.enabled).toBe(true);
});

test("sensitive content excludes training lanes, keeps local", () => {
  const safe = privacySafeProviders(config.providers, "health");
  expect(safe).toContain("ollama");
  // vibeproxy is never_trains + piiSafe + us → allowed even for sensitive
  expect(safe).toContain("vibeproxy");
  // a hypothetical CN/trains provider would be excluded
  const cn = { ...config.providers.openrouter, jurisdiction: "cn", privacyTier: "trains_no_opt_out" as const };
  expect(checkConnectionPrivacy(cn, "health").ok).toBe(false);
});

test("auto routes code → code lane", () => {
  const provs = resolveAll(config, env);
  const d = resolveAuto(req("refactor this typescript function and fix the bug"), config, provs);
  expect(d.provider).toBe("vibeproxy");
  expect(d.model).toBe("gpt-5.5");
  expect(d.reason).toContain("code");
});

test("private virtual model forces local-only", () => {
  const provs = resolveAll(config, env);
  const d = resolveModel(req("anything", "private"), config, provs);
  expect(d.provider).toBe("ollama");
});

test("explicit pick that violates privacy falls back to auto, never leaks", () => {
  const provs = resolveAll(config, env);
  // force a CN/training provider into the config, then address it explicitly with sensitive content
  const cfg = JSON.parse(JSON.stringify(config)) as RouterConfig;
  cfg.providers.badcn = { ...cfg.providers.openrouter, jurisdiction: "cn", privacyTier: "trains_no_opt_out", enabledIfKey: false, apiKeyEnv: null };
  const p2 = resolveAll(cfg, env);
  const d = resolveModel({ model: "badcn/some-model", messages: [{ role: "user", content: "my medical record and diagnosis" }] }, cfg, p2);
  expect(d.provider).not.toBe("badcn");
  expect(d.reason).toContain("blocked");
});
