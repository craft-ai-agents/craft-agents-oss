/**
 * Built-in Sources
 *
 * Project-level sources that ship with RunnerOS.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LoadedSource, FolderSourceConfig } from './types.ts';

const COMPUTER_USE_SLUG = 'computer-use';
const FIELD_THEORY_SLUG = 'field-theory';
const PRINTING_PRESS_SOCIAL_SLUG = 'printing-press-social';
const HYPERMOTION_SLUG = 'hypermotion';
const GOOGLE_ADS_SLUG = 'google-ads';
const YOUTUBE_RESEARCH_SLUG = 'youtube-research';
const OPEN_SLIDE_SLUG = 'open-slide';

function firstExistingPath(candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return resolve(candidate);
  }
  return resolve(candidates.find(Boolean) ?? fallback);
}

function getResourceScriptPath(scriptName: string): string {
  const scriptsRoot = process.env.CRAFT_SCRIPTS;
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      scriptsRoot ? join(scriptsRoot, scriptName) : '',
      resourcesBase ? join(resourcesBase, 'resources', 'scripts', scriptName) : '',
      join(appRoot, 'apps', 'electron', 'resources', 'scripts', scriptName),
      join(appRoot, 'resources', 'scripts', scriptName),
      join(process.cwd(), 'apps', 'electron', 'resources', 'scripts', scriptName),
    ],
    join('apps', 'electron', 'resources', 'scripts', scriptName)
  );
}

function getComputerUseScriptPath(): string {
  return getResourceScriptPath('background-computer-use-mcp.ts');
}

function getFieldTheoryScriptPath(): string {
  return getResourceScriptPath('field-theory-mcp.ts');
}

function getPrintingPressSocialPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'printing-press-social') : '',
      join(appRoot, 'tools', 'printing-press-social'),
      join(process.cwd(), 'tools', 'printing-press-social'),
    ],
    join('tools', 'printing-press-social')
  );
}

function getHypermotionPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'hypermotion') : '',
      join(appRoot, 'tools', 'hypermotion'),
      join(process.cwd(), 'tools', 'hypermotion'),
    ],
    join('tools', 'hypermotion')
  );
}

function getGoogleAdsPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'google-ads') : '',
      join(appRoot, 'tools', 'google-ads'),
      join(process.cwd(), 'tools', 'google-ads'),
    ],
    join('tools', 'google-ads')
  );
}

function getYouTubeResearchPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd();

  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'youtube-research') : '',
      join(appRoot, 'tools', 'youtube-research'),
      join(process.cwd(), 'tools', 'youtube-research'),
    ],
    join('tools', 'youtube-research')
  );
}

function getGoogleAdsCachedAuthState(): { configured: boolean; expired: boolean } {
  const cachePath = join(homedir(), '.config', 'runneros', 'google-ads', 'credentials.json');
  if (!existsSync(cachePath)) return { configured: false, expired: false };

  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    const configured = Boolean(
      typeof parsed.accessToken === 'string' && parsed.accessToken.trim()
      && typeof parsed.developerToken === 'string' && parsed.developerToken.trim()
    );
    const expired = typeof parsed.expiresAt === 'number' && Date.now() > parsed.expiresAt;
    return { configured, expired };
  } catch {
    return { configured: false, expired: false };
  }
}

function getYouTubeResearchCachedAuthState(): { configured: boolean } {
  const cachePath = join(homedir(), '.config', 'runneros', 'youtube-research', 'credentials.json');
  if (!existsSync(cachePath)) return { configured: false };

  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    return {
      configured: Boolean(typeof parsed.apiKey === 'string' && parsed.apiKey.trim()),
    };
  } catch {
    return { configured: false };
  }
}

/**
 * Get all built-in sources for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @returns Built-in project-tier sources
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  return [
    getComputerUseSource(workspaceId, workspaceRootPath),
    getFieldTheorySource(workspaceId, workspaceRootPath),
    getPrintingPressSocialSource(workspaceId, workspaceRootPath),
    getHypermotionSource(workspaceId, workspaceRootPath),
    getGoogleAdsSource(workspaceId, workspaceRootPath),
    getYouTubeResearchSource(workspaceId, workspaceRootPath),
    getOpenSlideSource(workspaceId, workspaceRootPath),
  ];
}

/**
 * Built-in source for the local BackgroundComputerUse runtime.
 *
 * It is globally available as a project source, but it only becomes part of a
 * session when an agent/session explicitly enables the `computer-use` source.
 */
