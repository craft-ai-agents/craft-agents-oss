/**
 * Built-in Sources
 *
 * Bundled API source templates (Exa research, Firecrawl crawl) are seeded into
 * new workspaces under sources/{slug}/ so the normal UI/list path picks them up.
 * They always require an explicit opt-in; credentials come from env
 * (EXA_API_KEY / FIRECRAWL_API_KEY) or a future rox proxy.
 *
 * craft-agents-docs remains an always-available MCP server configured in
 * craft-agent.ts, not a folder source.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FolderSourceConfig, LoadedSource } from './types.ts';
import { toPortablePath } from '../utils/paths.ts';
import { estimateTokens } from '../utils/large-response.ts';

function sourcesDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'sources');
}

export const BUILTIN_SOURCE_SLUGS = ['exa', 'firecrawl'] as const;
export type BuiltinSourceSlug = (typeof BUILTIN_SOURCE_SLUGS)[number];

/** Source defaults that are usable without credentials, network access, or onboarding. */
export const DEFAULT_ENABLED_LOCAL_SOURCE_SLUGS = ['notes'] as const;

const EXA_ENV_KEYS = ['EXA_API_KEY', 'CRAFT_EXA_API_KEY', 'ROX_EXA_API_KEY'] as const;
const FIRECRAWL_ENV_KEYS = [
  'FIRECRAWL_API_KEY',
  'CRAFT_FIRECRAWL_API_KEY',
  'ROX_FIRECRAWL_API_KEY',
] as const;

function firstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function hasExaKey(): boolean {
  return !!firstEnv(EXA_ENV_KEYS);
}

export function hasFirecrawlKey(): boolean {
  return !!firstEnv(FIRECRAWL_ENV_KEYS);
}

function buildExaConfig(now: number): FolderSourceConfig {
  const keyed = hasExaKey();
  return {
    id: 'builtin-exa',
    name: 'Exa',
    slug: 'exa',
    enabled: false,
    provider: 'exa',
    type: 'api',
    api: {
      baseUrl: 'https://api.exa.ai',
      authType: 'header',
      headerName: 'x-api-key',
      testEndpoint: { method: 'POST', path: '/search', body: { query: 'test', numResults: 1 } },
    },
    tagline: 'Neural web search & research (Exa)',
    icon: '🔎',
    isAuthenticated: keyed,
    connectionStatus: keyed ? 'connected' : 'needs_auth',
    createdAt: now,
    updatedAt: now,
  };
}

function buildFirecrawlConfig(now: number): FolderSourceConfig {
  const keyed = hasFirecrawlKey();
  return {
    id: 'builtin-firecrawl',
    name: 'Firecrawl',
    slug: 'firecrawl',
    enabled: false,
    provider: 'firecrawl',
    type: 'api',
    api: {
      baseUrl: 'https://api.firecrawl.dev',
      authType: 'bearer',
      testEndpoint: { method: 'GET', path: '/v1/team/credit-usage' },
    },
    tagline: 'Crawl & extract clean page content (Firecrawl)',
    icon: '🔥',
    isAuthenticated: keyed,
    connectionStatus: keyed ? 'connected' : 'needs_auth',
    createdAt: now,
    updatedAt: now,
  };
}

const GUIDES: Record<BuiltinSourceSlug, string> = {
  exa: `---
description: Exa neural search
---

# Exa

Веб-поиск и research через [Exa](https://exa.ai).

## Auth

Задайте \`EXA_API_KEY\` (или \`CRAFT_EXA_API_KEY\` / \`ROX_EXA_API_KEY\`) в окружении
процесса / cloud-runs env. Без ключа источник виден, но требует авторизации.

## Типовые вызовы

- \`POST /search\` — neural / keyword search
- \`POST /contents\` — получить содержимое URL
- \`POST /findSimilar\` — похожие страницы

Используй для research-сессий и сбора источников. Не дублируй сырой HTML —
предпочитай summary + ссылки.
`,
  firecrawl: `---
description: Firecrawl page crawl
---

# Firecrawl

Краулинг и очистка веб-страниц через [Firecrawl](https://firecrawl.dev).

## Auth

Задайте \`FIRECRAWL_API_KEY\` (или \`CRAFT_FIRECRAWL_API_KEY\` / \`ROX_FIRECRAWL_API_KEY\`).

## Типовые вызовы

- \`POST /v1/scrape\` — одна страница → markdown
- \`POST /v1/crawl\` — сайт / раздел
- \`POST /v1/map\` — карта URL

Используй когда нужен чистый текст страницы, а не SERP-сниппеты.
`,
};

