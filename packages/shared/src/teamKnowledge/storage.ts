/**
 * Team Knowledge Storage
 *
 * Filesystem-based storage for team knowledge configurations.
 * Config is stored at {workspaceRootPath}/teamKnowledge/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TeamKnowledgeConfig, TeamKnowledgeEntry } from './types.ts';
import {
  DEFAULT_TEAM_KNOWLEDGE_CONFIG,
  TEAM_KNOWLEDGE_CONFIG_VERSION,
  STALE_TTL_MS,
} from './types.ts';

const TEAM_KNOWLEDGE_DIR = 'teamKnowledge';
const TEAM_KNOWLEDGE_CONFIG_FILE = 'teamKnowledge/config.json';

/**
 * Get default team knowledge configuration
 */
export function getDefaultTeamKnowledgeConfig(): TeamKnowledgeConfig {
  return {
    version: TEAM_KNOWLEDGE_CONFIG_VERSION,
    enabled: false,
    documents: [],
  };
}

/**
 * Load workspace team knowledge configuration.
 * Returns defaults and creates config file if none exists.
 */
export function loadTeamKnowledgeConfig(workspaceRootPath: string): TeamKnowledgeConfig {
  const configPath = join(workspaceRootPath, TEAM_KNOWLEDGE_CONFIG_FILE);

  if (!existsSync(configPath)) {
    const defaults = getDefaultTeamKnowledgeConfig();
    saveTeamKnowledgeConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as TeamKnowledgeConfig;
  } catch (error) {
    console.warn('[loadTeamKnowledgeConfig] Failed to parse config, returning defaults:', error);
    return getDefaultTeamKnowledgeConfig();
  }
}

/**
 * Save workspace team knowledge configuration to disk.
 */
export function saveTeamKnowledgeConfig(
  workspaceRootPath: string,
  config: TeamKnowledgeConfig,
): void {
  const dir = join(workspaceRootPath, TEAM_KNOWLEDGE_DIR);
  const configPath = join(workspaceRootPath, TEAM_KNOWLEDGE_CONFIG_FILE);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get valid (non-stale) team knowledge entries for trigger/prefetch use.
 * Excludes entries that:
 *   - Have no content cached (never fetched)
 *   - Are past their staleAt threshold (older than 24h since last fetch)
 * Returns entries sorted by priority (ascending).
 */
export function getValidKnowledgeEntries(
  workspaceRootPath: string,
): TeamKnowledgeEntry[] {
  const config = loadTeamKnowledgeConfig(workspaceRootPath);

  if (!config.enabled || config.documents.length === 0) {
    return [];
  }

  const now = Date.now();
  const entries: TeamKnowledgeEntry[] = [];

  for (const doc of config.documents) {
    if (!doc.content || !doc.contentHash || !doc.lastFetchedAt) {
      continue; // Never successfully fetched
    }
    if (doc.staleAt !== undefined && doc.staleAt <= now) {
      continue; // Past stale threshold
    }

    entries.push({
      id: doc.id,
      title: doc.title,
      url: doc.url,
      priority: doc.priority,
      content: doc.content,
      contentHash: doc.contentHash,
      lastFetchedAt: doc.lastFetchedAt,
    });
  }

  // Sort by priority ascending (lower number = higher priority)
  return entries.sort((a, b) => a.priority - b.priority);
}
