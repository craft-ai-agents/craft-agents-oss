/**
 * Large Response Handling Utility
 *
 * Centralized save + prompt building + formatting for large tool results.
 * Follows the title-generator.ts pattern: pure functions only, no SDK/LLM calls.
 *
 * Callers orchestrate via their agent's runMiniCompletion() for summarization.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { debug } from './debug.ts';

// ============================================================
// Constants (re-exported from summarize.ts for convenience)
// ============================================================

/** Token limit for summarization trigger (roughly ~60KB of text) */
export const TOKEN_LIMIT = 15000;

/** Max tokens to send for summarization (~400KB). Beyond this, save to file + preview only. */
export const MAX_SUMMARIZATION_INPUT = 100000;

/** Canonical subfolder under session dir for full tool results */
export const LONG_RESPONSES_DIR = 'long_responses';

// ============================================================
// Token Estimation
// ============================================================

/**
 * Estimate token count from text length (rough approximation: 4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================
// Save to Disk
// ============================================================

export interface SaveResult {
  /** Absolute path for Read/Grep access */
  absolutePath: string;
  /** Relative path from session dir (e.g. "long_responses/2026-02-09_gmail_users_me.txt") for transform_data */
  relativePath: string;
}

/**
 * Save large response to the session's long_responses/ folder.
 * Creates the folder if it doesn't exist.
 *
 * @param sessionPath - Path to the session folder
 * @param toolName - Name of the tool (e.g., "gmail", "api_stripe")
 * @param label - Additional label for the filename (e.g., API path)
 * @param content - The full response content to save
 * @returns Absolute and relative paths to the saved file
 */
