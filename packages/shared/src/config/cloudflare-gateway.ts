/**
 * Cloudflare AI Gateway connections (Pi provider `cloudflare-ai-gateway`).
 *
 * The Pi SDK needs an API token plus the account and gateway ids, which it
 * substitutes into every model URL (`gateway.ai.cloudflare.com/v1/{account}/{gateway}/…`)
 * from `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_GATEWAY_ID`. Craft's API-key form has a
 * key and a base URL, so the user pastes the gateway URL from the Cloudflare
 * dashboard and both ids are read from it.
 *
 * Pure (no Pi imports): used by the renderer form and the Pi subprocess.
 */
export const CLOUDFLARE_AI_GATEWAY_PROVIDER = 'cloudflare-ai-gateway';

export const CLOUDFLARE_AI_GATEWAY_URL_EXAMPLE = 'https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-id>';

/** Account and gateway id from a gateway URL (any provider suffix allowed), or null. */
export function parseCloudflareGatewayUrl(url: string): { accountId: string; gatewayId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'gateway.ai.cloudflare.com') return null;
  let segments: string[];
  try {
    segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null; // a malformed percent-escape is an unusable URL, like any other parse failure
  }
  const [version, accountId, gatewayId] = segments;
  if (version !== 'v1' || !accountId || !gatewayId || accountId.startsWith('<') || gatewayId.startsWith('<')) return null;
  return { accountId, gatewayId };
}
