/**
 * Where a Pi connection's credential may go.
 *
 * A Pi session authenticates one provider: its connection's own. The Pi SDK authenticates
 * any provider it has nothing stored for from the environment (an OPENAI_API_KEY or
 * ANTHROPIC_API_KEY the app was started with, gcloud or AWS profiles; pi-ai
 * auth/resolve.ts), and when the session model doesn't resolve it picks its default model
 * from every provider that authenticates. So the Pi credential store holds the
 * connection's credential under its provider and a blocking entry for every other
 * built-in provider (`syncPiCredentialStore`); the connection's own provider may still
 * authenticate from the environment (`environment` auth, Bedrock with an AWS profile).
 *
 * A custom (OpenAI/Anthropic-compatible) endpoint is labelled with a vendor's provider
 * id, `piAuth.provider` 'openai' or 'anthropic', so the Pi SDK formats its requests, but
 * its key belongs to the endpoint alone. The endpoint gets the key through its
 * 'custom-endpoint' provider registration (index.ts `registerCustomEndpointModels`), and
 * every built-in provider, the labelled vendor included, is blocked. Model resolution
 * only returns custom-endpoint models (`resolvePiModel`'s `customEndpointOnly`), and the
 * session and utility queries fall back to registered endpoint models, never to the Pi
 * SDK's default or a vendor's mini model.
 */

import type { Credential as PiSdkCredential, CredentialStore } from '@earendil-works/pi-ai';
import { getProviders } from '@earendil-works/pi-ai/compat';
import { adaptCredentialForPiSdk, type PiCredential } from './adapt-credential.ts';
import { stripPiPrefix, type CustomEndpointConfig } from './custom-endpoint-models.ts';

/** The init config fields that decide where the connection's credential may go. */
export interface CredentialRoutingConfig {
  baseUrl?: string;
  customEndpoint?: CustomEndpointConfig;
  /**
   * The connection's provider (Pi SDK id). Sent apart from piAuth: a connection that
   * authenticates from the environment has no credential to send.
   */
  piAuthProvider?: string;
  piAuth?: { provider: string; credential: PiCredential };
  /** Legacy key, sent by the main process when there is no piAuth. */
  apiKey?: string;
}

/** Every provider the Pi SDK has built in, i.e. every provider its runtime can authenticate. */
export const PI_BUILTIN_PROVIDER_IDS: readonly string[] = Object.freeze([...getProviders()]);

/** The provider the legacy key (`apiKey`, no piAuth) is stored under. */
const LEGACY_KEY_PROVIDER = 'anthropic';

/** A custom endpoint is configured: a base URL plus its protocol (`customEndpoint`). */
export function hasCustomEndpoint(cfg: CredentialRoutingConfig | null | undefined): boolean {
  return Boolean(cfg?.customEndpoint && cfg.baseUrl?.trim());
}

/** Whether the connection's credential goes into the Pi credential store under its provider id. */
export function shouldStoreCredentialInPiStore(cfg: CredentialRoutingConfig | null | undefined): boolean {
  return !hasCustomEndpoint(cfg);
}

/**
 * The one built-in provider a session may authenticate: the connection's. None for a
 * custom endpoint (its key travels in the endpoint's own registration); undefined, too,
 * when the connection names no provider at all, the one case where nothing is blocked.
 */
export function connectionPiProvider(cfg: CredentialRoutingConfig | null | undefined): string | undefined {
  if (!cfg || hasCustomEndpoint(cfg)) return undefined;
  return cfg.piAuth?.provider || cfg.piAuthProvider || (cfg.apiKey ? LEGACY_KEY_PROVIDER : undefined);
}

/**
 * Stored instead of a credential under a provider id a session must never authenticate
 * to. The Pi SDK resolves a stored credential of a type it has no handler for to "no
 * auth", and a stored credential keeps it from reading env vars (pi-ai
 * auth/resolve.ts), so a request to that provider fails before it is sent, and the
 * provider's models are not available to the SDK's default-model pick.
 */
export const BLOCKED_PI_CREDENTIAL = Object.freeze({
  type: 'craft-connection-provider-only',
}) as unknown as PiSdkCredential;

/**
 * Provider ids that get BLOCKED_PI_CREDENTIAL: every built-in provider but the
 * connection's own; for a custom endpoint all of them, plus the id its credential is
 * labelled with; none when the connection names no provider.
 */
