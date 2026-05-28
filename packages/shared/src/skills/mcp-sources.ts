import {
  detectDuplicateMcpImportCandidates,
  parseMcpJsonImportCandidates,
  type McpImportCandidate,
} from '../sources/mcp-import.ts';
import type { SkillMetadata } from './types.ts';

/**
 * Extract MCP source candidates declared by a skill's vendor metadata.
 */
export function extractMcpSourceCandidatesFromSkillMetadata(
  metadata: SkillMetadata,
  workspaceRootPath: string,
): McpImportCandidate[] {
  const clients = getSkillMcpClients(metadata);
  if (!clients) return [];

  const parsed = parseMcpJsonImportCandidates(JSON.stringify({ mcpServers: clients }));
  if (parsed.errors.length > 0 || parsed.candidates.length === 0) return [];

  return detectDuplicateMcpImportCandidates(workspaceRootPath, parsed.candidates);
}

function getSkillMcpClients(metadata: SkillMetadata): Record<string, unknown> | undefined {
  const vendorMetadata = asRecord(metadata.metadata);
  const mdp = asRecord(vendorMetadata?.mdp ?? (metadata as unknown as Record<string, unknown>).mdp);
  const mcp = asRecord(mdp?.mcp);
  const clients = asRecord(mcp?.clients);
  return clients && Object.keys(clients).length > 0 ? clients : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