export function getComputerUseSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-computer-use',
    name: 'Computer Use',
    slug: COMPUTER_USE_SLUG,
    enabled: true,
    provider: 'background-computer-use',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: process.env.CRAFT_BUN || 'bun',
      args: ['run', getComputerUseScriptPath()],
      authType: 'none',
    },
    tagline: 'Inspect and control local macOS app windows with screenshot-backed tools.',
    icon: '🖥️',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Computer Use',
        '',
        'Use this source when the user explicitly wants a local desktop app controlled or inspected.',
        '',
        'Workflow:',
        '1. Call `computer_use_status` first.',
        '2. Call `computer_use_list_apps` and `computer_use_list_windows` to find the target.',
        '3. Call `computer_use_observe_window` before every meaningful UI action.',
        '4. Prefer semantic targets from the observed accessibility tree. Use coordinates only when needed.',
        '5. Ask the user before submit, send, purchase, delete, credential entry, or any irreversible action.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for Field Theory local X/Twitter bookmarks and Library notes.
 *
 * This source intentionally exposes read/search tools only. Sync, auth,
 * mutation, and Library write operations stay out of the agent tool surface.
 */
export function getFieldTheorySource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const config: FolderSourceConfig = {
    id: 'builtin-field-theory',
    name: 'Field Theory',
    slug: FIELD_THEORY_SLUG,
    enabled: true,
    provider: 'field-theory',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      command: process.env.CRAFT_BUN || 'bun',
      args: ['run', getFieldTheoryScriptPath()],
      authType: 'none',
    },
    tagline: 'Search local X/Twitter bookmarks, Library notes, and portable commands.',
    icon: '🔖',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config,
    guide: {
      raw: [
        '# Field Theory',
        '',
        'Use this source when the user mentions Field Theory, X/Twitter bookmarks, saved tweets, Library notes, or portable commands.',
        '',
        'Use read-only tools only:',
        '- `field_theory_status` and `field_theory_stats` for setup and archive overview.',
        '- `field_theory_search_bookmarks`, `field_theory_list_bookmarks`, and `field_theory_show_bookmark` for saved X/Twitter posts.',
        '- `field_theory_search_library` and `field_theory_show_library_page` for durable local notes.',
        '- `field_theory_list_commands` and `field_theory_show_command` for portable command context.',
        '',
        'Do not dump raw results. Summarize findings and connect them to the user’s current task.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for bundled direct-browser social media CLIs.
 *
 * This is intentionally a local CLI source, not MCP/API. Live account setup
 * still belongs to the user because Instagram/TikTok/X/YouTube sessions cannot
 * be pre-shipped.
 */
export function getPrintingPressSocialSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getPrintingPressSocialPath();
  const config: FolderSourceConfig = {
    id: 'builtin-printing-press-social',
    name: 'Printing Press Social',
    slug: PRINTING_PRESS_SOCIAL_SLUG,
    enabled: true,
    provider: 'printing-press-clis',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Direct-browser CLIs for Instagram, TikTok, X, and YouTube channel work.',
    icon: '📣',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Printing Press Social tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Printing Press Social',
        '',
        'Use this source for agent-operated social channel work through the bundled local CLI harness.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node src/social.mjs doctor --json` before channel work.',
        '3. Run `node src/social.mjs doctor --live --json` before claiming a profile is ready.',
        '4. Default engine is `runner-cdp`: use CLI output as the action contract/plan, then execute through Runner native browser tools.',
        '5. Dry-run posts, comments, and DMs with `--dry-run --json` before live execution.',
        '6. Ask for explicit approval before any live post, comment, or DM.',
        '',
        'Supported platforms: instagram, tiktok, x, youtube.',
        'Do not use Computer Use for these flows unless the user explicitly asks. Prefer Runner browser/CDP tools; Playwright is fallback-only.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the managed Hypermotion wrapper.
 *
 * This is a local CLI source that gives agents a portable path to the bundled
 * HyperFrames/Remotion toolchain in dev and packaged Electron builds.
 */
export function getHypermotionSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getHypermotionPath();
  const config: FolderSourceConfig = {
    id: 'builtin-hypermotion',
    name: 'Hypermotion',
    slug: HYPERMOTION_SLUG,
    enabled: true,
    provider: 'hypermotion',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    tagline: 'Managed HyperFrames and Remotion CLI wrapper for motion/video artifacts.',
    icon: '🎬',
    isAuthenticated: true,
    connectionStatus: existsSync(toolPath) ? 'connected' : 'failed',
    connectionError: existsSync(toolPath) ? undefined : 'Bundled Hypermotion tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Hypermotion',
        '',
        'Use this source for motion graphics, HyperFrames HTML/GSAP compositions, Remotion/React video, and Canvas-ready MP4 artifacts.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the tool directory.',
        '2. Run `node bin/hypermotion.mjs doctor` before production work.',
        '3. Create isolated project folders with `node bin/hypermotion.mjs init <workspace-local-dir> --engine hyperframes|remotion`.',
        '4. Render with `node bin/hypermotion.mjs render <dir> --engine hyperframes|remotion --out out/<name>.mp4`.',
        '5. Publish generated HTML previews, poster frames, MP4s, and receipts as Canvas-visible outputs when useful.',
        '',
        'Do not claim a render succeeded until the output file exists. Confirm before paid API/provider calls or long renders.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the bundled Google Ads CLI wrapper.
 *
 * The wrapper resolves the packaged google-ads-pp-cli binary from app
 * resources, so agents do not depend on a developer-machine global install.
 */
export function getGoogleAdsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getGoogleAdsPath();
  const authState = getGoogleAdsCachedAuthState();
  const isAuthenticated = authState.configured && !authState.expired;
  const config: FolderSourceConfig = {
    id: 'builtin-google-ads',
    name: 'Google Ads',
    slug: GOOGLE_ADS_SLUG,
    enabled: true,
    provider: 'google',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    api: {
      baseUrl: 'https://googleads.googleapis.com',
      authType: 'oauth',
      googleScopes: [
        'https://www.googleapis.com/auth/adwords',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    },
    tagline: 'Bundled Google Ads CLI for account discovery, GAQL reporting, diagnostics, and approval-gated operations.',
    icon: 'G',
    isAuthenticated,
    connectionStatus: !existsSync(toolPath) ? 'failed' : isAuthenticated ? 'connected' : 'needs_auth',
    connectionError: !existsSync(toolPath)
      ? 'Bundled Google Ads tool folder not found'
      : authState.expired
        ? 'Google Ads OAuth token is expired. Reconnect Google Ads.'
        : undefined,
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# Google Ads',
        '',
        'Use this source for Google Ads account discovery, GAQL reporting, field lookup, diagnostics, and planning through the bundled local CLI wrapper.',
        '',
        'Workflow:',
        '1. Use the displayed local path as the working directory.',
        '2. Run `node bin/google-ads.mjs doctor --agent` before account work.',
        '3. Run `node bin/google-ads.mjs auth status --agent` to check auth.',
        '4. Use read-only commands first: `customers list-accessible-customers`, `google-ads-fields search`, and `customers-google-ads search`.',
        '5. Use real hyphenated command names. Convert any upstream underscore examples to hyphen form before executing.',
        '6. Ask for explicit approval before any live mutation to campaigns, budgets, keywords, audiences, conversions, billing, or status.',
        '',
        'Google Ads auth is separate from Meta Ads auth. If auth is missing, tell the user it needs OAuth login or configured Google Ads credentials.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the bundled YouTube Research CLI wrapper.
 */
export function getYouTubeResearchSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const toolPath = getYouTubeResearchPath();
  const authState = getYouTubeResearchCachedAuthState();
  const config: FolderSourceConfig = {
    id: 'builtin-youtube-research',
    name: 'YouTube Research',
    slug: YOUTUBE_RESEARCH_SLUG,
    enabled: true,
    provider: 'youtube-data-api',
    type: 'local',
    local: {
      path: toolPath,
      format: 'cli-tool',
    },
    api: {
      baseUrl: 'https://www.googleapis.com/youtube/v3',
      authType: 'header',
      headerName: 'X-Goog-Api-Key',
    },
    tagline: 'Read-only YouTube search, transcripts, embeds, comments, related videos, and channel uploads.',
    icon: 'Y',
    isAuthenticated: authState.configured,
    connectionStatus: !existsSync(toolPath) ? 'failed' : authState.configured ? 'untested' : 'needs_auth',
    connectionError: existsSync(toolPath)
      ? authState.configured
        ? 'YouTube Data API key is saved but not validated. Run `node bin/youtube-research.mjs doctor` before research.'
        : undefined
      : 'Bundled YouTube Research tool folder not found',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: toolPath,
    config,
    guide: {
      raw: [
        '# YouTube Research',
        '',
        'Use this source for read-only YouTube discovery and analysis through the bundled youtube-pp-cli wrapper.',
        '',
        'Workflow:',
        '1. Open Tools -> YouTube Research and save a YouTube Data API key.',
        '2. Run `node bin/youtube-research.mjs doctor` before research work.',
        '3. Use `--agent` for compact JSON and `--select` to keep output tight.',
        '4. Use Social Publisher instead for uploads, posting, or live comments.',
        '',
        'Core commands:',
        '- `node bin/youtube-research.mjs youtube search-list --q "<query>" --max-results 5 --agent`',
        '- `node bin/youtube-research.mjs youtube search-bulk "<query one>" "<query two>" --top 3 --agent`',
        '- `node bin/youtube-research.mjs youtube videos-transcript <videoId> --lang en --agent`',
        '- `node bin/youtube-research.mjs youtube videos-embed <videoId> --format markdown`',
        '- `node bin/youtube-research.mjs youtube videos-comments <videoId> --top 10 --agent`',
        '- `node bin/youtube-research.mjs youtube channel-uploads @handle --top 10 --agent`',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Built-in source for the open-slide deck framework.
 *
 * Each workspace gets its own decks folder at `<workspaceRoot>/decks/`.
 * Decks are scaffolded on demand via `npx @open-slide/cli init <deck-id>`.
 * Once installed (per deck), the `open-slide` bin handles dev, build, and preview.
 *
 * No credentials, no API keys, no external services — entirely local OSS (MIT).
 */
export function getOpenSlideSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const decksPath = workspaceRootPath ? join(workspaceRootPath, 'decks') : 'decks';
  const config: FolderSourceConfig = {
    id: 'builtin-open-slide',
    name: 'Open Slide',
    slug: OPEN_SLIDE_SLUG,
    enabled: true,
    provider: 'open-slide',
    type: 'local',
    local: {
      path: decksPath,
      format: 'cli-tool',
    },
    tagline: 'React-based slide decks authored by the agent and exported to in-app HTML/PDF.',
    icon: '🎞️',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: decksPath,
    config,
    guide: {
      raw: [
        '# Open Slide',
        '',
        'Use this source to create, edit, and export React-based slide decks (open-slide framework).',
        'Decks live per-workspace at `<workspace>/decks/<deck-id>/`. No API keys; pure local CLI.',
        '',
        '## First-run setup (per deck)',
        '',
        '1. From `<workspace>/decks/`, scaffold a deck: `npx -y @open-slide/cli@latest init <deck-id> --name <deck-id>`.',
        '2. `cd <deck-id>` and install deps: `pnpm install` (or `npm install` if pnpm is unavailable).',
        '3. The deck is ready. Author slides at `slides/<page-id>/index.tsx`.',
        '',
        '## CLI inside a deck',
        '',
        '- `npx open-slide dev` — start the local dev server (default :5173).',
        '- `npx open-slide build --out-dir dist` — build a static site to `dist/`.',
        '- `npx open-slide preview` — preview the production build.',
        '',
        '## Authoring rules (1920x1080 canvas)',
        '',
        '- Slides are `Page` components, default-exported as an array from `slides/<id>/index.tsx`.',
        '- Each slide renders into a fixed 1920x1080 canvas; the framework scales for the viewport.',
        '- Read the scaffolded `.claude/skills/slide-authoring/` reference before writing slide layouts.',
        '',
        '## In-app preview',
        '',
        'After `open-slide build`, publish the generated `dist/index.html` (or zipped `dist/`) as a workspace Output with `showInCanvas: true`. The Visual sidecar will render the static deck inline. Re-build and re-publish to refresh the preview.',
        '',
        'For interactive editing, start `open-slide dev` and load `http://localhost:<port>` in a browser surface; stop the dev server when done.',
        '',
        '## Hard rules',
        '',
        '- Never commit secrets, API keys, or analytics IDs into a deck.',
        '- Do not deploy/publish to external hosts (Vercel, Netlify, etc.) without explicit user approval of the target.',
        '- Keep deck folders flat under `<workspace>/decks/`; do not nest decks.',
      ].join('\n'),
    },
    isBuiltin: true,
  };
}

/**
 * Get the built-in Runner docs source.
 *
 * @deprecated docs are now provided by an optional configured MCP server
 * configured directly in craft-agent.ts. This function is kept for
 * backwards compatibility but returns a placeholder.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  // Return a placeholder - this shouldn't be called anymore
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-runner-docs',
    name: 'Runner Docs',
    slug: 'runner-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: process.env.RUNNER_DOCS_MCP_URL?.trim() || '',
      authType: 'none',
    },
    tagline: 'Search Runner documentation and source setup guides',
    icon: '📚',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: placeholderConfig,
    guide: { raw: '' },
    isBuiltin: true,
  };
}

/**
 * Check if a source slug is a built-in source.
 *
 * @param slug - Source slug to check
 * @returns true when the slug is reserved by a built-in source
 */
export function isBuiltinSource(slug: string): boolean {
  return slug === COMPUTER_USE_SLUG
    || slug === FIELD_THEORY_SLUG
    || slug === PRINTING_PRESS_SOCIAL_SLUG
    || slug === HYPERMOTION_SLUG
    || slug === GOOGLE_ADS_SLUG
    || slug === YOUTUBE_RESEARCH_SLUG
    || slug === OPEN_SLIDE_SLUG;
}
