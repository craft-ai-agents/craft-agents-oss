/**
 * Headless Bun entry point — runs the Craft Agent server without Electron.
 *
 * Usage:
 *   CRAFT_SERVER_TOKEN=<secret> bun run src/server/index.ts
 *
 * Environment:
 *   CRAFT_SERVER_TOKEN   — required unless options override in host bootstrap
 *   CRAFT_RPC_HOST       — bind address (default: 127.0.0.1)
 *   CRAFT_RPC_PORT       — bind port (default: 9100)
 *   CRAFT_APP_ROOT       — app root path (default: cwd)
 *   CRAFT_RESOURCES_PATH — resources path (default: cwd/resources)
 *   CRAFT_IS_PACKAGED    — 'true' for production (default: false)
 *   CRAFT_VERSION        — app version (default: 0.0.0-dev)
 *   CRAFT_DEBUG          — 'true' for debug logging
 */

process.env.CRAFT_IS_PACKAGED ??= 'false'

await import('./start.ts')
