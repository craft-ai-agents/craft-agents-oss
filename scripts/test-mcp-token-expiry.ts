#!/usr/bin/env bun
/**
 * Test MCP OAuth Token Expiry
 *
 * This script checks OAuth token expiry for MCP sources.
 *
 * Usage:
 *   bun run scripts/test-mcp-token-expiry.ts                    # List all source tokens
 *   bun run scripts/test-mcp-token-expiry.ts [source-slug]      # Check specific source
 *   bun run scripts/test-mcp-token-expiry.ts --set-expired [source-slug] [time]  # Set expiry
 *   bun run scripts/test-mcp-token-expiry.ts --refresh [source-slug]   # Test refresh
 *
 * Examples:
 *   bun run scripts/test-mcp-token-expiry.ts craft-space        # Check craft-space token
 *   bun run scripts/test-mcp-token-expiry.ts --set-expired craft-space 5m   # Expire in 5 minutes
 *   bun run scripts/test-mcp-token-expiry.ts --set-expired craft-space      # Expire immediately
 *   bun run scripts/test-mcp-token-expiry.ts --refresh craft-space          # Test token refresh
 */

import { getCredentialManager, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials';
import { getSourceCredentialManager, type SourceCredentialManager } from '@craft-agent/shared/sources';
import { loadWorkspaceConfig, loadSourceConfig } from '@craft-agent/shared/sources';
import * as path from 'path';
import * as fs from 'fs';

const CRAFT_AGENT_DIR = path.join(process.env.HOME || '', '.craft-agent');
const WORKSPACES_DIR = path.join(CRAFT_AGENT_DIR, 'workspaces');

interface TokenInfo {
  sourceSlug: string;
  workspaceId: string;
  credentialType: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  tokenType?: string;
  isExpired: boolean;
  needsRefresh: boolean;
  expiresIn?: string;
}

/**
 * Format time duration for display
 */
function formatDuration(ms: number): string {
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Parse a time string like "5m", "30s", "1h" into milliseconds
 */
function parseTimeString(timeStr: string): number | null {
  const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

/**
 * Get all workspace IDs
 */
function getWorkspaceIds(): string[] {
  if (!fs.existsSync(WORKSPACES_DIR)) return [];

  return fs.readdirSync(WORKSPACES_DIR)
    .filter(name => {
      const stat = fs.statSync(path.join(WORKSPACES_DIR, name));
      return stat.isDirectory();
    });
}

/**
 * Get all source slugs for a workspace
 */
function getSourceSlugs(workspaceId: string): string[] {
  const sourcesDir = path.join(WORKSPACES_DIR, workspaceId, 'sources');
  if (!fs.existsSync(sourcesDir)) return [];

  return fs.readdirSync(sourcesDir)
    .filter(name => {
      const configPath = path.join(sourcesDir, name, 'config.json');
      return fs.existsSync(configPath);
    });
}

/**
 * Load all source credentials and check their status
 */
async function getAllTokenInfo(): Promise<TokenInfo[]> {
  const manager = getCredentialManager();
  const results: TokenInfo[] = [];

  // Get all credentials
  const allCredentials = await manager.list();

  // Filter to source credentials
  const sourceCredentials = allCredentials.filter(
    (id): id is CredentialId & { workspaceId: string; sourceId: string } =>
      id.type.startsWith('source_') && 'workspaceId' in id && 'sourceId' in id
  );

  for (const credId of sourceCredentials) {
    const cred = await manager.get(credId);
    if (!cred?.value) continue;

    const now = Date.now();
    const isExpired = cred.expiresAt ? now > cred.expiresAt : false;
    const needsRefresh = cred.expiresAt ? now > cred.expiresAt - 5 * 60 * 1000 : false;
    const expiresIn = cred.expiresAt
      ? (cred.expiresAt > now
          ? `in ${formatDuration(cred.expiresAt - now)}`
          : `${formatDuration(now - cred.expiresAt)} ago`)
      : undefined;

    results.push({
      sourceSlug: credId.sourceId,
      workspaceId: credId.workspaceId,
      credentialType: credId.type,
      accessToken: cred.value,
      refreshToken: cred.refreshToken,
      expiresAt: cred.expiresAt,
      clientId: cred.clientId,
      tokenType: cred.tokenType,
      isExpired,
      needsRefresh,
      expiresIn,
    });
  }

  return results;
}

/**
 * Get token info for a specific source
 */
async function getTokenInfoForSource(sourceSlug: string): Promise<TokenInfo | null> {
  const allTokens = await getAllTokenInfo();
  return allTokens.find(t => t.sourceSlug === sourceSlug) || null;
}

/**
 * List all source tokens
 */
async function listAllTokens() {
  console.log('=== MCP OAuth Token Status ===\n');

  const tokens = await getAllTokenInfo();

  if (tokens.length === 0) {
    console.log('No source credentials found.');
    console.log('\nTo authenticate a source:');
    console.log('  1. Enable the source in Craft Agent');
    console.log('  2. Trigger OAuth authentication');
    return;
  }

  // Group by status
  const expired = tokens.filter(t => t.isExpired);
  const needsRefresh = tokens.filter(t => !t.isExpired && t.needsRefresh);
  const valid = tokens.filter(t => !t.isExpired && !t.needsRefresh);

  // Print summary
  console.log(`Found ${tokens.length} source credential(s):\n`);

  if (expired.length > 0) {
    console.log('❌ EXPIRED:');
    for (const token of expired) {
      console.log(`   ${token.sourceSlug} (${token.workspaceId})`);
      console.log(`      Type: ${token.credentialType}`);
      console.log(`      Expired: ${token.expiresIn}`);
      console.log(`      Has refresh token: ${token.refreshToken ? 'yes' : 'no'}`);
    }
    console.log('');
  }

  if (needsRefresh.length > 0) {
    console.log('⚠️  NEEDS REFRESH (within 5 min):');
    for (const token of needsRefresh) {
      console.log(`   ${token.sourceSlug} (${token.workspaceId})`);
      console.log(`      Type: ${token.credentialType}`);
      console.log(`      Expires: ${token.expiresIn}`);
      console.log(`      Has refresh token: ${token.refreshToken ? 'yes' : 'no'}`);
    }
    console.log('');
  }

  if (valid.length > 0) {
    console.log('✅ VALID:');
    for (const token of valid) {
      console.log(`   ${token.sourceSlug} (${token.workspaceId})`);
      console.log(`      Type: ${token.credentialType}`);
      if (token.expiresAt) {
        console.log(`      Expires: ${token.expiresIn}`);
      } else {
        console.log(`      Expires: never (no expiry set)`);
      }
      console.log(`      Has refresh token: ${token.refreshToken ? 'yes' : 'no'}`);
    }
    console.log('');
  }

  // Print detailed info
  console.log('─'.repeat(60));
  console.log('\nDetailed token info:');
  for (const token of tokens) {
    console.log(`\n[${token.sourceSlug}]`);
    console.log(`  Workspace:     ${token.workspaceId}`);
    console.log(`  Cred type:     ${token.credentialType}`);
    console.log(`  Access token:  ${token.accessToken.substring(0, 20)}...`);
    console.log(`  Refresh token: ${token.refreshToken ? token.refreshToken.substring(0, 20) + '...' : 'none'}`);
    console.log(`  Client ID:     ${token.clientId || 'none'}`);
    console.log(`  Token type:    ${token.tokenType || 'Bearer'}`);
    console.log(`  Expires at:    ${token.expiresAt ? new Date(token.expiresAt).toISOString() : 'not set'}`);
    console.log(`  Status:        ${token.isExpired ? '❌ EXPIRED' : token.needsRefresh ? '⚠️  NEEDS REFRESH' : '✅ VALID'}`);
  }
}

/**
 * Check a specific source
 */
async function checkSource(sourceSlug: string) {
  console.log(`=== Token Status for: ${sourceSlug} ===\n`);

  const token = await getTokenInfoForSource(sourceSlug);

  if (!token) {
    console.log(`No credentials found for source: ${sourceSlug}`);
    console.log('\nAvailable sources with credentials:');
    const allTokens = await getAllTokenInfo();
    if (allTokens.length === 0) {
      console.log('  (none)');
    } else {
      for (const t of allTokens) {
        console.log(`  - ${t.sourceSlug}`);
      }
    }
    return;
  }

  const statusIcon = token.isExpired ? '❌' : token.needsRefresh ? '⚠️' : '✅';
  const statusText = token.isExpired ? 'EXPIRED' : token.needsRefresh ? 'NEEDS REFRESH' : 'VALID';

  console.log(`Status: ${statusIcon} ${statusText}`);
  console.log('');
  console.log('Credential details:');
  console.log(`  Workspace:     ${token.workspaceId}`);
  console.log(`  Cred type:     ${token.credentialType}`);
  console.log(`  Access token:  ${token.accessToken.substring(0, 30)}...`);
  console.log(`  Refresh token: ${token.refreshToken ? token.refreshToken.substring(0, 30) + '...' : 'none'}`);
  console.log(`  Client ID:     ${token.clientId || 'none'}`);
  console.log(`  Token type:    ${token.tokenType || 'Bearer'}`);
  console.log('');
  console.log('Expiry info:');
  console.log(`  Expires at:    ${token.expiresAt ? new Date(token.expiresAt).toISOString() : 'not set'}`);
  if (token.expiresAt) {
    console.log(`  Expires:       ${token.expiresIn}`);
    console.log(`  Is expired:    ${token.isExpired ? 'YES' : 'no'}`);
    console.log(`  Needs refresh: ${token.needsRefresh ? 'YES' : 'no'}`);
  }

  console.log('\n─'.repeat(60));
  console.log('\nNext steps:');
  if (token.isExpired) {
    if (token.refreshToken) {
      console.log('  Token is expired. Try refreshing:');
      console.log(`    bun run scripts/test-mcp-token-expiry.ts --refresh ${sourceSlug}`);
    } else {
      console.log('  Token is expired and has no refresh token.');
      console.log('  Re-authenticate the source in Craft Agent.');
    }
  } else if (token.needsRefresh) {
    console.log('  Token needs refresh (expires within 5 minutes).');
    console.log(`  Test refresh: bun run scripts/test-mcp-token-expiry.ts --refresh ${sourceSlug}`);
  } else {
    console.log('  Token is valid.');
    console.log(`  To simulate expiry: bun run scripts/test-mcp-token-expiry.ts --set-expired ${sourceSlug}`);
  }
}

/**
 * Set token to expired
 */
async function setExpired(sourceSlug: string, expiresIn?: string) {
  console.log(`=== Set Token Expiry: ${sourceSlug} ===\n`);

  const token = await getTokenInfoForSource(sourceSlug);

  if (!token) {
    console.error(`No credentials found for source: ${sourceSlug}`);
    process.exit(1);
  }

  const manager = getCredentialManager();
  const credId: CredentialId = {
    type: token.credentialType as CredentialId['type'],
    workspaceId: token.workspaceId,
    sourceId: token.sourceSlug,
  };

  const cred = await manager.get(credId);
  if (!cred) {
    console.error('Failed to load credential');
    process.exit(1);
  }

  console.log('Current state:');
  console.log(`  Access token:  ${cred.value.substring(0, 20)}...`);
  console.log(`  Expires at:    ${cred.expiresAt ? new Date(cred.expiresAt).toISOString() : 'not set'}`);
  console.log(`  Status:        ${token.isExpired ? 'EXPIRED' : token.needsRefresh ? 'NEEDS REFRESH' : 'VALID'}`);

  let newExpiry: number;
  let expiryDescription: string;

  if (expiresIn) {
    const ms = parseTimeString(expiresIn);
    if (ms === null) {
      console.error(`\nInvalid time format: "${expiresIn}"`);
      console.error('Use format like: 5m, 30s, 1h, 1d');
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

  await manager.set(credId, {
    ...cred,
    expiresAt: newExpiry,
  });

  console.log(`  New expiry:    ${new Date(newExpiry).toISOString()}`);

  if (expiresIn) {
    console.log(`\n=== TOKEN WILL EXPIRE IN ${expiresIn.toUpperCase()} ===`);
    console.log('Start the app and send a message after expiry to test refresh.');
  } else {
    console.log('\n=== TOKEN NOW MARKED AS EXPIRED ===');
    console.log('Start the app to test refresh behavior.');
  }

  console.log('\nVerify with:');
  console.log(`  bun run scripts/test-mcp-token-expiry.ts ${sourceSlug}`);
}

/**
 * Test token refresh
 */
async function testRefresh(sourceSlug: string) {
  console.log(`=== Test Token Refresh: ${sourceSlug} ===\n`);

  // Find the source across all workspaces
  const token = await getTokenInfoForSource(sourceSlug);

  if (!token) {
    console.error(`No credentials found for source: ${sourceSlug}`);
    process.exit(1);
  }

  if (!token.refreshToken) {
    console.error('Source has no refresh token. Cannot refresh.');
    console.log('\nYou need to re-authenticate the source to get a refresh token.');
    process.exit(1);
  }

  console.log('Current token:');
  console.log(`  Access token:  ${token.accessToken.substring(0, 20)}...`);
  console.log(`  Refresh token: ${token.refreshToken.substring(0, 20)}...`);
  console.log(`  Expires at:    ${token.expiresAt ? new Date(token.expiresAt).toISOString() : 'not set'}`);
  console.log(`  Status:        ${token.isExpired ? 'EXPIRED' : token.needsRefresh ? 'NEEDS REFRESH' : 'VALID'}`);

  // Load source config to get MCP URL
  const workspaceRootPath = path.join(WORKSPACES_DIR, token.workspaceId);
  const sourceConfig = loadSourceConfig(workspaceRootPath, sourceSlug);

  if (!sourceConfig) {
    console.error(`\nFailed to load source config for ${sourceSlug}`);
    process.exit(1);
  }

  console.log('\nSource config:');
  console.log(`  Type:     ${sourceConfig.type}`);
  console.log(`  Provider: ${sourceConfig.provider || 'none'}`);
  if (sourceConfig.type === 'mcp' && sourceConfig.mcp?.url) {
    console.log(`  MCP URL:  ${sourceConfig.mcp.url}`);
  }

  // Create a mock LoadedSource for the credential manager
  const loadedSource = {
    config: sourceConfig,
    workspaceId: token.workspaceId,
    workspaceRootPath,
    sourcePath: path.join(workspaceRootPath, 'sources', sourceSlug),
  };

  console.log('\nAttempting token refresh...');

  const sourceCredManager = getSourceCredentialManager();

  try {
    const newToken = await sourceCredManager.refresh(loadedSource);

    if (newToken) {
      console.log('\n✅ REFRESH SUCCESSFUL!');
      console.log(`  New access token: ${newToken.substring(0, 20)}...`);

      // Get updated credential info
      const updatedToken = await getTokenInfoForSource(sourceSlug);
      if (updatedToken) {
        console.log(`  New expires at:   ${updatedToken.expiresAt ? new Date(updatedToken.expiresAt).toISOString() : 'not set'}`);
        console.log(`  New status:       ${updatedToken.isExpired ? 'EXPIRED' : updatedToken.needsRefresh ? 'NEEDS REFRESH' : 'VALID'}`);
      }
    } else {
      console.log('\n❌ REFRESH FAILED');
      console.log('  Token refresh returned null.');
      console.log('  Check the source configuration and try re-authenticating.');
    }
  } catch (error) {
    console.error('\n❌ REFRESH ERROR:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await listAllTokens();
    return;
  }

  if (args[0] === '--set-expired') {
    const sourceSlug = args[1];
    const timeArg = args[2];

    if (!sourceSlug) {
      console.error('Usage: --set-expired <source-slug> [time]');
      console.error('Example: --set-expired craft-space 5m');
      process.exit(1);
    }

    await setExpired(sourceSlug, timeArg);
    return;
  }

  if (args[0] === '--refresh') {
    const sourceSlug = args[1];

    if (!sourceSlug) {
      console.error('Usage: --refresh <source-slug>');
      console.error('Example: --refresh craft-space');
      process.exit(1);
    }

    await testRefresh(sourceSlug);
    return;
  }

  if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
MCP OAuth Token Expiry Test

Usage:
  bun run scripts/test-mcp-token-expiry.ts                         # List all tokens
  bun run scripts/test-mcp-token-expiry.ts <source-slug>           # Check specific source
  bun run scripts/test-mcp-token-expiry.ts --set-expired <slug> [time]  # Set expiry
  bun run scripts/test-mcp-token-expiry.ts --refresh <slug>        # Test refresh

Options:
  --set-expired <slug> [time]   Set token expiry for source
                                Time format: 5m, 30s, 1h, 1d
                                No time = immediate expiry

  --refresh <slug>              Test token refresh for source

Examples:
  # List all source tokens and their status
  bun run scripts/test-mcp-token-expiry.ts

  # Check specific source
  bun run scripts/test-mcp-token-expiry.ts craft-space

  # Set token to expire in 5 minutes
  bun run scripts/test-mcp-token-expiry.ts --set-expired craft-space 5m

  # Set token to expire immediately
  bun run scripts/test-mcp-token-expiry.ts --set-expired craft-space

  # Test token refresh
  bun run scripts/test-mcp-token-expiry.ts --refresh craft-space
`);
    return;
  }

  // Assume it's a source slug
  await checkSource(args[0]);
}

main().catch(console.error);
