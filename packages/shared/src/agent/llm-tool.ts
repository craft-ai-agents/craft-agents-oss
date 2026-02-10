/**
 * LLM Tool (call_llm)
 *
 * Session-scoped tool that enables the main agent to invoke secondary Claude calls
 * for specialized subtasks like summarization, classification, extraction, and analysis.
 *
 * Key features:
 * - Attachment-based file/image loading (agent passes paths, tool loads content)
 * - Line range support for large files
 * - Predefined output formats + custom JSON Schema
 * - Extended thinking mode for complex reasoning
 * - Parallel execution support (multiple calls run simultaneously)
 * - Comprehensive validation with actionable error messages
 */

import Anthropic from '@anthropic-ai/sdk';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// Tool result type - matches what the SDK expects
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};
import { readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { getAnthropicApiKey, getAnthropicBaseUrl, getClaudeOAuthToken } from '../config/storage.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

const ALLOWED_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-3-5-haiku-latest',
  'claude-opus-4-5-20251101',
] as const;

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

// Limits - chosen to balance capability with reasonable resource usage
const MAX_FILE_LINES = 2000;
const MAX_FILE_BYTES = 500_000; // 500KB per text file
const MAX_IMAGE_BYTES = 5_000_000; // 5MB per image
const MAX_ATTACHMENTS = 20;
const MAX_TOTAL_CONTENT_BYTES = 2_000_000; // 2MB total across all attachments

// ============================================================================
// PREDEFINED OUTPUT FORMATS
// These provide structured output schemas for common use cases
// ============================================================================

const OUTPUT_FORMATS = {
  summary: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'Concise summary' },
      key_points: { type: 'array', items: { type: 'string' }, description: 'Main points' },
      word_count: { type: 'number', description: 'Approximate word count of source' },
    },
    required: ['summary', 'key_points'],
  },
  classification: {
    type: 'object' as const,
    properties: {
      category: { type: 'string', description: 'Primary category' },
      confidence: { type: 'number', description: 'Confidence 0-1' },
      reasoning: { type: 'string', description: 'Why this classification' },
    },
    required: ['category', 'confidence', 'reasoning'],
  },
  extraction: {
    type: 'object' as const,
    properties: {
      items: { type: 'array', items: { type: 'object' }, description: 'Extracted items' },
      count: { type: 'number', description: 'Number of items found' },
    },
    required: ['items', 'count'],
  },
  analysis: {
    type: 'object' as const,
    properties: {
      findings: { type: 'array', items: { type: 'string' }, description: 'Key findings' },
      issues: { type: 'array', items: { type: 'string' }, description: 'Problems found' },
      recommendations: { type: 'array', items: { type: 'string' }, description: 'Suggested actions' },
    },
    required: ['findings'],
  },
  comparison: {
    type: 'object' as const,
    properties: {
      similarities: { type: 'array', items: { type: 'string' } },
      differences: { type: 'array', items: { type: 'string' } },
      verdict: { type: 'string', description: 'Overall comparison result' },
    },
    required: ['similarities', 'differences', 'verdict'],
  },
  validation: {
    type: 'object' as const,
    properties: {
      valid: { type: 'boolean', description: 'Whether input is valid' },
      errors: { type: 'array', items: { type: 'string' }, description: 'Validation errors' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Warnings' },
    },
    required: ['valid', 'errors', 'warnings'],
  },
};

// ============================================================================
// HELPER: ERROR RESPONSE
// Creates a standardized error response with isError flag
// ============================================================================

