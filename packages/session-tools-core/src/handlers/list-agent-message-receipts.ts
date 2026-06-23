import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type AgentMessageReceiptStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out';

export interface ListAgentMessageReceiptsInput {
  receiptId?: string;
  status?: AgentMessageReceiptStatus;
  agentSlug?: string;
  limit?: number;
}

interface AgentMessageReceiptSummary {
  id: string;
  status: AgentMessageReceiptStatus;
  targetAgentSlug: string;
  callerAgentSlug?: string;
  childSessionId?: string;
  task: string;
  summary?: string;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ListAgentMessageReceiptsResult {
  ok: true;
  total: number;
  receipts: AgentMessageReceiptSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStatus(value: unknown): AgentMessageReceiptStatus {
  if (
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'timed-out'
  ) {
    return value;
  }
  return 'failed';
}

function summarizeReceipt(receipt: Record<string, unknown>): AgentMessageReceiptSummary {
  const result = isRecord(receipt.result) ? receipt.result : undefined;
  const error = isRecord(receipt.error)
    ? {
        code: String(receipt.error.code ?? 'unknown'),
        message: String(receipt.error.message ?? 'Unknown error'),
      }
    : undefined;

  return {
    id: String(receipt.id ?? ''),
    status: asStatus(receipt.status),
    targetAgentSlug: String(receipt.targetAgentSlug ?? ''),
    callerAgentSlug: typeof receipt.callerAgentSlug === 'string' ? receipt.callerAgentSlug : undefined,
    childSessionId: typeof receipt.childSessionId === 'string' ? receipt.childSessionId : undefined,
    task: String(receipt.task ?? ''),
    summary: typeof result?.summary === 'string' ? result.summary : undefined,
    error,
    createdAt: String(receipt.createdAt ?? ''),
    updatedAt: String(receipt.updatedAt ?? ''),
    completedAt: typeof receipt.completedAt === 'string' ? receipt.completedAt : undefined,
  };
}

function readReceipt(ctx: SessionToolContext, filePath: string): AgentMessageReceiptSummary {
  const parsed = JSON.parse(ctx.fs.readFile(filePath)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('receipt JSON must be an object');
  }
  const summary = summarizeReceipt(parsed);
  if (!summary.id || !summary.targetAgentSlug || !summary.createdAt) {
    throw new Error('receipt JSON is missing required fields');
  }
  return summary;
}

function success(result: ListAgentMessageReceiptsResult): ToolResult {
  const lines = [
    `Found ${result.total} agent message receipt${result.total === 1 ? '' : 's'}.`,
    ...result.receipts.map((receipt) => {
      const child = receipt.childSessionId ? ` childSessionId=${receipt.childSessionId}` : '';
      const detail = receipt.summary ? ` summary=${receipt.summary}` : receipt.error ? ` error=${receipt.error.code}: ${receipt.error.message}` : '';
      return `- ${receipt.id} ${receipt.status} ${receipt.targetAgentSlug}${child}${detail}`;
    }),
  ];

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

export async function handleListAgentMessageReceipts(
  ctx: SessionToolContext,
  args: ListAgentMessageReceiptsInput,
): Promise<ToolResult> {
  const dir = join(ctx.workspacePath, 'agent-messages');
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 100);

  if (args.receiptId) {
    const filePath = join(dir, `${args.receiptId}.json`);
    if (!ctx.fs.exists(filePath)) {
      return errorResponse(`Agent message receipt not found: ${args.receiptId}`);
    }
    try {
      const receipt = readReceipt(ctx, filePath);
      return success({ ok: true, total: 1, receipts: [receipt] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      return errorResponse(`Failed to read agent message receipt ${args.receiptId}: ${message}`);
    }
  }

  if (!ctx.fs.exists(dir)) {
    return success({ ok: true, total: 0, receipts: [] });
  }
  if (!ctx.fs.isDirectory(dir)) {
    return errorResponse('Agent message receipt path is not a directory.');
  }

  try {
    const receipts = ctx.fs.readdir(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => readReceipt(ctx, join(dir, name)))
      .filter((receipt) => !args.status || receipt.status === args.status)
      .filter((receipt) => !args.agentSlug || receipt.targetAgentSlug === args.agentSlug || receipt.callerAgentSlug === args.agentSlug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return success({ ok: true, total: receipts.length, receipts: receipts.slice(0, limit) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return errorResponse(`Failed to list agent message receipts: ${message}`);
  }
}
