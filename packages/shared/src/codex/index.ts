/**
 * Codex Module
 *
 * Provides the app-server client and related utilities for communicating
 * with the Codex backend via JSON-RPC.
 */

export { AppServerClient, type AppServerOptions, type AppServerEvents } from './app-server-client.ts';
export {
  generateCodexConfig,
  generateBridgeConfig,
  getCredentialCachePath,
  validateSlugForToml,
  type CodexConfigGeneratorOptions,
  type CodexConfigResult,
  type ConfigWarning,
  type CredentialCacheEntry,
} from './config-generator.ts';
export {
  resolveCodexBinary,
  getCodexPath,
  setVendorRoot,
  getVendorRoot,
} from './binary-resolver.ts';
export {
  writeBridgeSourceFiles,
  writeFileSecure,
} from './bridge-utils.ts';
