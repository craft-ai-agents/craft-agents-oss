#!/usr/bin/env bun
/**
 * Test token refresh with simulated short-lived tokens
 *
 * This test:
 * 1. Gets current credentials
 * 2. Modifies expiresAt to 5 seconds from now
 * 3. Saves modified credentials
 * 4. Waits 6 seconds
 * 5. Triggers an API call
 * 6. Verifies new token was obtained via refresh
 *
 * Usage:
 *   bun run scripts/test-token-refresh.ts [options]
 *
 * Options:
 *   --login            Authenticate with Claude OAuth (get fresh tokens)
 *   --set-expired [time]  Set token expiry (e.g., --set-expired 5m, --set-expired 30s, or just --set-expired for immediate)
 *   --expire-now       Set token to expire immediately then attempt refresh
 *   --test-migration   Test the migration path (simulates incompatible old tokens)
 *   --test-legacy      Test refresh using legacy Claude CLI endpoints
 *   --detect-origin    Detect which OAuth system the current token came from
 */

import { getCredentialManager } from '@craft-agent/shared/credentials';
import { refreshClaudeToken, isTokenExpired, startClaudeOAuth, exchangeClaudeCode } from '@craft-agent/shared/auth';
import { CLAUDE_OAUTH_CONFIG } from '@craft-agent/shared/auth';
import { getAuthState } from '@craft-agent/shared/auth';
import * as readline from 'readline';

const SHORT_EXPIRY_MS = 5000; // 5 seconds

/**
 * Legacy OAuth configuration used by Claude CLI / Claude Desktop
 * Tokens obtained via `claude setup-token` or Claude Desktop app use these endpoints
 */
const LEGACY_OAUTH_CONFIG = {
  TOKEN_URL: 'https://api.anthropic.com/v1/oauth/token',
  CLIENT_ID: 'claude-desktop',
} as const;

/**
 * Attempt to refresh a token using the legacy Claude CLI endpoints
 */
