/**
 * GitHub OAuth Device Flow
 *
 * Implements RFC 8628 device authorization flow for authenticating
 * with GitHub Copilot using the well-known public OAuth App.
 *
 * Credential storage key: `llm_oauth::copilot`
 */
import { openUrl } from '../utils/open-url.ts';

// ============================================================
// Configuration
// ============================================================

/** GitHub Copilot's well-known public OAuth App client ID */
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPE = 'read:user';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

// ============================================================
// Types
// ============================================================

export interface GithubTokens {
  /** GitHub OAuth access token */
  accessToken: string;
  /** Refresh token (unused — device flow tokens don't expire) */
  refreshToken?: string;
  /** Token expiration timestamp (unused — device flow tokens don't expire) */
  expiresAt?: number;
  /** Token scope */
  scope?: string;
}

export interface GithubDeviceCode {
  /** The code the user must enter at the verification URI */
  userCode: string;
  /** The URL the user must visit to enter the code */
  verificationUri: string;
}

// ============================================================
// State
// ============================================================

let abortController: AbortController | null = null;

// ============================================================
// OAuth Device Flow
// ============================================================

/**
 * Start the GitHub OAuth device flow.
 *
 * 1. Requests a device code from GitHub
 * 2. Opens the verification URI in the browser
 * 3. Polls for token until the user authorizes or the flow is cancelled/expired
 *
 * Returns a promise that resolves with the tokens once the user authorizes.
 */
export async function startGithubOAuth(
  onStatus?: (message: string) => void,
  onDeviceCode?: (deviceCode: GithubDeviceCode) => void,
): Promise<GithubTokens> {
  // Cancel any previous flow
  cancelGithubOAuth();

  abortController = new AbortController();
  const { signal } = abortController;

  onStatus?.('Requesting device code...');

  // Step 1: Request device code
  const deviceResponse = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
    }).toString(),
    signal,
  });

  if (!deviceResponse.ok) {
    const errorText = await deviceResponse.text();
    throw new Error(`Failed to request device code: ${deviceResponse.status} - ${errorText}`);
  }

  const deviceData = (await deviceResponse.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
    error?: string;
    error_description?: string;
  };

  if (deviceData.error) {
    throw new Error(deviceData.error_description || deviceData.error);
  }

  const { device_code, user_code, verification_uri, expires_in, interval: initialInterval } = deviceData;

  // Notify caller of the device code so it can be displayed in the UI
  onDeviceCode?.({ userCode: user_code, verificationUri: verification_uri });

  // Step 2: Open browser for user to enter the code
  onStatus?.('Opening browser for authentication...');
  await openUrl(verification_uri);

  // Step 3: Poll for token
  onStatus?.('Waiting for authentication...');

  let interval = initialInterval;
  const expiresAt = Date.now() + expires_in * 1000;

  while (Date.now() < expiresAt) {
    // Check for cancellation
    if (signal.aborted) {
      throw new Error('OAuth flow cancelled');
    }

    // Wait for the polling interval
    await sleep(interval * 1000, signal);

    // Check for cancellation after sleep
    if (signal.aborted) {
      throw new Error('OAuth flow cancelled');
    }

    try {
      const tokenResponse = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
        signal,
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token request failed: ${tokenResponse.status} - ${errorText}`);
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
        token_type?: string;
        scope?: string;
        error?: string;
        error_description?: string;
        interval?: number;
      };

      if (tokenData.access_token) {
        // Success!
        onStatus?.('Authentication successful!');
        abortController = null;
        return {
          accessToken: tokenData.access_token,
          scope: tokenData.scope,
        };
      }

      // Handle RFC 8628 error codes
      switch (tokenData.error) {
        case 'authorization_pending':
          // User hasn't entered the code yet — continue polling
          break;

        case 'slow_down':
          // Server asks us to slow down — increase interval by 5 seconds
          interval += 5;
          break;

        case 'expired_token':
          throw new Error('The device code has expired. Please try again.');

        case 'access_denied':
          throw new Error('Access denied. The user cancelled the authorization.');

        default:
          throw new Error(tokenData.error_description || tokenData.error || 'Unknown error during token polling');
      }
    } catch (error) {
      // Re-throw abort errors and our own errors
      if (signal.aborted || error instanceof Error) {
        throw error;
      }
      throw new Error(`Token polling failed: ${String(error)}`);
    }
  }

  throw new Error('The device code has expired. Please try again.');
}

/**
 * Cancel the current OAuth flow
 */
export function cancelGithubOAuth(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('OAuth flow cancelled'));
    }, { once: true });
  });
}
