import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface CreateAgentToolMetadata {
  name: string;
  description: string;
  avatar?: string;
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  skills?: string[];
  sources?: string[];
  inputs?: string;
  outputs?: string;
  tags?: string[];
  greeting?: string;
  model?: string;
  llmConnection?: string;
}

export interface CreateAgentToolInput {
  slug: string;
  metadata: CreateAgentToolMetadata;
  systemPrompt: string;
  activateInWorkspace?: boolean;
  overwrite?: boolean;
}

export interface CreateAgentResult {
  ok: boolean;
  slug?: string;
  error?: string;
  suggestedSlug?: string;
}

const AGENT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BUILT_IN_SLUGS = new Set(['concierge', 'orchestrator']);

export async function handleCreateAgent(
  ctx: SessionToolContext,
  args: CreateAgentToolInput
): Promise<ToolResult> {
  if (!ctx.createAgent) {
    return errorResponse('create_agent is not available in this context.');
  }

  if (!args.slug || !AGENT_SLUG_RE.test(args.slug)) {
    return errorResponse(
      `Invalid agent slug: "${args.slug}". Use lowercase letters, digits, and hyphens (1-64 chars, no leading/trailing hyphen).`
    );
  }

  if (BUILT_IN_SLUGS.has(args.slug)) {
    return errorResponse(
      `"${args.slug}" is a built-in agent and cannot be overwritten. Pick a different slug.`
    );
  }

  if (!args.metadata || !args.metadata.name?.trim() || !args.metadata.description?.trim()) {
    return errorResponse('metadata.name and metadata.description are required.');
  }

  if (!args.systemPrompt || args.systemPrompt.trim().length === 0) {
    return errorResponse('systemPrompt is required and cannot be empty.');
  }

  try {
    const result = await ctx.createAgent(args);
    if (!result.ok) {
      const suggestion = result.suggestedSlug
        ? ` Try slug "${result.suggestedSlug}" or pass overwrite: true.`
        : '';
      return errorResponse(`${result.error ?? 'Failed to create agent.'}${suggestion}`);
    }
    return successResponse(`Created agent @${result.slug}. View at /agents/agent/${result.slug}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to create agent: ${message}`);
  }
}
