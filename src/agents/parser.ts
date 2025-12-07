/**
 * Agent document parser
 *
 * Parses Craft documents to extract agent definitions:
 * - Document title → agent name
 * - "Instructions" subpage → instructions content + block ID
 * - Code blocks → MCP server configs
 */

import yaml from 'js-yaml';
import type { SubAgentDefinition, McpServerConfig } from './types.ts';
import { debug } from '../tui/utils/debug.ts';

/**
 * Block structure from Craft MCP blocks_get response
 */
interface CraftBlock {
  id: string | number;
  content?: string;
  style?: string;
  listStyle?: {
    type?: string;
  };
  children?: CraftBlock[];
}

/**
 * Normalize agent name for @mention usage
 * - Lowercase
 * - Replace spaces with hyphens
 * - Remove special characters
 */
export function normalizeAgentName(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract all text content from blocks recursively
 */
function extractAllContent(blocks: CraftBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.content) {
      lines.push(block.content);
    }
    if (block.children) {
      lines.push(extractAllContent(block.children));
    }
  }

  return lines.join('\n').trim();
}

/**
 * Extract MCP server configs from code blocks
 */
function extractMcpConfigsFromBlocks(blocks: CraftBlock[]): McpServerConfig[] {
  const configs: McpServerConfig[] = [];

  for (const block of blocks) {
    // Check if this is a code block
    if (block.style === 'code' && block.content) {
      const parsed = tryParseMcpConfig(block.content);
      if (parsed) {
        configs.push(...parsed);
      }
    }

    // Recurse into children
    if (block.children) {
      configs.push(...extractMcpConfigsFromBlocks(block.children));
    }
  }

  return configs;
}

/**
 * Try to parse content as MCP config
 * Supports: plain URL, YAML, JSON
 */
function tryParseMcpConfig(content: string): McpServerConfig[] | null {
  const trimmed = content.trim();

  // Format 1: Plain URL
  if (/^https?:\/\/[^\s]+$/.test(trimmed)) {
    return [
      {
        name: extractNameFromUrl(trimmed),
        url: trimmed,
      },
    ];
  }

  // Try to parse as YAML or JSON
  try {
    const parsed = yaml.load(trimmed) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // Format 2/3: Single object with url field
    if (!Array.isArray(parsed) && 'url' in (parsed as Record<string, unknown>)) {
      const config = parsed as Record<string, unknown>;
      if (typeof config.url !== 'string') return null;

      return [
        {
          name:
            typeof config.name === 'string' ? config.name : extractNameFromUrl(config.url),
          url: config.url,
          requiresAuth: config.requires_auth === true || config.requiresAuth === true,
          description: typeof config.description === 'string' ? config.description : undefined,
        },
      ];
    }

    // Format 4: Array of configs
    if (Array.isArray(parsed)) {
      const configs: McpServerConfig[] = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
          configs.push({
            name: typeof item.name === 'string' ? item.name : extractNameFromUrl(item.url),
            url: item.url,
            requiresAuth: item.requires_auth === true || item.requiresAuth === true,
            description: typeof item.description === 'string' ? item.description : undefined,
          });
        }
      }
      return configs.length > 0 ? configs : null;
    }
  } catch {
    // Not valid YAML/JSON, skip
  }

  return null;
}

/**
 * Extract a name from URL hostname
 */
function extractNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove common prefixes like 'mcp.' or 'api.'
    return hostname
      .replace(/^(mcp|api|www)\./, '')
      .split('.')[0] || hostname;
  } catch {
    return 'unknown';
  }
}
