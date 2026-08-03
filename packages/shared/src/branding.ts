/**
 * packages/shared/src/branding.ts
 *
 * Single source of truth for all brand constants.
 * Every file that hardcodes the product name, app ID, executable, env prefix,
 * or repo URL should import from here instead.
 *
 * To rebrand: edit only this file, then run `bun run sync:branding` to patch
 * non-TypeScript config files (electron-builder.yml, Dockerfile.server, etc.).
 */

// ── Core identity ────────────────────────────────────────────────────────

/** Human-readable product name (title case) — used in window titles, menus, about dialog */
export const APP_NAME = 'ARCHstudio' as const;

/** SCREAMING_SNAKE version — for env vars like ARCHSTUDIO_APP_NAME, ARCHSTUDIO_* */
export const APP_NAME_UPPER = 'ARCHSTUDIO' as const;

/** Reverse-domain app ID — used by electron-builder, macOS bundle, Windows installer */
export const APP_ID = 'com.skobez.archstudio' as const;

/** Reverse-domain prefix (first two segments) — used for env-namespace derivations */
export const APP_ID_PREFIX = 'com.skobez' as const;

/** Executable / binary name — the name of the .app, .exe, or binary */
export const EXECUTABLE = 'ARCHstudio' as const;

// ── Environment ──────────────────────────────────────────────────────────

/** Env var that overrides the app name at runtime (e.g., "ARCHstudio [1]") */
export const ENV_APP_NAME = 'ARCHSTUDIO_APP_NAME' as const;

/** Env var prefix for all app-specific env vars */
export const ENV_PREFIX = 'CRAFT' as const;

/** Env var for the server token */
export const ENV_SERVER_TOKEN = 'ARCHSTUDIO_SERVER_TOKEN' as const;

/** Env var for the RPC host */
export const ENV_RPC_HOST = 'ARCHSTUDIO_RPC_HOST' as const;

/** Env var for the RPC port */
export const ENV_RPC_PORT = 'ARCHSTUDIO_RPC_PORT' as const;

// ── Repository ───────────────────────────────────────────────────────────

/** GitHub repo URL (without trailing slash) */
export const REPO_URL = 'https://github.com/skobe79/craft-agents-oss' as const;

/** GitHub repo name */
export const REPO_NAME = 'craft-agents-oss' as const;

/** GitHub org */
export const REPO_ORG = 'skobe79' as const;

/**
 * Short link shown in the app.
 *
 * Still points at the upstream project's site — replace with this project's
 * own URL once one exists. Currently unreferenced outside this module.
 */
export const SHORT_URL = 'https://craft.do' as const;

// ── Docker ───────────────────────────────────────────────────────────────

/** Docker image name (without tag) */
export const DOCKER_IMAGE_NAME = 'archstudio-server' as const;

/** Docker base user name */
export const DOCKER_USER = 'archstudio' as const;

/** Docker home directory */
export const DOCKER_HOME = '/home/archstudio' as const;

// ── UI ───────────────────────────────────────────────────────────────────

/** Display name for the "ARCHstudio Backend" provider group in the model picker */
export const GROUP_NAME = 'ARCHstudio Backend' as const;

/** Short label for the provider */
export const GROUP_LABEL_SHORT = 'ARCHstudio' as const;

// ── Viewer ───────────────────────────────────────────────────────────────

/**
 * Session viewer base URL.
 *
 * WARNING: this is upstream's hosted service. Sharing a session POSTs the
 * transcript to Craft Docs Ltd. infrastructure (see SessionManager
 * shareToViewer / updateShare / revokeShare). Point this at a self-hosted
 * apps/viewer deployment before relying on session sharing, or sharing will
 * publish user data to a third party.
 */
export const VIEWER_URL = 'https://agents.craft.do' as const;

// ── Logo ─────────────────────────────────────────────────────────────────

export const ARCHSTUDIO_LOGO = [
  '  ████████ █████████    ██████   ██████████ ██████████',
  '██████████ ██████████ ██████████ █████████  ██████████',
  '██████     ██████████ ██████████ ████████   ██████████',
  '██████████ ████████   ██████████ ███████      ██████  ',
  '  ████████ ████  ████ ████  ████ █████        ██████  ',
] as const;

/** Logo as a single string for HTML templates */
export const ARCHSTUDIO_LOGO_HTML = ARCHSTUDIO_LOGO.map((line) => line.trimEnd()).join('\n');
