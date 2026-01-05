/**
 * Agent Folder Storage
 *
 * CRUD operations for workspace-scoped agent folders.
 * Agents are stored at ~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import type { FolderAgentConfig, LoadedAgent, CreateAgentInput } from './folder-types.ts';
import type { LoadedSource, FolderSourceConfig, SourceGuide } from '../sources/types.ts';
import {
  loadSource,
  loadAgentSources as loadAgentSourcesFromStorage,
  findIconInDir,
  parseGuideMarkdown,
} from '../sources/storage.ts';
import { getWorkspaceAgentsPath } from '../workspaces/storage.ts';
import { validateAgentConfig } from '../config/validators.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Directory Utilities
// ============================================================

/**
 * Get path to an agent folder within a workspace
 */
export function getAgentPath(workspaceId: string, agentSlug: string): string {
  return join(getWorkspaceAgentsPath(workspaceId), agentSlug);
}

/**
 * Ensure agents directory exists for a workspace
 */
export function ensureAgentsDir(workspaceId: string): void {
  const dir = getWorkspaceAgentsPath(workspaceId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// Config Operations
// ============================================================

/**
 * Load agent config.json
 */
export function loadAgentConfig(
  workspaceId: string,
  agentSlug: string
): FolderAgentConfig | null {
  const configPath = join(getAgentPath(workspaceId, agentSlug), 'config.json');
  if (!existsSync(configPath)) return null;

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (error) {
    debug(`[loadAgentConfig] Failed to parse config for agent '${agentSlug}':`, error);
    return null;
  }
}

/**
 * Save agent config.json
 * @throws Error if config is invalid
 */
export function saveAgentConfig(
  workspaceId: string,
  config: FolderAgentConfig
): void {
  // Validate config before writing
  const validation = validateAgentConfig(config);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    debug('[saveAgentConfig] Validation failed:', errorMessages);
    throw new Error(`Invalid agent config: ${errorMessages}`);
  }

  const dir = getAgentPath(workspaceId, config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  config.updatedAt = Date.now();
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

// ============================================================
// Instructions Operations
// ============================================================

/**
 * Load agent instructions.md
 */
export function loadAgentInstructions(workspaceId: string, agentSlug: string): string | null {
  const instructionsPath = join(getAgentPath(workspaceId, agentSlug), 'instructions.md');
  if (!existsSync(instructionsPath)) return null;

  try {
    return readFileSync(instructionsPath, 'utf-8');
  } catch (error) {
    debug(`[loadAgentInstructions] Failed to read instructions for agent '${agentSlug}':`, error);
    return null;
  }
}

/**
 * Save agent instructions.md
 */
export function saveAgentInstructions(
  workspaceId: string,
  agentSlug: string,
  instructions: string
): void {
  const dir = getAgentPath(workspaceId, agentSlug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(join(dir, 'instructions.md'), instructions);
}

// ============================================================
// Icon Operations
// ============================================================

/**
 * Find agent icon file
 */
export function findAgentIcon(workspaceId: string, agentSlug: string): string | null {
  const dir = getAgentPath(workspaceId, agentSlug);
  return findIconInDir(dir);
}

// ============================================================
// Agent-Scoped Source Operations
// ============================================================

/**
 * Resolve all sources for an agent (agent-scoped + referenced workspace sources)
 */
export function resolveAgentSources(
  workspaceId: string,
  config: FolderAgentConfig
): LoadedSource[] {
  const sources: LoadedSource[] = [];
  const seenSlugs = new Set<string>();

  // 1. Agent-scoped sources (highest priority)
  const agentSources = loadAgentSourcesFromStorage(workspaceId, config.slug);
  for (const source of agentSources) {
    sources.push(source);
    seenSlugs.add(source.config.slug);
  }

  // 2. Referenced workspace sources
  if (config.useSources) {
    for (const slug of config.useSources) {
      if (!seenSlugs.has(slug)) {
        const workspaceSource = loadSource(workspaceId, slug);
        if (workspaceSource) {
          if (workspaceSource.config.enabled) {
            sources.push(workspaceSource);
            seenSlugs.add(slug);
          } else {
            debug(
              `[resolveAgentSources] Source '${slug}' referenced by agent '${config.slug}' is disabled, skipping`
            );
          }
        } else {
          debug(
            `[resolveAgentSources] Source '${slug}' referenced by agent '${config.slug}' not found`
          );
        }
      }
    }
  }

  return sources;
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load complete agent with all files
 */
export function loadAgent(workspaceId: string, agentSlug: string): LoadedAgent | null {
  const config = loadAgentConfig(workspaceId, agentSlug);
  if (!config) return null;

  return {
    config,
    instructions: loadAgentInstructions(workspaceId, agentSlug),
    iconPath: findAgentIcon(workspaceId, agentSlug),
    sources: resolveAgentSources(workspaceId, config),
    workspaceId,
  };
}

/**
 * Load all agents for a workspace
 */
export function loadWorkspaceAgents(workspaceId: string): LoadedAgent[] {
  ensureAgentsDir(workspaceId);

  const agents: LoadedAgent[] = [];
  const agentsDir = getWorkspaceAgentsPath(workspaceId);

  if (!existsSync(agentsDir)) return agents;

  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agent = loadAgent(workspaceId, entry.name);
        if (agent) {
          agents.push(agent);
        }
      }
    }
  } catch (error) {
    debug('[loadWorkspaceAgents] Failed to read agents directory:', error);
  }

  return agents;
}

/**
 * Get enabled agents for a workspace
 */
export function getEnabledAgents(workspaceId: string): LoadedAgent[] {
  return loadWorkspaceAgents(workspaceId).filter((a) => a.config.enabled);
}

// ============================================================
// Create/Delete Operations
// ============================================================

/**
 * Generate URL-safe slug from name
 */
export function generateAgentSlug(workspaceId: string, name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  // Ensure slug is not empty
  if (!slug) {
    slug = 'agent';
  }

  // Check for existing slugs and append number if needed
  const agentsDir = getWorkspaceAgentsPath(workspaceId);
  const existingSlugs = new Set<string>();
  if (existsSync(agentsDir)) {
    try {
      const entries = readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          existingSlugs.add(entry.name);
        }
      }
    } catch (error) {
      debug('[generateAgentSlug] Failed to read agents directory:', error);
    }
  }

  if (!existingSlugs.has(slug)) {
    return slug;
  }

  // Find next available number
  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) {
    counter++;
  }

  return `${slug}-${counter}`;
}

/**
 * Create a new agent in a workspace
 * Note: slug is the unique identifier (no separate id field)
 */
export function createAgent(workspaceId: string, input: CreateAgentInput): FolderAgentConfig {
  const slug = generateAgentSlug(workspaceId, input.name);
  const now = Date.now();

  const config: FolderAgentConfig = {
    name: input.name,
    slug,
    enabled: input.enabled ?? true,
    source: input.source,
    useSources: input.useSources,
    createdAt: now,
    updatedAt: now,
  };

  saveAgentConfig(workspaceId, config);
  saveAgentInstructions(workspaceId, slug, input.instructions);

  return config;
}

/**
 * Delete an agent from a workspace
 */
export function deleteAgent(workspaceId: string, agentSlug: string): void {
  const dir = getAgentPath(workspaceId, agentSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Check if an agent exists in a workspace
 */
export function agentExists(workspaceId: string, agentSlug: string): boolean {
  return existsSync(join(getAgentPath(workspaceId, agentSlug), 'config.json'));
}
