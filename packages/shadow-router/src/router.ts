// Tri-harness router — resolves a request (virtual or concrete model) to a backend lane,
// enforcing the privacy floor for the detected content category.

import { classifyContentSensitivity, checkConnectionPrivacy, privacySafeProviders } from "./privacy.ts";
import type { ChatRequest, ContentCategory, RouteDecision, RouterConfig } from "./types.ts";
import type { ResolvedProvider } from "./providers.ts";

// An optional category override lets an async classifier (NER) escalate sensitivity
// before routing — e.g. flagging a person/location the keyword classifier missed.
function categoryOf(req: ChatRequest, override?: ContentCategory): ContentCategory {
  return override ?? classifyContentSensitivity(req);
}

function classifyTask(req: ChatRequest): keyof RouterConfig["routing"]["byTask"] {
  const text = req.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ").toLowerCase();
  if (/\b(code|function|refactor|bug|stack trace|compile|typescript|python|repo|diff)\b/.test(text)) return "code";
  if (/\b(image|screenshot|photo|diagram|chart|ocr|vision)\b/.test(text)) return "vision";
  if (/\b(prove|analy[sz]e|architecture|trade-?off|reason|step by step|why)\b/.test(text)) return "reasoning";
  if (text.length < 280) return "cheap";
  return "default";
}

/**
 * Model id for a lane chosen by fallback (privacy floor pushed us off the task-pref lane),
 * not by an explicit pick. Resolution order, most-to-least specific:
 *   1. a task-specific route for this lane — byTask[`${task}_local`] when it targets this provider
 *      (e.g. code on the local lane → the local coder, not the general local model);
 *   2. the lane's declared defaultModel (e.g. the general local model for private content);
 *   3. the global task default (last resort — may be a cloud id, only correct if the lane shares it).
 */
function fallbackModel(
  task: keyof RouterConfig["routing"]["byTask"],
  provider: string,
  config: RouterConfig,
  providers: Map<string, ResolvedProvider>,
): string {
  const taskLocal = config.routing.byTask[`${task}_local`];
  if (taskLocal && taskLocal.provider === provider) return taskLocal.model;
  return providers.get(provider)?.defaultModel ?? config.routing.byTask.default.model;
}

/** Pick the cheapest privacy-safe lane for an `auto` request. */
export function resolveAuto(
  req: ChatRequest,
  config: RouterConfig,
  providers: Map<string, ResolvedProvider>,
  override?: ContentCategory,
): RouteDecision {
  const category = categoryOf(req, override);
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
  // When we fall off the task-pref lane (e.g. pref is a cloud lane but the content is restricted,
  // so only a different lane is privacy-safe), the cloud pref's model id would 404 on that lane.
  // Resolve a model the fallback lane actually serves (task-specific local route → lane default).
  const model = provider === pref.provider ? pref.model : fallbackModel(task, provider, config, providers);
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
  override?: ContentCategory,
): RouteDecision {
  const category = categoryOf(req, override);
  const local = Object.entries(config.providers)
    .filter(([, p]) => p.privacyTier === "local_only")
    .map(([n]) => n)
    .find((n) => providers.get(n)?.enabled);
  // Use the local lane's own defaultModel — the task-default model is a cloud id the local
  // backend doesn't serve. Falls back to the task default only if the lane declares no defaultModel.
  return local
    ? { provider: local, model: providers.get(local)?.defaultModel ?? config.routing.byTask.default.model, reason: "private:local-only", category }
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
  override?: ContentCategory,
): RouteDecision {
  const id = req.model;

  if (id === "auto") return resolveAuto(req, config, providers, override);
  if (id === "private") return resolvePrivate(req, config, providers, override);

  const category = categoryOf(req, override);

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
      const auto = resolveAuto(req, config, providers, override);
      return { ...auto, reason: `blocked:${providerName}:${check.reason}->auto` };
    }
  }
  return { provider: providerName, model, reason: "explicit", category };
}
