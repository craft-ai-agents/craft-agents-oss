/**
 * PR tool handlers — pr_status / pr_bind / pr_unbind / pr_set_auto_merge (Coding mode).
 *
 * All credential resolution and GitHub access happen behind the injected ctx.prWatch callbacks on the
 * workspace server (where the token chain + `gh` live) — this package stays dependency-free of
 * @craft-agent/shared (same rule as pages). The agent never sees a token.
 */

import type { SessionToolContext, PrToolMergeMethod } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

const PR_UNAVAILABLE =
  'PR tools are unavailable here — they need Coding mode on the workspace server. If this is a coding session, there is nothing to do.';

function toError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

// ============================================================
// pr_status
// ============================================================

export interface PrStatusArgs {
  session_id?: string;
}

export async function handlePrStatus(ctx: SessionToolContext, args: PrStatusArgs): Promise<ToolResult> {
  if (!ctx.prWatch) return errorResponse(PR_UNAVAILABLE);
  try {
    const result = await ctx.prWatch.status({ sessionId: args.session_id });
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to get PR status: ${toError(error)}`);
  }
}

// ============================================================
// pr_bind
// ============================================================

export interface PrBindArgs {
  pr: string;
}

export async function handlePrBind(ctx: SessionToolContext, args: PrBindArgs): Promise<ToolResult> {
  if (!ctx.prWatch) return errorResponse(PR_UNAVAILABLE);
  if (!args.pr?.trim()) return errorResponse('pr is required — a PR URL, owner/repo#123, or a number for this repo.');
  try {
    const result = await ctx.prWatch.bind({ ref: args.pr.trim() });
    if (!result.ok) return errorResponse(result.error ?? 'Failed to bind the PR.');
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to bind the PR: ${toError(error)}`);
  }
}

// ============================================================
// pr_unbind
// ============================================================

export interface PrUnbindArgs {
  pr: string;
}

export async function handlePrUnbind(ctx: SessionToolContext, args: PrUnbindArgs): Promise<ToolResult> {
  if (!ctx.prWatch) return errorResponse(PR_UNAVAILABLE);
  if (!args.pr?.trim()) return errorResponse('pr is required — the PR URL, owner/repo#123, or number to unbind.');
  try {
    const result = await ctx.prWatch.unbind({ ref: args.pr.trim() });
    if (!result.ok) return errorResponse(result.error ?? 'Failed to unbind the PR.');
    if (!result.removed) return successResponse(`That PR wasn't bound to this session. ${result.boundCount ?? 0} PR(s) remain bound.`);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to unbind the PR: ${toError(error)}`);
  }
}

// ============================================================
// pr_set_auto_merge
// ============================================================

export interface PrSetAutoMergeArgs {
  pr: string;
  enabled: boolean;
  method?: PrToolMergeMethod;
}

export async function handlePrSetAutoMerge(ctx: SessionToolContext, args: PrSetAutoMergeArgs): Promise<ToolResult> {
  if (!ctx.prWatch) return errorResponse(PR_UNAVAILABLE);
  if (!args.pr?.trim()) return errorResponse('pr is required — a PR URL, owner/repo#123, or a number for this repo.');
  if (typeof args.enabled !== 'boolean') return errorResponse('enabled is required (true to turn auto-merge on, false to turn it off).');
  try {
    const result = await ctx.prWatch.setAutoMerge({ ref: args.pr.trim(), enabled: args.enabled, method: args.method });
    if (!result.ok) return errorResponse(result.error ?? 'Failed to change auto-merge.');
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to change auto-merge: ${toError(error)}`);
  }
}
