import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface CreateWorkflowTriggerInput {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface CreateWorkflowTrigger {
  type: 'manual';
  inputs?: CreateWorkflowTriggerInput[];
}

export interface CreateWorkflowStepCompletion {
  requireNonEmptyOutput?: boolean;
  minOutputChars?: number;
  requireToolUse?: boolean;
}

export interface CreateWorkflowStep {
  id: string;
  agent: string;
  input: string;
  description?: string;
  outputSchema?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  onFailure?: 'stop' | 'continue' | 'ask';
  completion?: CreateWorkflowStepCompletion;
}

export interface CreateWorkflowMetadata {
  name: string;
  description: string;
  avatar?: string;
  trigger: CreateWorkflowTrigger;
  outputs?: Record<string, unknown>;
  steps: CreateWorkflowStep[];
}

export interface CreateWorkflowToolInput {
  slug: string;
  metadata: CreateWorkflowMetadata;
  body?: string;
  activateInWorkspace?: boolean;
  overwrite?: boolean;
}

export interface CreateWorkflowResult {
  ok: boolean;
  slug?: string;
  error?: string;
  suggestedSlug?: string;
}

const WORKFLOW_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export async function handleCreateWorkflow(
  ctx: SessionToolContext,
  args: CreateWorkflowToolInput,
): Promise<ToolResult> {
  if (!ctx.createWorkflow) {
    return errorResponse('create_workflow is not available in this context.');
  }

  if (!args.slug || !WORKFLOW_SLUG_RE.test(args.slug)) {
    return errorResponse(
      `Invalid workflow slug: "${args.slug}". Use lowercase letters, digits, and hyphens (1-64 chars, no leading/trailing hyphen).`,
    );
  }

  if (!args.metadata || !args.metadata.name?.trim() || !args.metadata.description?.trim()) {
    return errorResponse('metadata.name and metadata.description are required.');
  }

  if (args.metadata.trigger?.type !== 'manual') {
    return errorResponse('Only manual workflow triggers are supported today.');
  }

  if (!Array.isArray(args.metadata.steps) || args.metadata.steps.length === 0) {
    return errorResponse('metadata.steps must contain at least one workflow step.');
  }

  for (const step of args.metadata.steps) {
    if (!step?.id || !step.agent || !step.input?.trim()) {
      return errorResponse('Every workflow step requires id, agent, and non-empty input.');
    }
  }

  try {
    const result = await ctx.createWorkflow(args);
    if (!result.ok) {
      const suggestion = result.suggestedSlug
        ? ` Try slug "${result.suggestedSlug}" or pass overwrite: true.`
        : '';
      return errorResponse(`${result.error ?? 'Failed to create workflow.'}${suggestion}`);
    }
    return successResponse(`Created workflow ${result.slug}. View at /workflows/${result.slug}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to create workflow: ${message}`);
  }
}