async function refreshWithLegacyEndpoint(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: LEGACY_OAUTH_CONFIG.CLIENT_ID,
  });

  const response = await fetch(LEGACY_OAUTH_CONFIG.TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || JSON.stringify(errorJson);
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Legacy token refresh failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Detect which OAuth system a token was obtained from
 *
 * WARNING: This function calls refresh endpoints which will invalidate tokens!
 * Only use this for testing, not in production code.
 */
async function detectTokenOriginDestructive(refreshToken: string): Promise<'legacy' | 'native' | 'unknown'> {
  console.log('  WARNING: This will call refresh endpoints and may invalidate tokens!');

  // Try legacy endpoint first (Claude CLI / Desktop)
  try {
    await refreshWithLegacyEndpoint(refreshToken);
    return 'legacy';
  } catch {
    // Legacy failed, try native
  }

  // Try native endpoint (Craft Agents native OAuth)
  try {
    await refreshClaudeToken(refreshToken);
    return 'native';
  } catch {
    // Both failed
  }

  return 'unknown';
}

async function testDetectOrigin() {
  console.log('=== Token Origin Detection ===\n');
  console.log('This is a READ-ONLY check that inspects stored token metadata.\n');

  const manager = getCredentialManager();
  const creds = await manager.getClaudeOAuthCredentials();

  if (!creds?.accessToken) {
    console.error('No credentials found. Please authenticate first:');
    console.error('  bun run scripts/test-token-refresh.ts --login');
    process.exit(1);
  }

  console.log('=== STORED CREDENTIALS ===');
  console.log(`Access token:  ${creds.accessToken.substring(0, 20)}...`);
  console.log(`Refresh token: ${creds.refreshToken?.substring(0, 20) || 'none'}...`);
  console.log(`Expires at:    ${creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'not set'}`);
  console.log(`Source:        ${creds.source || 'unknown (legacy or imported)'}`);

  // Check expiration
  if (creds.expiresAt) {
    const now = Date.now();
    const expiresIn = creds.expiresAt - now;
    const absExpiresIn = Math.abs(expiresIn);
    const hours = Math.floor(absExpiresIn / (1000 * 60 * 60));
    const minutes = Math.floor((absExpiresIn % (1000 * 60 * 60)) / (1000 * 60));

    if (expiresIn > 0) {
      console.log(`Status:        Valid (expires in ${hours}h ${minutes}m)`);
    } else {
      console.log(`Status:        EXPIRED (${hours}h ${minutes}m ago)`);
    }
  }

  console.log('\n=== ORIGIN DETECTION ===');

  if (creds.source === 'native') {
    console.log('✓ Token is from NATIVE OAuth (Craft Agents)');
    console.log('  - Obtained via our OAuth flow');
    console.log('  - Should refresh correctly with console.anthropic.com');
  } else if (creds.source === 'cli') {
    console.log('⚠ Token is from CLAUDE CLI (imported)');
    console.log('  - Was imported from Claude CLI keychain');
    console.log('  - May not refresh correctly with our endpoints');
    console.log('  - Recommend: re-authenticate with --login');
  } else {
    console.log('? Token origin UNKNOWN');
    console.log('  - No source metadata stored');
    console.log('  - Could be from old version or manual import');
    console.log('  - Recommend: re-authenticate with --login to ensure compatibility');
  }

  console.log('\n=== NEXT STEPS ===');
  if (creds.source !== 'native') {
    console.log('To get a fresh native token:');
    console.log('  bun run scripts/test-token-refresh.ts --login');
  } else {
    console.log('To test token refresh:');
    console.log('  bun run scripts/test-token-refresh.ts --expire-now');
  }
}

async function testLegacyRefresh() {
  console.log('=== Legacy Token Refresh Test ===\n');
  console.log('⚠️  WARNING: This test calls the legacy refresh endpoint!');
  console.log('   This may invalidate tokens shared with Claude CLI.\n');
  console.log('Legacy OAuth config:');
  console.log(`  - Token URL: ${LEGACY_OAUTH_CONFIG.TOKEN_URL}`);
  console.log(`  - Client ID: ${LEGACY_OAUTH_CONFIG.CLIENT_ID}`);
  console.log('');

  const manager = getCredentialManager();
  const creds = await manager.getClaudeOAuthCredentials();

  if (!creds?.refreshToken) {
    console.error('No credentials with refresh token found. Please authenticate first.');
    process.exit(1);
  }

  console.log('1. Current credentials:');
  console.log(`   - Access token: ${creds.accessToken.substring(0, 20)}...`);
  console.log(`   - Refresh token: ${creds.refreshToken.substring(0, 20)}...`);
  console.log(
    `   - Expires at: ${creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'not set'}`
  );

  console.log('\n2. Attempting legacy token refresh...');
  try {
    const refreshed = await refreshWithLegacyEndpoint(creds.refreshToken);
    console.log('   SUCCESS! Token refreshed via legacy endpoint.');
    console.log(`   - New access token: ${refreshed.accessToken.substring(0, 20)}...`);
    console.log(`   - New refresh token: ${refreshed.refreshToken?.substring(0, 20) || 'same'}...`);
    console.log(`   - New expiry: ${refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : 'not set'}`);

    // Ask if user wants to save
    console.log('\n3. Saving refreshed credentials...');
    await manager.setClaudeOAuthCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || creds.refreshToken,
      expiresAt: refreshed.expiresAt,
      source: 'cli',  // Mark as refreshed via legacy CLI endpoint
    });

    console.log('\n=== LEGACY REFRESH TEST PASSED ===');
    console.log('Your token is from Claude CLI/Desktop and works with legacy endpoints.');
  } catch (error) {
    console.error('   FAILED:', error instanceof Error ? error.message : error);
    console.log('\n=== LEGACY REFRESH TEST FAILED ===');
    console.log('Token may be from native OAuth or may be expired/revoked.');
    process.exit(1);
  }
}