export function saveLargeResponse(
  sessionPath: string,
  toolName: string,
  label: string,
  content: string
): SaveResult | null {
  const responsesDir = join(sessionPath, LONG_RESPONSES_DIR);
  try {
    mkdirSync(responsesDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
    const safeLabel = label.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `${timestamp}_${toolName}_${safeLabel}.txt`;
    const absolutePath = join(responsesDir, filename);

    writeFileSync(absolutePath, content, 'utf-8');

    const relativePath = relative(sessionPath, absolutePath);

    debug('large-response', `Saved ${content.length} bytes to ${relativePath}`);
    return { absolutePath, relativePath };
  } catch (error) {
    debug('large-response', `Failed to save: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============================================================
// Summarization Prompt Builder
// ============================================================

export interface SummarizationContext {
  /** Tool or API name */
  toolName: string;
  /** Optional endpoint/path for API calls */
  path?: string;
  /** Tool input parameters */
  input?: Record<string, unknown>;
  /** The model's stated intent before calling the tool */
  intent?: string;
  /** The user's original request (fallback context) */
  userRequest?: string;
}

/**
 * Build the prompt for summarizing a large tool result.
 * Pure function — no SDK calls.
 *
 * @param text - The large response text
 * @param context - Context about the tool call
 * @returns Prompt string ready for runMiniCompletion()
 */
export function buildSummarizationPrompt(text: string, context: SummarizationContext): string {
  // Safely stringify input
  let inputContext = 'No specific parameters provided.';
  if (context.input) {
    try {
      inputContext = `Request parameters: ${JSON.stringify(context.input)}`;
    } catch {
      inputContext = 'Request parameters: [non-serializable input]';
    }
  }

  const endpointContext = context.path ? `Endpoint: ${context.path}` : '';

  // Prefer model's stated intent, fall back to user request
  const intentContext = context.intent
    ? `The AI assistant's goal: "${context.intent.slice(0, 500)}"`
    : context.userRequest
      ? `User's original request: "${context.userRequest.slice(0, 300)}"`
      : '';

  // Truncate response to fit within summarization limits
  const maxChars = MAX_SUMMARIZATION_INPUT * 4; // ~400KB
  const truncated = text.length > maxChars;
  const responseText = truncated
    ? text.substring(0, maxChars) + '\n\n[... truncated for summarization ...]'
    : text;

  return `You are summarizing a tool result that was too large to fit in context.

Tool: ${context.toolName}
${endpointContext}
${inputContext}
${intentContext ? `\n${intentContext}` : ''}
${truncated ? '\nNote: The response was truncated before summarization due to extreme size.' : ''}

Your task:
1. Extract the MOST RELEVANT information based on the stated goal or request above
2. Preserve key data points, IDs, URLs, and actionable information that relate to the goal
3. Summarize long text content but keep essential details needed to complete the task
4. Format the output cleanly for the AI assistant to use

Tool result to summarize:
${responseText}

Provide a concise but comprehensive summary that captures the essential information needed to accomplish the stated goal.`;
}

// ============================================================
// Result Message Formatting
// ============================================================

export interface FormatOptions {
  estimatedTokens: number;
  /** Relative path from session dir (for transform_data reference) */
  relativePath: string;
  /** Absolute path (for Read/Grep reference) */
  absolutePath: string;
  /** Summary from runMiniCompletion (if available) */
  summary?: string;
  /** Fallback preview when no summary (first N chars of response) */
  preview?: string;
}

/**
 * Format the message the model sees for a large response.
 * Includes file references for both Read/Grep and transform_data access.
 */
export function formatLargeResponseMessage(opts: FormatOptions): string {
  const { estimatedTokens, relativePath, absolutePath, summary, preview } = opts;

  const fileRef = [
    `Full data saved to: ${absolutePath}`,
    `- Use Read/Grep to access specific content`,
    `- Use transform_data with inputFiles: ["${relativePath}"] for data analysis`,
  ].join('\n');

  if (summary) {
    return `[Large response (~${estimatedTokens} tokens) summarized]\n\n${fileRef}\n\n${summary}`;
  }

  if (preview) {
    return `[Response too large (~${estimatedTokens} tokens)]\n\n${fileRef}\n\nPreview:\n${preview}...`;
  }

  return `[Response too large (~${estimatedTokens} tokens)]\n\n${fileRef}`;
}

// ============================================================
// High-level Pipeline (orchestrates save + summarize + format)
// ============================================================

export interface HandleLargeResponseOptions {
  /** Full response text */
  text: string;
  /** Path to the session folder */
  sessionPath: string;
  /** Context about the tool call */
  context: SummarizationContext;
  /** Optional summarize callback — typically agent.runMiniCompletion.bind(agent) */
  summarize?: (prompt: string) => Promise<string | null>;
}

export interface HandleLargeResponseResult {
  /** Formatted message for the model */
  message: string;
  /** Absolute path to saved file */
  filePath: string;
  /** Whether the response was summarized (vs preview-only) */
  wasSummarized: boolean;
}

/**
 * Full pipeline: save to disk, optionally summarize, format result message.
 *
 * Call this when a tool result exceeds TOKEN_LIMIT.
 * If `summarize` callback is provided and tokens are within MAX_SUMMARIZATION_INPUT,
 * it will be called with the built prompt. Otherwise falls back to preview.
 *
 * @returns Formatted result, or null if the text is not large enough to handle
 */
export async function handleLargeResponse(
  opts: HandleLargeResponseOptions
): Promise<HandleLargeResponseResult | null> {
  const { text, sessionPath, context, summarize } = opts;
  const estimatedTokens = estimateTokens(text);

  if (estimatedTokens <= TOKEN_LIMIT) {
    return null; // Not large enough — caller should return as-is
  }

  debug('large-response', `${context.toolName}: ${text.length} bytes, ~${estimatedTokens} tokens`);

  // 1. Save full response to disk
  const saveResult = saveLargeResponse(
    sessionPath,
    context.toolName,
    context.path || '',
    text
  );

  if (!saveResult) {
    // File save failed — return preview without file references
    const preview = text.substring(0, 2000);
    return {
      message: `[Response too large (~${estimatedTokens} tokens)]\n\nPreview:\n${preview}...`,
      filePath: '',
      wasSummarized: false,
    };
  }

  const { absolutePath, relativePath } = saveResult;

  // 2. Try summarization if within limits and callback provided
  let summary: string | undefined;
  if (summarize && estimatedTokens <= MAX_SUMMARIZATION_INPUT) {
    try {
      const prompt = buildSummarizationPrompt(text, context);
      const result = await summarize(prompt);
      if (result) {
        summary = result;
      }
    } catch (error) {
      debug('large-response', `Summarization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 3. Format message
  const message = formatLargeResponseMessage({
    estimatedTokens,
    relativePath,
    absolutePath,
    summary,
    preview: summary ? undefined : text.substring(0, 2000),
  });

  return { message, filePath: absolutePath, wasSummarized: !!summary };
}