function writeSourceFolder(
  workspaceRootPath: string,
  config: FolderSourceConfig,
  guide: string,
): void {
  const dir = join(sourcesDir(workspaceRootPath), config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const configPath = join(dir, 'config.json');
  const guidePath = join(dir, 'guide.md');
  // Never overwrite user-edited configs.
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  }
  if (!existsSync(guidePath)) {
    writeFileSync(guidePath, guide, 'utf-8');
  }
}

function buildNotesSourceGuide(notesPath: string): string {
  return `# Notes vault

Workspace markdown notes live at:

${notesPath}

## Scope

Use this source when the user asks you to use their notes as context, search personal/work knowledge, update markdown notes, or create new notes.

## Guidelines

- Notes are plain markdown files under the path above.
- Use file tools to read, search, create, rename, and update notes in that folder.
- Preserve wiki links such as [[Note name]], markdown links, tags, YAML frontmatter, and asset references.
- Assets are stored under ${join(notesPath, 'assets')}.
- Daily notes are stored under ${join(notesPath, 'daily')}.
- When you mention a note in chat, prefer [[Note name]] or notes/path/to/note.md so the UI can open it directly.

## Context

This source is maintained automatically from the built-in Notes feature. It has no external API or authentication.
`;
}

/**
 * Create the generated local Notes source only when its config is absent.
 * An existing source config, including a disabled or custom one, is authoritative.
 */
export function ensureLocalNotesSource(workspaceRootPath: string, notesPath: string): void {
  const configPath = join(sourcesDir(workspaceRootPath), 'notes', 'config.json');
  if (existsSync(configPath)) return;

  mkdirSync(notesPath, { recursive: true });
  const now = Date.now();
  writeSourceFolder(workspaceRootPath, {
    id: 'notes-vault',
    name: 'Notes vault',
    slug: 'notes',
    enabled: true,
    provider: 'craft-notes',
    type: 'local',
    local: {
      path: toPortablePath(notesPath),
      format: 'craft-markdown',
    },
    icon: '📓',
    tagline: 'Markdown notes, backlinks, tags, properties, daily notes, and assets',
    isAuthenticated: true,
    connectionStatus: 'connected',
    createdAt: now,
    updatedAt: now,
  }, buildNotesSourceGuide(notesPath));
}

/**
 * Seed Exa + Firecrawl source folders when missing. Safe to call repeatedly.
 */
export function ensureBuiltinSources(workspaceRootPath: string): {
  created: BuiltinSourceSlug[];
} {
  const now = Date.now();
  const created: BuiltinSourceSlug[] = [];
  const rootSources = sourcesDir(workspaceRootPath);
  if (!existsSync(rootSources)) {
    mkdirSync(rootSources, { recursive: true });
  }

  for (const slug of BUILTIN_SOURCE_SLUGS) {
    const dir = join(rootSources, slug);
    const configPath = join(dir, 'config.json');
    if (existsSync(configPath)) continue;
    const config = slug === 'exa' ? buildExaConfig(now) : buildFirecrawlConfig(now);
    writeSourceFolder(workspaceRootPath, config, GUIDES[slug]);
    created.push(slug);
  }
  return { created };
}

/**
 * In-memory builtin sources (also mirrored on disk by ensureBuiltinSources).
 * Kept for loadAllSources / getSourcesBySlugs compatibility.
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  const now = Date.now();
  return [
    {
      workspaceId,
      workspaceRootPath,
      folderPath: join(sourcesDir(workspaceRootPath), 'exa'),
      config: buildExaConfig(now),
      guide: { raw: GUIDES.exa },
      isBuiltin: true,
    },
    {
      workspaceId,
      workspaceRootPath,
      folderPath: join(sourcesDir(workspaceRootPath), 'firecrawl'),
      config: buildFirecrawlConfig(now),
      guide: { raw: GUIDES.firecrawl },
      isBuiltin: true,
    },
  ];
}

/**
 * Placeholder for the always-available craft-agents-docs MCP server
 * (configured in craft-agent.ts, not a folder source). Kept for
 * getSourcesBySlugs('craft-agents-docs') callers.
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-craft-agents-docs',
    name: 'Craft Agents Docs',
    slug: 'craft-agents-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://agents.craft.do/docs/mcp',
      authType: 'none',
    },
    tagline: 'Search Craft Agents documentation and source setup guides',
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

export function isBuiltinSource(slug: string): boolean {
  return (BUILTIN_SOURCE_SLUGS as readonly string[]).includes(slug) || slug === 'craft-agents-docs';
}

/** Rough token estimate for a source guide / attached text (chars/4). */
export function estimateSourceGuideTokens(source: LoadedSource): number {
  const raw = source.guide?.raw ?? '';
  return estimateTokens(raw);
}

/** Format ≈N ток. label (locale-agnostic number, caller i18n wraps). */
export function formatTokenEstimate(tokens: number): string {
  if (tokens >= 1_000_000) return `≈${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `≈${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return `≈${tokens}`;
}