async function testMigration() {
  console.log('=== Migration Path Test ===\n');
  console.log('This test verifies that expired/invalid tokens are properly cleared.\n');

  console.log('OAuth endpoints:');
  console.log(`  - Native: ${CLAUDE_OAUTH_CONFIG.TOKEN_URL}`);
  console.log(`  - Legacy: ${LEGACY_OAUTH_CONFIG.TOKEN_URL}`);
  console.log('');

  const manager = getCredentialManager();
  const originalCreds = await manager.getClaudeOAuthCredentials();

  if (!originalCreds?.accessToken) {
    console.error('No credentials found. Please authenticate first.');
    process.exit(1);
  }

  console.log('1. Current credentials:');
  console.log(`   - Access token: ${originalCreds.accessToken.substring(0, 20)}...`);
  console.log(`   - Refresh token: ${originalCreds.refreshToken?.substring(0, 20) || 'none'}...`);
  console.log(`   - Expires at: ${originalCreds.expiresAt ? new Date(originalCreds.expiresAt).toISOString() : 'not set'}`);

  // Set expiry to past to trigger refresh attempt
  console.log('\n2. Simulating expired token...');
  await manager.setClaudeOAuthCredentials({
    accessToken: originalCreds.accessToken,
    refreshToken: originalCreds.refreshToken,
    expiresAt: Date.now() - 1000, // Already expired
  });

  // Call getAuthState which will attempt refresh
  console.log('\n3. Calling getAuthState() (triggers refresh attempt)...');
  console.log('   This will try to refresh with the native endpoint.');
  const authState = await getAuthState();

  console.log('\n4. Auth state after refresh attempt:');
  console.log(`   - Has credentials: ${authState.billing.hasCredentials}`);
  console.log(`   - OAuth token: ${authState.billing.claudeOAuthToken ? 'present (refresh succeeded)' : 'null (refresh failed)'}`);
  console.log(`   - Migration required: ${authState.billing.migrationRequired ? 'yes' : 'no'}`);

  // Check if credentials were cleared or updated
  const afterCreds = await manager.getClaudeOAuthCredentials();
  console.log('\n5. Stored credentials after attempt:');
  console.log(`   - Access token: ${afterCreds?.accessToken ? (afterCreds.accessToken.length > 0 ? afterCreds.accessToken.substring(0, 20) + '...' : '(empty)') : 'null'}`);
  console.log(`   - Refresh token: ${afterCreds?.refreshToken?.substring(0, 20) || 'none'}`);

  const wasCleared = !afterCreds?.accessToken || afterCreds.accessToken.length === 0;
  const refreshSucceeded = !!authState.billing.claudeOAuthToken;

  if (refreshSucceeded) {
    console.log('\n=== REFRESH SUCCEEDED ===');
    console.log('Token was refreshed successfully with native endpoint.');
    console.log('Credentials have been updated with new tokens.');
  } else if (wasCleared) {
    console.log('\n=== MIGRATION TEST PASSED ===');
    console.log('Invalid/expired tokens were properly cleared.');
    console.log('User will be prompted to re-authenticate on next app start.');

    // Restore original credentials for subsequent tests
    console.log('\nRestoring original credentials for further testing...');
    await manager.setClaudeOAuthCredentials(originalCreds);
  } else {
    console.log('\n=== UNEXPECTED STATE ===');
    console.log('Credentials were neither refreshed nor cleared.');

    // Restore original credentials
    console.log('\nRestoring original credentials...');
    await manager.setClaudeOAuthCredentials(originalCreds);
  }
}

