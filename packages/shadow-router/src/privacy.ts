// Tri-harness privacy resolver — promoted out of the Craft runtime so EVERY client
// (not just Craft) gets privacy-aware routing. Mirrors system/controls/tri-harness-routing.json.

import type {
  ChatRequest,
  ContentCategory,
  PrivacyTier,
  ProviderConfig,
} from "./types.ts";

const PATTERNS: Array<{ category: ContentCategory; re: RegExp }> = [
  {
    category: "health",
    re: /\b(diagnos\w*|prescription|symptom|patient|medical record|mrn|icd-?10|therapy|mg\/d?l|blood pressure)\b/i,
  },
  {
    category: "financial",
    re: /\b(account number|routing number|iban|ssn|social security|credit card|cvv|salary|bank balance|tax id|ein)\b/i,
  },
  {
    category: "identity",
    re: /\b(passport|driver'?s? licen[cs]e|date of birth|home address|biometric|national id)\b/i,
  },
];

function flatten(req: ChatRequest): string {
  return req.messages
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => p.text ?? "").join(" "),
    )
    .join("\n");
}

/** Classify the most sensitive category present in the prompt. */
export function classifyContentSensitivity(req: ChatRequest): ContentCategory {
  const text = flatten(req);
  for (const { category, re } of PATTERNS) {
    if (re.test(text)) return category;
  }
  return "general";
}

const SENSITIVE: ContentCategory[] = ["health", "financial", "identity"];

export function isSensitive(category: ContentCategory): boolean {
  return SENSITIVE.includes(category);
}

/**
 * A provider may serve a request iff it satisfies the category's privacy floor.
 * Sensitive content → only never_trains/local_only, piiSafe, non-CN jurisdiction.
 */
export function checkConnectionPrivacy(
  provider: ProviderConfig,
  category: ContentCategory,
): { ok: boolean; reason: string } {
  if (!isSensitive(category)) return { ok: true, reason: "non-sensitive" };

  if (provider.jurisdiction === "cn")
    return { ok: false, reason: "cn-jurisdiction-excluded-for-sensitive" };
  if (!provider.piiSafe)
    return { ok: false, reason: "not-pii-safe" };

  const allowed: PrivacyTier[] = ["never_trains", "local_only"];
  if (!allowed.includes(provider.privacyTier))
    return { ok: false, reason: `privacy-tier-${provider.privacyTier}-trains` };

  return { ok: true, reason: "privacy-safe" };
}

/** Filter a provider set to those safe for the given category. */
export function privacySafeProviders(
  providers: Record<string, ProviderConfig>,
  category: ContentCategory,
): string[] {
  return Object.entries(providers)
    .filter(([, p]) => checkConnectionPrivacy(p, category).ok)
    .map(([name]) => name);
}
