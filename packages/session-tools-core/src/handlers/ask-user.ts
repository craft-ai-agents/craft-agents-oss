/**
 * Ask User Handler
 *
 * Presents the user a multiple-choice question and pauses the turn until they pick.
 * Reuses the auth-request handoff mechanism (same path as credential prompts): the
 * call triggers an interrupt + a structured card in the UI; the user's pick resumes
 * the conversation as the next message. Backend-agnostic — any tool-calling model
 * (DeepSeek via Pi, etc.) can call this.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult, AskAuthRequest } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import { generateRequestId } from '../source-helpers.ts';

export interface AskUserArgs {
  question: string;
  options: string[];
}

/**
 * Handle the ask_user tool call.
 *
 * 1. Validate question + options (2–6 options, non-empty)
 * 2. Build an 'ask' auth request
 * 3. Trigger it (causes interrupt; UI shows the choice card)
 */
export async function handleAskUser(
  ctx: SessionToolContext,
  args: AskUserArgs
): Promise<ToolResult> {
  const question = (args.question ?? '').trim();
  const options = Array.isArray(args.options)
    ? args.options.map((o) => (o ?? '').trim()).filter((o) => o.length > 0)
    : [];

  if (!question) {
    return errorResponse('ask_user requires a non-empty "question".');
  }
  if (options.length < 2) {
    return errorResponse('ask_user requires at least 2 non-empty "options".');
  }
  if (options.length > 6) {
    return errorResponse('ask_user supports at most 6 options. Group or trim them.');
  }

  const request: AskAuthRequest = {
    type: 'ask',
    requestId: generateRequestId('ask'),
    sessionId: ctx.sessionId,
    // sourceSlug/sourceName are unused for 'ask' (BaseAuthRequest requirement).
    sourceSlug: '__ask__',
    sourceName: '',
    question,
    options,
  };

  // Trigger the request (will interrupt the turn and show the choice card).
  ctx.callbacks.onAuthRequest(request);

  return successResponse(
    `Asked the user: "${question}". Waiting for them to pick one of: ${options.join(' / ')}.`
  );
}
