/**
 * Craft ↔ Pi SDK provider ids.
 *
 * Craft keeps the provider ids it persists on LLM connections
 * (`LlmConnection.piAuthProvider`, the API-key presets) and translates them
 * where they cross into the Pi SDK, so an upstream rename never needs a config
 * migration and a downgrade keeps working. Craft's preset keys are already a
 * Craft namespace (`openai-eu`, `minimax-global`, …).
 *
 * - `azure-openai-responses` → `azure` (Pi 1.0.3). Only the provider id moved;
 *   the API name `azure-openai-responses` and the `AZURE_OPENAI_*` env vars are
 *   unchanged.
 * - `openai-eu` / `openai-us` → `openai`, at the region's own API
 *   (`regionalProviderBaseUrl`): OpenAI's data residency projects, whose keys
 *   belong to that API. One way only: `openai` never maps back to a region.
 *
 * Pure (no Pi imports) so the Pi subprocess and renderer-safe code can use it.
 */
const CRAFT_TO_PI_PROVIDER_ID: Readonly<Record<string, string>> = {
  'azure-openai-responses': 'azure',
};

const PI_TO_CRAFT_PROVIDER_ID: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CRAFT_TO_PI_PROVIDER_ID).map(([craftId, piId]) => [piId, craftId]),
);

/** Craft presets for a regional API of a Pi SDK provider: its models at the region's base URL. */
const CRAFT_REGIONAL_PROVIDERS: Readonly<Record<string, { piProviderId: string; baseUrl: string }>> = {
  'openai-eu': { piProviderId: 'openai', baseUrl: 'https://eu.api.openai.com/v1' },
  'openai-us': { piProviderId: 'openai', baseUrl: 'https://us.api.openai.com/v1' },
};

/** The Pi SDK provider id for a provider id Craft stores. */
export function toPiProviderId(craftProviderId: string): string {
  return CRAFT_TO_PI_PROVIDER_ID[craftProviderId]
    ?? CRAFT_REGIONAL_PROVIDERS[craftProviderId]?.piProviderId
    ?? craftProviderId;
}

/** The provider id Craft stores for a Pi SDK provider id. */
export function fromPiProviderId(piProviderId: string): string {
  return PI_TO_CRAFT_PROVIDER_ID[piProviderId] ?? piProviderId;
}

/**
 * The base URL every request of a regional preset goes to (its models and its credential
 * belong to that API), or undefined for any other provider id. Fixed per preset, never the
 * connection's stored base URL.
 */
export function regionalProviderBaseUrl(craftProviderId: string | undefined): string | undefined {
  return craftProviderId ? CRAFT_REGIONAL_PROVIDERS[craftProviderId]?.baseUrl : undefined;
}
