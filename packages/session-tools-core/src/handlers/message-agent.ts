import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export interface MessageAgentToolInput {
  agentSlug: string;
  task: string;
  context?: string;
  expectedOutput?: string;
  outputSchema?: Record<string, unknown>;
  sourceSlugs?: string[];
  skillSlugs?: string[];
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  timeoutSeconds?: number;
  maxTurns?: number;
  priority?: 'low' | 'normal' | 'high';
  background?: boolean;
}

export interface MessageAgentToolResult {
  ok: boolean;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';
  receiptId?: string;
  childSessionId?: string;
  agentSlug: string;
  output?: unknown;
  summary?: string;
  toolUseCount: number;
  toolNames: string[];
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
}

function successResponse(result: MessageAgentToolResult): ToolResult {
  const lines = [
    result.status === 'running'
      ? `Agent "${result.agentSlug}" started delegated task in the background.`
      : result.ok
      ? `Agent "${result.agentSlug}" completed delegated task.`
      : `Agent "${result.agentSlug}" delegation failed.`,
    result.receiptId ? `receiptId: ${result.receiptId}` : undefined,
    result.childSessionId ? `childSessionId: ${result.childSessionId}` : undefined,
    `toolUseCount: ${result.toolUseCount}`,
    result.summary ? `summary: ${result.summary}` : undefined,
    result.error ? `error: ${result.error.code}: ${result.error.message}` : undefined,
  ].filter(Boolean);

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}

function serviceFailureResponse(result: MessageAgentToolResult): ToolResult {
  const message = `Agent "${result.agentSlug}" delegation failed.${
    result.error ? `\n${result.error.code}: ${result.error.message}` : ''
  }`;
  return {
    content: [{ type: 'text', text: `[ERROR] ${message}` }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: true,
  };
}

export async function handleMessageAgent(
  ctx: SessionToolContext,
  args: MessageAgentToolInput,
): Promise<ToolResult> {
  if (!ctx.messageAgent) {
    return errorResponse('message_agent is not available in this context.');
  }

  try {
    const result = await ctx.messageAgent(args);
    return result.ok ? successResponse(result) : serviceFailureResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`Failed to message agent: ${message}`);
  }
}