async function testRefresh() {
  console.log('=== Short-Lived Token Refresh Test ===\n');
  console.log('Using OAuth config:');
  console.log(`  - Token URL: ${CLAUDE_OAUTH_CONFIG.TOKEN_URL}`);
  console.log(`  - Client ID: ${CLAUDE_OAUTH_CONFIG.CLIENT_ID}`);
  console.log('');

  const manager = getCredentialManager();
  const originalCreds = await manager.getClaudeOAuthCredentials();

  if (!originalCreds?.refreshToken) {
    console.error('No credentials with refresh token found. Please authenticate first.');
    process.exit(1);
  }

  console.log('1. Original credentials:');
  console.log(`   - Access token: ${originalCreds.accessToken.substring(0, 20)}...`);
  console.log(`   - Refresh token: ${originalCreds.refreshToken.substring(0, 20)}...`);
  console.log(
    `   - Expires at: ${originalCreds.expiresAt ? new Date(originalCreds.expiresAt).toISOString() : 'not set'}`
  );

  // Check if --expire-now flag is set
  const expireNow = process.argv.includes('--expire-now');
  const shortExpiry = expireNow ? Date.now() - 1000 : Date.now() + SHORT_EXPIRY_MS;

  console.log(`\n2. Setting expiry to ${expireNow ? 'past (expired)' : `${SHORT_EXPIRY_MS}ms from now`}...`);

  await manager.setClaudeOAuthCredentials({
    accessToken: originalCreds.accessToken,
    refreshToken: originalCreds.refreshToken,
    expiresAt: shortExpiry,
  });

  console.log(`   - New expiry: ${new Date(shortExpiry).toISOString()}`);

  if (!expireNow) {
    // Wait for token to expire
    const waitTime = SHORT_EXPIRY_MS + 1000;
    console.log(`\n3. Waiting ${waitTime}ms for token to expire...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  } else {
    console.log('\n3. Token already expired (--expire-now flag)');
  }

  // Check if token is now expired
  const afterWaitCreds = await manager.getClaudeOAuthCredentials();
  console.log(`\n4. Checking token status after wait:`);
  console.log(`   - Is expired: ${isTokenExpired(afterWaitCreds?.expiresAt)}`);

  // Attempt refresh
  console.log('\n5. Attempting token refresh...');
  try {
    const refreshed = await refreshClaudeToken(originalCreds.refreshToken);
    console.log('   SUCCESS! Token refreshed.');
    console.log(`   - New access token: ${refreshed.accessToken.substring(0, 20)}...`);
    console.log(`   - New refresh token: ${refreshed.refreshToken?.substring(0, 20) || 'same'}...`);
    console.log(`   - New expiry: ${refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : 'not set'}`);

    // Save refreshed credentials
    await manager.setClaudeOAuthCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || originalCreds.refreshToken,
      expiresAt: refreshed.expiresAt,
      source: 'native',  // Mark as refreshed via native endpoint
    });

    console.log('\n6. Refreshed credentials saved.');
    console.log('\n=== TEST PASSED ===');
  } catch (error) {
    console.error('   FAILED:', error instanceof Error ? error.message : error);

    // Check the stored source to determine if this might be a legacy token
    console.log('\n   Checking token source...');
    if (originalCreds.source === 'native') {
      console.log('   → Token is from native OAuth but refresh failed');
      console.log('   → Token may be expired or revoked');
      console.log('   → Try re-authenticating with --login');
    } else if (originalCreds.source === 'cli') {
      console.log('   → Token is from Claude CLI (imported)');
      console.log('   → CLI tokens cannot be refreshed with our endpoints');
      console.log('   → Re-authenticate with --login to get native tokens');
    } else {
      console.log('   → Token source unknown (legacy or imported)');
      console.log('   → Re-authenticate with --login to get native tokens');
    }

    // Restore original credentials
    console.log('\n   Restoring original credentials...');
    await manager.setClaudeOAuthCredentials(originalCreds);

    console.log('\n=== TEST FAILED ===');
    process.exit(1);
  }
}

/**
 * Helper to prompt for user input
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Parse a time string like "5m", "30s", "1h" into milliseconds
 */
function parseTimeString(timeStr: string): number | null {
  const match = timeStr.match(/^(\d+)(s|m|h)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Set token to expired without triggering any refresh
 * This is for manual testing - start the app after to see migration behavior
 *
 * @param expiresIn - Optional: time until expiry (e.g., "5m", "30s"). If not provided, expires immediately.
 */
async function setExpired(expiresIn?: string) {
  console.log('=== Set Token Expiry (Manual Testing) ===\n');

  const manager = getCredentialManager();
  const creds = await manager.getClaudeOAuthCredentials();

  if (!creds?.accessToken) {
    console.error('No credentials found. Please authenticate first:');
    console.error('  bun run scripts/test-token-refresh.ts --login');
    process.exit(1);
  }

  console.log('Current credentials:');
  console.log(`  Access token:  ${creds.accessToken.substring(0, 20)}...`);
  console.log(`  Refresh token: ${creds.refreshToken?.substring(0, 20) || 'none'}...`);
  console.log(`  Expires at:    ${creds.expiresAt ? new Date(creds.expiresAt).toISOString() : 'not set'}`);
  console.log(`  Source:        ${creds.source || 'unknown'}`);

  let newExpiry: number;
  let expiryDescription: string;

  if (expiresIn) {
    const ms = parseTimeString(expiresIn);
    if (ms === null) {
      console.error(`\nInvalid time format: "${expiresIn}"`);
      console.error('Use format like: 5m, 30s, 1h');
      process.exit(1);
    }
    newExpiry = Date.now() + ms;
    expiryDescription = `in ${expiresIn}`;
  } else {
    // Default: expire 1 hour ago
    newExpiry = Date.now() - 60 * 60 * 1000;
    expiryDescription = '1 hour ago (already expired)';
  }

  console.log(`\nSetting expiry to ${expiryDescription}...`);
  await manager.setClaudeOAuthCredentials({
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: newExpiry,
    source: creds.source, // Preserve source
  });

  console.log(`  New expiry:    ${new Date(newExpiry).toISOString()}`);

  if (expiresIn) {
    console.log(`\n=== TOKEN WILL EXPIRE IN ${expiresIn.toUpperCase()} ===`);
    console.log('Start the app now, then wait for expiry and send a message.');
    console.log('The app should attempt to refresh the token when it expires.');
  } else {
    console.log('\n=== TOKEN NOW MARKED AS EXPIRED ===');
    console.log('Start the app to test migration/refresh behavior:');
    console.log('  bun run electron:dev');
  }
  console.log('\nVerify with:');
  console.log('  bun run scripts/test-token-refresh.ts --detect-origin');
}

/**
 * Login with Claude OAuth to get fresh tokens
 */
async function login() {
  console.log('=== Claude OAuth Login ===\n');
  console.log('OAuth config:');
  console.log(`  - Auth URL: ${CLAUDE_OAUTH_CONFIG.AUTH_URL}`);
  console.log(`  - Token URL: ${CLAUDE_OAUTH_CONFIG.TOKEN_URL}`);
  console.log(`  - Client ID: ${CLAUDE_OAUTH_CONFIG.CLIENT_ID}`);
  console.log('');

  console.log('1. Starting OAuth flow...');
  console.log('   Opening browser for authentication...\n');

  try {
    await startClaudeOAuth((status) => {
      console.log(`   ${status}`);
    });

    console.log('\n2. After authenticating, you will be redirected to a page with an authorization code.');
    console.log('   Copy the code from the URL or page and paste it below.\n');

    const code = await prompt('Enter authorization code: ');

    if (!code) {
      console.error('No code provided. Aborting.');
      process.exit(1);
    }

    console.log('\n3. Exchanging code for tokens...');

    const tokens = await exchangeClaudeCode(code, (status) => {
      console.log(`   ${status}`);
    });

    console.log('\n4. Saving credentials...');

    const manager = getCredentialManager();
    await manager.setClaudeOAuthCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      source: 'native', // Mark as obtained from our native OAuth flow
    });

    console.log('\n=== LOGIN SUCCESSFUL ===');
    console.log(`Access token:  ${tokens.accessToken.substring(0, 20)}...`);
    console.log(`Refresh token: ${tokens.refreshToken?.substring(0, 20) || 'none'}...`);
    console.log(`Expires at:    ${tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'not set'}`);
    console.log(`Scopes:        ${tokens.scopes?.join(', ') || 'default'}`);

    console.log('\nYou can now test token refresh:');
    console.log('  bun run scripts/test-token-refresh.ts --expire-now');
  } catch (error) {
    console.error('\nLogin failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes('--login')) {
    await login();
  } else if (process.argv.includes('--set-expired')) {
    // Check for time argument after --set-expired
    const idx = process.argv.indexOf('--set-expired');
    const timeArg = process.argv[idx + 1];
    // Only use timeArg if it doesn't start with -- (not another flag)
    const expiresIn = timeArg && !timeArg.startsWith('--') ? timeArg : undefined;
    await setExpired(expiresIn);
  } else if (process.argv.includes('--detect-origin')) {
    await testDetectOrigin();
  } else if (process.argv.includes('--test-legacy')) {
    await testLegacyRefresh();
  } else if (process.argv.includes('--test-migration')) {
    await testMigration();
  } else {
    await testRefresh();
  }
}

main().catch(console.error);