function errorResponse(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

// ============================================================================
// HELPER: SUMMARIZE FILE SECTION
// Analyzes a section of a file to provide hints about its content
// Used in error messages when files are too large
// ============================================================================

function summarizeSection(lines: string[], start: number, end: number): string {
  const section = lines.slice(start, Math.min(end, lines.length));
  if (section.length === 0) return '(empty)';

  // Pattern matching to identify content types in this section
  const patterns = {
    imports: /^(import|from|require|use)\b/,
    exports: /^export\b/,
    functions: /^(async\s+)?(function|const\s+\w+\s*=.*=>|def\s+|fn\s+)/,
    classes: /^(class|struct|interface|type)\s+/,
    tests: /^(describe|it|test|def test_)\b/,
    comments: /^(\/\/|\/\*|#|"""|''')/,
    config: /^[\s]*["']?\w+["']?\s*[:=]/,
  };

  const found: string[] = [];
  for (const [name, pattern] of Object.entries(patterns)) {
    if (section.some(l => pattern.test(l.trim()))) {
      found.push(name);
    }
  }

  return found.length ? found.join(', ') : 'code/text';
}

// ============================================================================
// HELPER: ESCAPE XML SPECIAL CHARACTERS
// Prevents issues when filenames are embedded in XML-like tags
// ============================================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// HELPER: CHECK IF CONTENT APPEARS TO BE BINARY
// Binary files often contain null bytes - check first chunk
// ============================================================================

function isBinaryContent(content: string): boolean {
  // Check first 8KB for null bytes (common indicator of binary data)
  const checkLength = Math.min(content.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (content.charCodeAt(i) === 0) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// HELPER: VALIDATE AND PROCESS ATTACHMENT
// Handles file/image loading with validation and error reporting
// ============================================================================

interface AttachmentInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

type AttachmentResult =
  | { type: 'text'; content: string; filename: string; bytes: number }
  | { type: 'image'; base64: string; mediaType: string }
  | { type: 'error'; message: string };

async function processAttachment(
  input: string | AttachmentInput,
  index: number
): Promise<AttachmentResult> {
  // Normalize input to AttachmentInput format
  const attachment: AttachmentInput = typeof input === 'string'
    ? { path: input }
    : input;

  const { path: filePath, startLine, endLine } = attachment;
  const filename = filePath.split('/').pop() || filePath;
  const safeFilename = escapeXml(filename); // Escape for use in XML-like tags

  // --- Validate path exists and is a file ---
  if (!filePath || typeof filePath !== 'string') {
    return { type: 'error', message: `Attachment ${index + 1}: Invalid path (got ${typeof filePath})` };
  }

  if (!existsSync(filePath)) {
    return { type: 'error', message: `Attachment ${index + 1}: File not found: ${filePath}` };
  }

  // --- Get file stats with error handling for permission issues and broken symlinks ---
  let stats;
  try {
    stats = statSync(filePath);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('EACCES') || err.message.includes('permission')) {
        return { type: 'error', message: `Attachment ${index + 1}: Permission denied reading "${safeFilename}". Check file permissions.` };
      }
      if (err.message.includes('ENOENT') || err.message.includes('ELOOP')) {
        return { type: 'error', message: `Attachment ${index + 1}: Broken symlink or file moved: ${filePath}` };
      }
      return { type: 'error', message: `Attachment ${index + 1}: Cannot access "${safeFilename}": ${err.message}` };
    }
    return { type: 'error', message: `Attachment ${index + 1}: Cannot access "${safeFilename}"` };
  }

  if (stats.isDirectory()) {
    return { type: 'error', message: `Attachment ${index + 1}: "${safeFilename}" is a directory, not a file. Use Glob to find files in directories.` };
  }

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const isImage = IMAGE_EXTENSIONS.includes(ext);

  // --- Validate line range params ---
  if ((startLine !== undefined || endLine !== undefined) && isImage) {
    return { type: 'error', message: `Attachment ${index + 1}: Line ranges not supported for images. Remove startLine/endLine.` };
  }

  if (startLine !== undefined && (typeof startLine !== 'number' || startLine < 1 || !Number.isInteger(startLine))) {
    return { type: 'error', message: `Attachment ${index + 1}: startLine must be a positive integer (got ${startLine})` };
  }

  if (endLine !== undefined && (typeof endLine !== 'number' || endLine < 1 || !Number.isInteger(endLine))) {
    return { type: 'error', message: `Attachment ${index + 1}: endLine must be a positive integer (got ${endLine})` };
  }

  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    return { type: 'error', message: `Attachment ${index + 1}: startLine (${startLine}) cannot be greater than endLine (${endLine})` };
  }

  // --- Validate line range size isn't too large ---
  if (startLine !== undefined && endLine !== undefined) {
    const rangeSize = endLine - startLine + 1;
    if (rangeSize > MAX_FILE_LINES) {
      return { type: 'error', message: `Attachment ${index + 1}: Line range too large (${rangeSize} lines, max ${MAX_FILE_LINES}). Reduce the range or split into multiple calls.` };
    }
  }

  // --- Process image ---
  if (isImage) {
    if (stats.size > MAX_IMAGE_BYTES) {
      const sizeMB = (stats.size / 1_000_000).toFixed(1);
      return { type: 'error', message: `Attachment ${index + 1}: Image too large (${sizeMB}MB, max ${MAX_IMAGE_BYTES / 1_000_000}MB): ${safeFilename}` };
    }

    try {
      const imageData = await readFile(filePath);
      const base64 = imageData.toString('base64');
      const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { type: 'image', base64, mediaType };
    } catch (err) {
      return { type: 'error', message: `Attachment ${index + 1}: Failed to read image "${safeFilename}": ${err instanceof Error ? err.message : err}` };
    }
  }

  // --- Process text file ---

  // Pre-read size check: fail fast for huge files without loading them
  // Note: This is a byte count check, not line count - we still need to read to count lines
  if (stats.size > MAX_FILE_BYTES && startLine === undefined && endLine === undefined) {
    const sizeKB = Math.round(stats.size / 1024);
    return {
      type: 'error',
      message: `Attachment ${index + 1}: File too large (${sizeKB}KB, max ${MAX_FILE_BYTES / 1000}KB).

Use a line range to select a portion:
  { path: "${filePath}", startLine: 1, endLine: 500 }

Tip: Try reading a smaller section first to understand the file structure.`,
    };
  }

  try {
    const content = await readFile(filePath, 'utf-8');

    // Check for binary content (null bytes indicate binary)
    if (isBinaryContent(content)) {
      return { type: 'error', message: `Attachment ${index + 1}: "${safeFilename}" appears to be a binary file, not text. Only text files and images (png, jpg, gif, webp) are supported.` };
    }

    // Check for empty or whitespace-only files
    if (content.trim().length === 0) {
      return { type: 'error', message: `Attachment ${index + 1}: "${safeFilename}" is empty or contains only whitespace. Nothing to process.` };
    }

    const lines = content.split('\n');
    const totalLines = lines.length;

    // If line range specified, extract it
    if (startLine !== undefined || endLine !== undefined) {
      const start = (startLine || 1) - 1;
      const end = endLine || lines.length;

      if (start >= lines.length) {
        return { type: 'error', message: `Attachment ${index + 1}: startLine (${startLine}) exceeds file length (${totalLines} lines)` };
      }

      const slice = lines.slice(start, end);
      const rangeNote = `[Lines ${start + 1}-${Math.min(end, totalLines)} of ${totalLines}]`;
      const sliceContent = slice.join('\n');
      return { type: 'text', content: `${rangeNote}\n${sliceContent}`, filename: safeFilename, bytes: Buffer.byteLength(sliceContent, 'utf-8') };
    }

    // Check size limits for files without explicit range (line count check)
    if (lines.length > MAX_FILE_LINES) {
      const sizeInfo = `${totalLines} lines, ${Math.round(content.length / 1024)}KB`;

      // Build helpful section breakdown to guide line range selection
      const sections: string[] = [];
      const chunkSize = Math.ceil(totalLines / 4);
      for (let i = 0; i < 4 && i * chunkSize < totalLines; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, totalLines);
        const summary = summarizeSection(lines, start, end);
        sections.push(`  Lines ${start + 1}-${end}: ${summary}`);
      }

      return {
        type: 'error',
        message: `Attachment ${index + 1}: File too large (${sizeInfo}, max ${MAX_FILE_LINES} lines).

Use a line range to select a portion:
  { path: "${filePath}", startLine: 1, endLine: 500 }

File structure (${totalLines} lines total):
${sections.join('\n')}`,
      };
    }

    return { type: 'text', content, filename: safeFilename, bytes: Buffer.byteLength(content, 'utf-8') };
  } catch (err) {
    // Handle read errors (permission issues, etc.)
    if (err instanceof Error) {
      if (err.message.includes('EACCES') || err.message.includes('permission')) {
        return { type: 'error', message: `Attachment ${index + 1}: Permission denied reading "${safeFilename}". Check file permissions.` };
      }
      return { type: 'error', message: `Attachment ${index + 1}: Failed to read file "${safeFilename}": ${err.message}` };
    }
    return { type: 'error', message: `Attachment ${index + 1}: Failed to read file "${safeFilename}"` };
  }
}

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const AttachmentSchema = z.union([
  z.string().describe('Simple file path'),
  z.object({
    path: z.string().describe('File path'),
    startLine: z.number().int().min(1).optional().describe('First line to include (1-indexed)'),
    endLine: z.number().int().min(1).optional().describe('Last line to include (1-indexed)'),
  }).describe('File path with optional line range for large files'),
]);

const OutputSchemaParam = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).optional(),
}).describe('JSON Schema for structured output');