export function blockedPiStoreProviders(
  cfg: CredentialRoutingConfig | null | undefined,
  builtinProviderIds: readonly string[] = PI_BUILTIN_PROVIDER_IDS,
): string[] {
  if (hasCustomEndpoint(cfg)) {
    const label = cfg?.piAuth?.provider || cfg?.piAuthProvider;
    return [...new Set<string>([...builtinProviderIds, ...(label ? [label] : [])])];
  }
  const own = connectionPiProvider(cfg);
  return own ? builtinProviderIds.filter(id => id !== own) : [];
}

/**
 * Bring the Pi credential store in line with the connection; run at runtime creation,
 * on token_update and on update_runtime_config.
 * - Every provider but the connection's own gets a blocking entry (see
 *   BLOCKED_PI_CREDENTIAL); a custom endpoint's key stays out of the store.
 * - The piAuth credential goes under its provider, adapted to a shape the SDK resolves
 *   (none when it must resolve ambiently, e.g. Bedrock iam); the legacy key goes under
 *   'anthropic', and only when that is the connection's provider.
 */
export async function syncPiCredentialStore(
  store: CredentialStore,
  cfg: CredentialRoutingConfig | null | undefined,
  log: (message: string) => void,
  builtinProviderIds: readonly string[] = PI_BUILTIN_PROVIDER_IDS,
): Promise<void> {
  if (!cfg) return;
  const blocked = blockedPiStoreProviders(cfg, builtinProviderIds);
  for (const provider of blocked) {
    await store.modify(provider, async () => BLOCKED_PI_CREDENTIAL);
  }
  if (hasCustomEndpoint(cfg)) {
    log(`Custom endpoint: its credential goes only to the endpoint; blocked all ${blocked.length} built-in providers`);
    return;
  }
  const own = connectionPiProvider(cfg);
  log(own
    ? `Only ${own} may authenticate; blocked ${blocked.length} other providers`
    : 'The connection names no provider: no provider is blocked');

  if (cfg.piAuth) {
    const { provider, credential } = cfg.piAuth;
    const adapted = adaptCredentialForPiSdk(provider, credential);
    if (adapted) {
      await store.modify(provider, async () => adapted);
      log(`Injected ${credential.type} credential for provider: ${provider}${
        adapted.type !== credential.type ? ` (stored as ${adapted.type} for SDK resolution)` : ''}`);
    } else {
      log(`Not storing ${credential.type} credential for provider: ${provider} — resolves ambiently from env`);
    }
  } else if (cfg.apiKey && own === LEGACY_KEY_PROVIDER) {
    const key = cfg.apiKey;
    await store.modify(LEGACY_KEY_PROVIDER, async () => ({ type: 'api_key', key }));
    log('Injected API key into credential store (legacy fallback)');
  } else if (cfg.apiKey) {
    log(`Not storing the legacy key: it is an ${LEGACY_KEY_PROVIDER} key and the connection's provider is ${own}`);
  }
}

/**
 * Why a session may not run on a model of `modelProvider`, or undefined when it may: a
 * custom-endpoint session runs only on endpoint models, any other on its connection's
 * provider (nothing to check when the connection names none). The check after the Pi SDK
 * picked the model; the store and model resolution keep it from picking another one.
 */
export function sessionModelProviderError(
  modelProvider: string | undefined,
  cfg: CredentialRoutingConfig | null | undefined,
): string | undefined {
  if (!modelProvider) return undefined;
  const allowed = hasCustomEndpoint(cfg) ? 'custom-endpoint' : connectionPiProvider(cfg);
  if (!allowed || modelProvider === allowed) return undefined;
  return `The session model is a ${modelProvider} model, but this connection may only use ${allowed}`;
}

/**
 * The model a utility query (call_llm, titles, summaries) runs on with a custom
 * endpoint: the requested one when the endpoint has it registered, else the mini model,
 * then the session model, then the first registered model, whichever is registered.
 * Never a model outside the endpoint; undefined when nothing is registered.
 */
export function pickCustomEndpointUtilityModel(
  requested: string | undefined,
  cfg: { miniModel?: string; model?: string },
  registeredIds: Iterable<string>,
): string | undefined {
  const registered = [...registeredIds];
  const candidates = [requested, cfg.miniModel, cfg.model];
  return candidates.find(id => !!id && registered.includes(stripPiPrefix(id))) ?? registered[0];
}
