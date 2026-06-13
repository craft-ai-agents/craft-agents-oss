// Tri-harness router — resolves a request (virtual or concrete model) to a backend lane,
// enforcing the privacy floor for the detected content category.

import { classifyContentSensitivity, checkConnectionPrivacy, privacySafeProviders } from "./privacy.ts";
import type { ChatRequest, RouteDecision, RouterConfig } from "./types.ts";
import type { ResolvedProvider } from "./providers.ts";

function classifyTask(req: ChatRequest): keyof RouterConfig["routing"]["byTask"] {
  const text = req.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ").toLowerCase();
  if (/\b(code|function|refactor|bug|stack trace|compile|typescript|python|repo|diff)\b/.test(text)) return "code";
  if (/\b(image|screenshot|photo|diagram|chart|ocr|vision)\b/.test(text)) return "vision";
  if (/\b(prove|analy[sz]e|architecture|trade-?off|reason|step by step|why)\b/.test(text)) return "reasoning";
  if (text.length < 280) return "cheap";
  return "default";
}

/** Pick the cheapest privacy-safe lane for an `auto` request. */
export function resolveAuto(
  req: ChatRequest,
  config: RouterConfig,
  providers: Map<string, ResolvedProvider>,
): RouteDecision {
  const category = classifyContentSensitivity(req);
  const safe = privacySafeProviders(config.providers, category).filter((n) => providers.get(n)?.enabled);
  const task = classifyTask(req);
  const pref = config.routing.byTask[task] ?? config.routing.byTask.default;

  // Prefer the task default lane if it is privacy-safe; otherwise fall to the first safe provider.
  let provider = safe.includes(pref.provider) ? pref.provider : safe[0];
  if (!provider) {
    return {
      provider: "",
      model: "",
      reason: `no-privacy-safe-provider-for-${category}`,
      category,
      excluded: Object.keys(config.providers).filter((n) => !safe.includes(n)),
    };
  }
  const model = provider === pref.provider ? pref.model : (config.routing.byTask.default.model);
  return {
    provider,
    model,
    reason: `auto:${task}:${category}`,
    category,
    excluded: Object.keys(config.providers).filter((n) => !safe.includes(n)),
  };
}

/** Force a local-only lane (the `private` virtual model). */
export function resolvePrivate(
  req: ChatRequest,
  config: RouterConfig,
  providers: Map<string, ResolvedProvider>,
): RouteDecision {
  const category = classifyContentSensitivity(req);
  const local = Object.entries(config.providers)
    .filter(([, p]) => p.privacyTier === "local_only")
    .map(([n]) => n)
    .find((n) => providers.get(n)?.enabled);
  return local
    ? { provider: local, model: config.routing.byTask.default.model, reason: "private:local-only", category }
    : { provider: "", model: "", reason: "no-local-provider-available", category };
}

/**
 * Resolve any incoming model id to a concrete lane.
 * Virtual models route through the tri-harness; `provider/model` and bare ids resolve directly
 * but are still privacy-checked against the chosen provider.
 */
export function resolveModel(
  req: ChatRequest,
  config: RouterConfig,
  providers: Map<string, ResolvedProvider>,
): RouteDecision {
  const id = req.model;

  if (id === "auto") return resolveAuto(req, config, providers);
  if (id === "private") return resolvePrivate(req, config, providers);

  const category = classifyContentSensitivity(req);

  // Explicit provider/model addressing.
  let providerName = config.defaultProvider;
  let model = id;
  if (id.includes("/") && providers.has(id.split("/")[0])) {
    [providerName, model] = [id.split("/")[0], id.split("/").slice(1).join("/")];
  }

  const pcfg = config.providers[providerName];
  if (pcfg) {
    const check = checkConnectionPrivacy(pcfg, category);
    if (!check.ok) {
      // Privacy violation on an explicit pick → fall back to auto rather than leak.
      const auto = resolveAuto(req, config, providers);
      return { ...auto, reason: `blocked:${providerName}:${check.reason}->auto` };
    }
  }
  return { provider: providerName, model, reason: "explicit", category };
}
