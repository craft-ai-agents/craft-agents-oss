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
import { getDefaultLlmConnection, getLlmConnection } from '../config/storage.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { getModelById, getDefaultSummarizationModel, MODEL_REGISTRY } from '../config/models.ts';

// ============================================================================
// QUERY INTERFACES (used by agent backends to implement queryFn)
// ============================================================================

/**
 * Request passed to the agent-native queryFn callback.
 * The prompt includes serialized file content (attachments are pre-processed by the tool).
 */
export interface LLMQueryRequest {
  /** Full prompt including serialized file content */
  prompt: string;
  /** Optional system prompt */
  systemPrompt?: string;
  /** Model to use (validated against registry) */
  model?: string;
  /** Max output tokens */
  maxTokens?: number;
  /** Sampling temperature 0-1 */
  temperature?: number;
  /** Structured output schema — prompt-based for OAuth path */
  outputSchema?: Record<string, unknown>;
}

/**
 * Result from an agent-native queryFn callback.
 */
export interface LLMQueryResult {
  text: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

// ============================================================================
// UTILITY: TIMEOUT HELPER
// Races a promise against a timeout, cleaning up the timer on completion
// ============================================================================

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer!));
}

// ============================================================================
// CONSTANTS
// ============================================================================

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

export const OUTPUT_FORMATS = {
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
// SHARED PRE-EXECUTION PIPELINE (used by Codex/Copilot PreToolUse intercepts)
// Validates input, processes attachments, resolves schema, builds LLMQueryRequest
// ============================================================================

export interface BuildCallLlmOptions {
  /** Backend name for error messages (e.g., "Codex", "Copilot") */
  backendName: string;
  /** Optional model validation hook — return undefined to reject (falls back to default), or corrected model ID */
  validateModel?: (resolvedModelId: string) => string | undefined;
}

/**
 * Shared pre-execution pipeline for call_llm PreToolUse intercepts.
 * Validates input, processes attachments, resolves schema, and builds an LLMQueryRequest
 * ready to be passed to the backend's queryLlm().
 *
 * Used by CodexAgent and CopilotAgent to avoid duplicating the same ~80 lines of logic.
 */
export async function buildCallLlmRequest(
  input: Record<string, unknown>,
  options: BuildCallLlmOptions
): Promise<LLMQueryRequest> {
  const prompt = input.prompt as string;
  if (!prompt?.trim()) {
    throw new Error('Prompt is required and cannot be empty.');
  }

  // Thinking not supported in non-API-key backends
  if (input.thinking) {
    throw new Error(
      `Extended thinking is not supported in ${options.backendName} mode.\n\n` +
      'Remove thinking=true to use basic mode.'
    );
  }

  // Process attachments
  const textParts: string[] = [];
  const attachments = input.attachments as Array<string | { path: string; startLine?: number; endLine?: number }> | undefined;

  if (attachments?.length) {
    for (let i = 0; i < attachments.length; i++) {
      const result = await processAttachment(attachments[i]!, i);
      if (result.type === 'error') {
        throw new Error(result.message);
      }
      if (result.type === 'image') {
        throw new Error(
          `Attachment ${i + 1}: Image attachments are not supported in ${options.backendName} mode. Use text files only.`
        );
      }
      if (result.type === 'text') {
        textParts.push(`<file path="${result.filename}">\n${result.content}\n</file>`);
      }
    }
  }

  textParts.push(prompt);

  // Resolve model against registry, with optional backend-specific validation
  let model = input.model as string | undefined;
  if (model) {
    const modelDef = getModelById(model)
      || MODEL_REGISTRY.find(m => m.shortName.toLowerCase() === model!.toLowerCase())
      || MODEL_REGISTRY.find(m => m.name.toLowerCase() === model!.toLowerCase());
    if (modelDef) {
      model = modelDef.id;
    }

    // Backend-specific model validation (e.g., Codex rejects non-OpenAI models)
    if (options.validateModel) {
      model = options.validateModel(model) ?? undefined;
    }
  }

  // Build system prompt with structured output injection if needed
  let systemPrompt = (input.systemPrompt as string) || '';
  const outputFormat = input.outputFormat as string | undefined;
  const outputSchema = input.outputSchema as Record<string, unknown> | undefined;

  let schema: Record<string, unknown> | null = null;
  if (outputSchema) {
    schema = outputSchema;
  } else if (outputFormat && OUTPUT_FORMATS[outputFormat as keyof typeof OUTPUT_FORMATS]) {
    schema = OUTPUT_FORMATS[outputFormat as keyof typeof OUTPUT_FORMATS];
  }

  if (schema) {
    const schemaJson = JSON.stringify(schema, null, 2);
    systemPrompt += `${systemPrompt ? '\n\n' : ''}You MUST respond with valid JSON matching this schema:\n${schemaJson}\n\nRespond with ONLY the JSON object, no other text or markdown formatting.`;
  }

  return {
    prompt: textParts.join('\n\n'),
    systemPrompt: systemPrompt || undefined,
    model,
    maxTokens: input.maxTokens as number | undefined,
    temperature: input.temperature as number | undefined,
  };
}

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

export async function processAttachment(
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
  /**
   * Lazy resolver for the agent-native query callback.
   * Called at execution time to get the current callback from the session registry.
   * ClaudeAgent implements this using SDK query() which handles OAuth internally.
   */
  getQueryFn?: () => ((request: LLMQueryRequest) => Promise<LLMQueryResult>) | undefined;
}

export function createLLMTool(options: LLMToolOptions) {
  // sessionId captured in closure for potential future use (logging, rate limiting per session)
  const { sessionId: _sessionId } = options;

  return tool(
    'call_llm',
    `Invoke a secondary LLM for focused subtasks. Use for:
- Cost optimization: use a smaller model for simple tasks (summarization, classification)
- Structured output: JSON schema compliance (guaranteed with API key, prompt-based with OAuth)
- Extended thinking: deep reasoning for specific subtasks (API key only)
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Pass file paths via 'attachments' - the tool loads content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.

Features depend on authentication:
- API key: Full features including structured output (tool_choice), extended thinking, and images
- OAuth: Basic features — structured output via prompt instructions, no thinking, text files only`,
    {
      prompt: z.string().min(1, 'Prompt cannot be empty')
        .describe('Instructions for Claude'),

      attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional()
        .describe(`File/image paths (max ${MAX_ATTACHMENTS}). Use {path, startLine, endLine} for large text files.`),

      model: z.string().optional()
        .describe('Model ID or short name (e.g., "haiku", "sonnet"). Defaults to Haiku.'),

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

      // --- Validate and resolve model against registry ---
      if (args.model) {
        let modelDef = getModelById(args.model);
        if (!modelDef) {
          // Try case-insensitive short name match (e.g., "haiku" → claude-haiku-4-5-20251001)
          modelDef = MODEL_REGISTRY.find(m => m.shortName.toLowerCase() === args.model!.toLowerCase())
            || MODEL_REGISTRY.find(m => m.name.toLowerCase() === args.model!.toLowerCase());
          if (modelDef) {
            args.model = modelDef.id;
          } else {
            const available = MODEL_REGISTRY.map(m => `  - ${m.id} (${m.shortName})`).join('\n');
            return errorResponse(
              `Unknown model: "${args.model}"\n\n` +
              `Available models:\n${available}`
            );
          }
        }
      }

      // --- Validate model + thinking compatibility ---
      if (args.thinking && args.model) {
        const modelDef = getModelById(args.model);
        if (modelDef && modelDef.shortName === 'Haiku') {
          return errorResponse(
            'Extended thinking not supported on Haiku.\n\n' +
            'Use a Sonnet or Opus model for thinking mode.'
          );
        }
      }

      // ========================================
      // AUTHENTICATION (Dual-Path Resolution)
      // Path 1: Anthropic API key → full-featured direct SDK
      // Path 2: Agent-native queryFn → OAuth/backend-specific
      // ========================================

      const connectionSlug = getDefaultLlmConnection();
      const connection = connectionSlug ? getLlmConnection(connectionSlug) : null;
      const credManager = getCredentialManager();
      const apiKey = connectionSlug ? await credManager.getLlmApiKey(connectionSlug) : null;
      const queryFn = options.getQueryFn?.();

      if (!apiKey && !queryFn) {
        return errorResponse(
          'No authentication configured for call_llm.\n\n' +
          'Configure one of:\n' +
          '1. Anthropic API key in settings (full features)\n' +
          '2. Sign in with your AI provider (basic features via OAuth)'
        );
      }

      // --- Validate thinking requires API key ---
      if (args.thinking && !apiKey) {
        return errorResponse(
          'Extended thinking requires an Anthropic API key.\n\n' +
          'You are using OAuth authentication, which supports basic call_llm features ' +
          'but not extended thinking.\n\n' +
          'Options:\n' +
          '1. Add an Anthropic API key in Settings for full features\n' +
          '2. Remove thinking=true to use basic mode'
        );
      }

      // --- Validate image attachments require API key ---
      const hasImageAttachments = args.attachments?.some(att => {
        const path = typeof att === 'string' ? att : att.path;
        const ext = path.split('.').pop()?.toLowerCase() || '';
        return IMAGE_EXTENSIONS.includes(ext);
      });
      if (hasImageAttachments && !apiKey) {
        return errorResponse(
          'Image attachments require an Anthropic API key.\n\n' +
          'OAuth mode only supports text file attachments.\n\n' +
          'Options:\n' +
          '1. Add an Anthropic API key in Settings\n' +
          '2. Remove image attachments and describe the image content in the prompt'
        );
      }

      // ========================================
      // PROCESS ATTACHMENTS
      // Load files/images and build content for both execution paths
      // ========================================

      const messageContent: Anthropic.MessageCreateParams['messages'][0]['content'] = [];
      const textParts: string[] = []; // Text-only version for queryFn path
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

            const fileBlock = `<file path="${result.filename}">\n${result.content}\n</file>`;
            messageContent.push({ type: 'text', text: fileBlock });
            textParts.push(fileBlock);
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
            // Images are only supported on the API key path (validated above)
          }
        }
      }

      // Add the prompt as the final content block
      messageContent.push({ type: 'text', text: args.prompt });
      textParts.push(args.prompt);

      // Resolve model with default from registry
      const model = args.model || getDefaultSummarizationModel();
      const schema = args.outputSchema || (args.outputFormat ? OUTPUT_FORMATS[args.outputFormat] : null);

      // ========================================
      // PATH 1: API KEY → Full-featured Anthropic SDK
      // Supports: structured output (tool_choice), extended thinking, images
      // ========================================

      if (apiKey) {
        const baseUrl = connection?.baseUrl;
        const client = new Anthropic({
          apiKey,
          ...(baseUrl ? { baseURL: baseUrl } : {}),
        });

        const thinkingEnabled = args.thinking === true;
        const thinkingBudget = thinkingEnabled ? (args.thinkingBudget || 10000) : 0;
        const outputTokens = args.maxTokens || 4096;
        const maxTokens = thinkingEnabled ? thinkingBudget + outputTokens : outputTokens;
        const temperature = thinkingEnabled ? 1 : args.temperature;

        const request: Anthropic.MessageCreateParams = {
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: messageContent }],
          ...(args.systemPrompt ? { system: args.systemPrompt } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
        };

        if (thinkingEnabled) {
          request.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        }

        if (schema) {
          request.tools = [{
            name: 'structured_output',
            description: 'Output structured data matching the required schema',
            input_schema: schema as Anthropic.Tool['input_schema'],
          }];
          request.tool_choice = { type: 'tool', name: 'structured_output' };
        }

        try {
          const response = await client.messages.create(request);

          if (schema) {
            const toolUse = response.content.find(
              (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
            );
            if (toolUse) {
              return { content: [{ type: 'text' as const, text: JSON.stringify(toolUse.input, null, 2) }] };
            }
            return errorResponse('Structured output expected but model did not return tool_use block. Try rephrasing the prompt.');
          }

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

          const textContent = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map(block => block.text)
            .join('\n');

          if (!textContent) {
            return { content: [{ type: 'text' as const, text: '(Model returned empty response)' }] };
          }

          return { content: [{ type: 'text' as const, text: textContent }] };

        } catch (error) {
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
                parts.push('\nRate limited.\n- Reduce parallel call_llm calls\n- Wait a few seconds before retrying\n- Consider using a smaller model');
                break;
              case 500: case 502: case 503:
                parts.push('\nAPI temporarily unavailable.\n- Retry in a few seconds');
                break;
              case 529:
                parts.push('\nAPI overloaded.\n- Retry with exponential backoff\n- Reduce parallel calls');
                break;
            }

            return errorResponse(parts.join(''));
          }

          if (error instanceof Error) {
            if (error.message.includes('fetch') || error.message.includes('network')) {
              return errorResponse(`Network error: ${error.message}\n\nCheck internet connection and try again.`);
            }
            return errorResponse(`Unexpected error: ${error.message}`);
          }

          throw error;
        }
      }

      // ========================================
      // PATH 2: QUERYFN → Agent-native callback (OAuth)
      // Supports: text attachments, prompt-based structured output
      // ========================================

      if (queryFn) {
        // Build system prompt, adding structured output instructions if needed
        let systemPrompt = args.systemPrompt || '';
        if (schema) {
          const schemaJson = JSON.stringify(schema, null, 2);
          systemPrompt += `${systemPrompt ? '\n\n' : ''}You MUST respond with valid JSON matching this schema:\n${schemaJson}\n\nRespond with ONLY the JSON object, no other text or markdown formatting.`;
        }

        try {
          const result = await queryFn({
            prompt: textParts.join('\n\n'),
            systemPrompt: systemPrompt || undefined,
            model,
            maxTokens: args.maxTokens,
            temperature: args.temperature,
            outputSchema: schema ? (schema as Record<string, unknown>) : undefined,
          });

          if (!result.text) {
            return { content: [{ type: 'text' as const, text: '(Model returned empty response)' }] };
          }

          return { content: [{ type: 'text' as const, text: result.text }] };
        } catch (error) {
          if (error instanceof Error) {
            return errorResponse(`call_llm failed: ${error.message}`);
          }
          throw error;
        }
      }

      // Should not reach here (validated above), but handle gracefully
      return errorResponse('No authentication available for call_llm.');
    }
  );
}
