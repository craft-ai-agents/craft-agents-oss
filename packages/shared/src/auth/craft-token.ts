import { getCredentialManager } from '../credentials';
import { CraftApi, getTeamIdFromProfile } from '../clients/craftApi';
import { debug } from '../utils/debug';

const REFRESH_BUFFER_MS = 60 * 60 * 1000;
const CRAFT_API_BASE_URL = 'https://api.craft.do';


function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      debug('[CraftToken] Invalid JWT format: expected 3 parts');
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    if (!payload) {
      debug('[CraftToken] Missing payload in JWT');
      return null;
    }

    // Replace base64url chars with base64 chars
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = atob(base64);
    return JSON.parse(jsonPayload);
  } catch (err) {
    debug('[CraftToken] Failed to decode JWT payload:', err);
    return null;
  }
}

function isTokenExpiringSoon(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    return true;
  }

  // JWT exp is in seconds, convert to milliseconds
  const expiresAtMs = payload.exp * 1000;
  const now = Date.now();
  const expiresIn = expiresAtMs - now;
  return expiresIn < REFRESH_BUFFER_MS;
}

async function refreshCraftToken(currentToken: string): Promise<string> {
  debug('[CraftToken] Refreshing token...');

  const craftApi = new CraftApi(CRAFT_API_BASE_URL);
  const newToken = await craftApi.renewSession(currentToken);

  debug('[CraftToken] Token refreshed successfully');
  return newToken;
}

export async function getCraftToken(): Promise<string> {
  const manager = getCredentialManager();

  // Get current token from credential manager
  const token = await manager.getCraftOAuth();

  if (!token) {
    throw new Error('No Craft token stored. Please authenticate first.');
  }

  // Check if token is expired or expiring soon
  if (isTokenExpiringSoon(token)) {
    debug('[CraftToken] Token is expired or expiring soon, refreshing...');

    // Refresh the token using the current token for auth
    const newToken = await refreshCraftToken(token);

    // Save the new token
    await manager.setCraftOAuth(newToken);
    debug('[CraftToken] New token saved');

    return newToken;
  }

  debug('[CraftToken] Token is valid, returning existing token');
  return token;
}

export async function getTeamId(): Promise<string | null> {
  const manager = getCredentialManager();
  const token = await manager.getCraftOAuth();
  if (!token) {
    throw new Error('No Craft token stored. Please authenticate first.');
  }
  const craftApi = new CraftApi();
  const profile = await craftApi.getProfile(token);
  return getTeamIdFromProfile(profile);
}