// ============================================================================
// MAIN TOOL FACTORY
// ============================================================================

export interface LLMToolOptions {
  sessionId: string;
}

export function createLLMTool(options: LLMToolOptions) {
  // sessionId captured in closure for potential future use (logging, rate limiting per session)
  const { sessionId: _sessionId } = options;

  return tool(
    'call_llm',
    `Invoke a secondary Claude model for focused subtasks. Use for:
- Cost optimization: haiku for simple tasks (summarization, classification)
- Structured output: guaranteed JSON schema compliance
- Extended thinking: deep reasoning for specific subtasks
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Pass file paths via 'attachments' - the tool loads content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.`,
    {
      prompt: z.string().min(1, 'Prompt cannot be empty')
        .describe('Instructions for Claude'),

      attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional()
        .describe(`File/image paths (max ${MAX_ATTACHMENTS}). Use {path, startLine, endLine} for large text files.`),

      model: z.enum(ALLOWED_MODELS).optional()
        .describe('Model to use. Defaults to claude-3-5-haiku-latest'),

      systemPrompt: z.string().optional()
        .describe('Optional system prompt'),

      maxTokens: z.number().int().min(1).max(64000).optional()
        .describe('Max output tokens (1-64000). Defaults to 4096'),

      temperature: z.number().min(0).max(1).optional()
        .describe('Sampling temperature 0-1. Ignored if thinking=true (forced to 1)'),

      thinking: z.boolean().optional()
        .describe('Enable extended thinking. Incompatible with outputFormat/outputSchema'),

      thinkingBudget: z.number().int().min(1024).max(100000).optional()
        .describe('Token budget for thinking (1024-100000). Defaults to 10000'),

      outputFormat: z.enum(['summary', 'classification', 'extraction', 'analysis', 'comparison', 'validation']).optional()
        .describe('Predefined output format. Incompatible with thinking'),

      outputSchema: OutputSchemaParam.optional()
        .describe('Custom JSON Schema. Incompatible with thinking'),
    },
    async (args) => {
      // ========================================
      // VALIDATION PHASE
      // Fail fast with clear, actionable error messages
      // ========================================

      // --- Validate prompt ---
      if (!args.prompt?.trim()) {
        return errorResponse('Prompt is required and cannot be empty.');
      }

      // --- Validate mutual exclusions ---
      if (args.thinking && (args.outputFormat || args.outputSchema)) {
        return errorResponse(
          'Cannot use thinking with structured output.\n\n' +
          'Options:\n' +
          '1. Remove thinking=true to use outputFormat/outputSchema\n' +
          '2. Remove outputFormat/outputSchema to use thinking\n\n' +
          'These features use incompatible API modes.'
        );
      }

      if (args.outputFormat && args.outputSchema) {
        return errorResponse(
          'Cannot use both outputFormat and outputSchema.\n\n' +
          'Options:\n' +
          '1. Use outputFormat for predefined schemas (summary, classification, etc.)\n' +
          '2. Use outputSchema for custom JSON Schema'
        );
      }

      // --- Validate thinking params ---
      if (args.thinkingBudget && !args.thinking) {
        return errorResponse(
          'thinkingBudget requires thinking=true.\n\n' +
          'Add thinking=true to enable extended thinking, or remove thinkingBudget.'
        );
      }

      // --- Validate model + thinking compatibility ---
      if (args.thinking && args.model === 'claude-3-5-haiku-latest') {
        return errorResponse(
          'Extended thinking not supported on Haiku.\n\n' +
          'Use claude-sonnet-4-5-20250929 or claude-opus-4-6 for thinking mode.'
        );
      }

      // ========================================
      // AUTHENTICATION
      // ========================================

      const apiKey = await getAnthropicApiKey();
      const oauthToken = await getClaudeOAuthToken();

      if (!apiKey && !oauthToken) {
        return errorResponse(
          'No authentication configured.\n\n' +
          'Configure one of:\n' +
          '1. Anthropic API key in settings\n' +
          '2. Claude OAuth login'
        );
      }

      // OAuth tokens cannot be used for direct API calls - Anthropic's API only accepts API keys
      // The main agent works with OAuth because the Claude Code SDK has special internal handling,
      // but the basic Anthropic SDK used here does not support OAuth authentication.
      if (!apiKey && oauthToken) {
        return errorResponse(
          'call_llm requires an Anthropic API key.\n\n' +
          'You are signed in with Claude OAuth (Max subscription), which works for the main agent ' +
          'but cannot be used for secondary API calls.\n\n' +
          'To use call_llm:\n' +
          '1. Add an Anthropic API key in Settings → API Key\n' +
          '2. The API key will be used only for call_llm subtasks\n\n' +
          'Alternative: Use the Task tool to spawn subagents (works with OAuth).'
        );
      }

      // ========================================
      // PROCESS ATTACHMENTS
      // Load files/images and build message content
      // ========================================

      const messageContent: Anthropic.MessageCreateParams['messages'][0]['content'] = [];
      let totalContentBytes = 0;

      if (args.attachments?.length) {
        for (let i = 0; i < args.attachments.length; i++) {
          const attachment = args.attachments[i]!;
          const result = await processAttachment(attachment, i);

          if (result.type === 'error') {
            return errorResponse(result.message);
          }

          if (result.type === 'text') {
            totalContentBytes += result.bytes;

            if (totalContentBytes > MAX_TOTAL_CONTENT_BYTES) {
              return errorResponse(
                `Total attachment size exceeds ${MAX_TOTAL_CONTENT_BYTES / 1_000_000}MB limit.\n\n` +
                'Options:\n' +
                '1. Use line ranges to reduce content: {path: "...", startLine: X, endLine: Y}\n' +
                '2. Split into multiple call_llm calls\n' +
                '3. Remove some attachments'
              );
            }

            messageContent.push({
              type: 'text',
              text: `<file path="${result.filename}">\n${result.content}\n</file>`,
            });
          }

          if (result.type === 'image') {
            messageContent.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: result.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: result.base64,
              },
            });
          }
        }
      }

      // Add the prompt as the final content block
      messageContent.push({ type: 'text', text: args.prompt });

      // ========================================
      // BUILD CLIENT
      // ========================================

      const baseUrl = getAnthropicBaseUrl();

      // Build client with API key (OAuth-only case already handled above with clear error)
      const client = new Anthropic({
        apiKey: apiKey!,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });

      // ========================================
      // BUILD REQUEST
      // ========================================

      const model = args.model || 'claude-3-5-haiku-latest';
      const thinkingEnabled = args.thinking === true;
      const thinkingBudget = thinkingEnabled ? (args.thinkingBudget || 10000) : 0;
      const outputTokens = args.maxTokens || 4096;
      // Extended thinking: max_tokens must cover both thinking AND output
      const maxTokens = thinkingEnabled ? thinkingBudget + outputTokens : outputTokens;
      // Extended thinking requires temperature=1
      const temperature = thinkingEnabled ? 1 : args.temperature;

      const request: Anthropic.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: messageContent }],
        ...(args.systemPrompt ? { system: args.systemPrompt } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      };

      // Add thinking configuration
      if (thinkingEnabled) {
        request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
      }

      // Add structured output via tool use pattern
      // This is more broadly compatible than output_config
      const schema = args.outputSchema || (args.outputFormat ? OUTPUT_FORMATS[args.outputFormat] : null);
      if (schema) {
        request.tools = [{
          name: 'structured_output',
          description: 'Output structured data matching the required schema',
          input_schema: schema as Anthropic.Tool['input_schema'],
        }];
        request.tool_choice = { type: 'tool', name: 'structured_output' };
      }

      // ========================================
      // EXECUTE API CALL
      // ========================================

      try {
        const response = await client.messages.create(request);

        // --- Structured output: extract from tool_use block ---
        if (schema) {
          const toolUse = response.content.find(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
          );
          if (toolUse) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(toolUse.input, null, 2) }],
            };
          }
          // Fallback if model didn't use tool (shouldn't happen with tool_choice)
          return errorResponse('Structured output expected but model did not return tool_use block. Try rephrasing the prompt.');
        }

        // --- Thinking mode: extract thinking and text blocks ---
        if (thinkingEnabled) {
          const thinkingBlock = response.content.find(
            (block): block is Anthropic.ThinkingBlock => block.type === 'thinking'
          );
          const textBlock = response.content.find(
            (block): block is Anthropic.TextBlock => block.type === 'text'
          );

          const parts: string[] = [];
          if (thinkingBlock) {
            parts.push(`<thinking>\n${thinkingBlock.thinking}\n</thinking>`);
          }
          if (textBlock) {
            parts.push(textBlock.text);
          }

          if (parts.length === 0) {
            return errorResponse('Thinking mode returned no content. Try increasing thinkingBudget or simplifying the task.');
          }

          return { content: [{ type: 'text' as const, text: parts.join('\n\n') }] };
        }

        // --- Standard text response ---
        const textContent = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('\n');

        if (!textContent) {
          return { content: [{ type: 'text' as const, text: '(Model returned empty response)' }] };
        }

        return { content: [{ type: 'text' as const, text: textContent }] };

      } catch (error) {
        // ========================================
        // ERROR HANDLING
        // Provide context-aware error messages with recovery suggestions
        // ========================================

        if (error instanceof Anthropic.APIError) {
          const status = error.status;
          const message = error.message;

          const parts = [`API Error (${status}): ${message}`];

          switch (status) {
            case 400:
              if (message.includes('thinking')) {
                parts.push('\nThinking mode issue. Try:\n- Use a supported model (Sonnet or Opus)\n- Reduce thinkingBudget\n- Remove thinking=true for this task');
              } else if (message.includes('content') || message.includes('image')) {
                parts.push('\nContent issue. Try:\n- Reduce attachment sizes with line ranges\n- Check file encodings (UTF-8 required)\n- Verify image format is supported (png, jpg, gif, webp)');
              } else if (message.includes('tool')) {
                parts.push('\nTool/schema issue. Try:\n- Simplify outputSchema\n- Use a predefined outputFormat instead');
              }
              break;

            case 401:
              parts.push('\nAuthentication failed.\n- Check API key is valid and not expired\n- Verify the key has not been revoked');
              break;

            case 403:
              parts.push('\nAccess denied.\n- Check API key permissions\n- Verify model access on your plan');
              break;

            case 429:
              parts.push('\nRate limited.\n- Reduce parallel call_llm calls\n- Wait a few seconds before retrying\n- Consider using haiku instead of sonnet/opus');
              break;

            case 500:
            case 502:
            case 503:
              parts.push('\nAnthropic API temporarily unavailable.\n- Retry in a few seconds\n- Check status.anthropic.com for outages');
              break;

            case 529:
              parts.push('\nAnthropic API overloaded.\n- Retry with exponential backoff\n- Reduce parallel calls\n- Try a less busy time');
              break;
          }

          return errorResponse(parts.join(''));
        }

        // Non-API errors (network issues, etc.)
        if (error instanceof Error) {
          if (error.message.includes('fetch') || error.message.includes('network')) {
            return errorResponse(`Network error: ${error.message}\n\nCheck internet connection and try again.`);
          }
          return errorResponse(`Unexpected error: ${error.message}`);
        }

        // Unknown error type - rethrow
        throw error;
      }
    }
  );
}
