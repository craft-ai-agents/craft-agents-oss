/**
 * Flowy Parser - Extracts Flowy diagrams from code blocks
 *
 * Parses Claude's output for flowy-flowchart and flowy-mockup code blocks,
 * converts them to FlowyInlineEmbed objects for inline rendering.
 */

import type { FlowyDocument } from '@vesper/shared/flowy';
import type { FlowyInlineEmbed } from '@vesper/core';
import { v4 as uuidv4 } from 'uuid';

// Security limits
const MAX_CONTENT_SIZE = 1_048_576; // 1MB
const MAX_NESTING_DEPTH = 50;

export interface ParsingError {
  code: string;
  message: string;
  line?: number;
  context?: string;
}

export interface ParseResult {
  embeds: FlowyInlineEmbed[];
  cleanedContent: string; // Content with code blocks replaced by markers
}

/**
 * Validate JSON nesting depth to prevent DoS attacks
 */
function validateNestingDepth(obj: unknown, maxDepth: number, currentDepth = 0): boolean {
  if (currentDepth > maxDepth) {
    return false;
  }

  if (obj === null || typeof obj !== 'object') {
    return true;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (!validateNestingDepth(item, maxDepth, currentDepth + 1)) {
        return false;
      }
    }
  } else {
    for (const value of Object.values(obj)) {
      if (!validateNestingDepth(value, maxDepth, currentDepth + 1)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Safely parse JSON with size and depth validation
 */
function safeParseJSON(jsonContent: string): { success: boolean; error?: ParsingError; data?: FlowyDocument } {
  // Check content size before parsing
  if (jsonContent.length > MAX_CONTENT_SIZE) {
    return {
      success: false,
      error: {
        code: 'CONTENT_TOO_LARGE',
        message: `Content exceeds maximum size of ${MAX_CONTENT_SIZE} bytes`,
        context: `${jsonContent.length} bytes`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown JSON parse error';
    return {
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: `Failed to parse JSON: ${errorMessage}`,
        context: jsonContent.substring(0, 100),
      },
    };
  }

  // Validate nesting depth
  if (!validateNestingDepth(parsed, MAX_NESTING_DEPTH)) {
    return {
      success: false,
      error: {
        code: 'NESTING_TOO_DEEP',
        message: `JSON nesting exceeds maximum depth of ${MAX_NESTING_DEPTH}`,
      },
    };
  }

  return {
    success: true,
    data: parsed as FlowyDocument,
  };
}

/**
 * Extract code blocks using safe iterative approach instead of ReDoS-vulnerable regex
 */
function extractCodeBlocks(content: string): Array<{
  fullMatch: string;
  language: string;
  jsonContent: string;
  startIndex: number;
}> {
  const blocks: Array<{
    fullMatch: string;
    language: string;
    jsonContent: string;
    startIndex: number;
  }> = [];

  let searchStart = 0;

  while (searchStart < content.length) {
    // Find opening marker
    const openMarker = content.indexOf('```flowy-', searchStart);
    if (openMarker === -1) break;

    // Extract language (flowy-flowchart or flowy-mockup)
    const lineEnd = content.indexOf('\n', openMarker);
    if (lineEnd === -1) break;

    const language = content.substring(openMarker + 3, lineEnd).trim();
    if (language !== 'flowy-flowchart' && language !== 'flowy-mockup') {
      searchStart = lineEnd + 1;
      continue;
    }

    // Find closing marker
    const closeMarker = content.indexOf('```', lineEnd + 1);
    if (closeMarker === -1) break;

    // Extract content between markers
    const jsonContent = content.substring(lineEnd + 1, closeMarker);
    const fullMatch = content.substring(openMarker, closeMarker + 3);

    blocks.push({
      fullMatch,
      language,
      jsonContent,
      startIndex: openMarker,
    });

    searchStart = closeMarker + 3;
  }

  return blocks;
}

/**
 * Parse Flowy code blocks from assistant message content
 *
 * Detects code blocks with language identifier:
 * - ```flowy-flowchart
 * - ```flowy-mockup
 *
 * Extracts the JSON content, validates it, and creates inline embeds.
 * Replaces code blocks with human-readable markers or error messages.
 */
export function parseFlowyCodeBlocks(content: string): ParseResult {
  const embeds: FlowyInlineEmbed[] = [];
  let cleanedContent = content;

  // Check total content size
  if (content.length > MAX_CONTENT_SIZE) {
    console.error(`Flowy parser: Content size (${content.length} bytes) exceeds maximum (${MAX_CONTENT_SIZE} bytes)`);
    return {
      embeds: [],
      cleanedContent: `[FLOWY_PARSE_ERROR: Content too large (${content.length} bytes, max ${MAX_CONTENT_SIZE})]`,
    };
  }

  // Use safe iterative extraction instead of ReDoS-vulnerable regex
  const blocks = extractCodeBlocks(content);
  const replacements: Array<{ from: string; to: string }> = [];

  for (const block of blocks) {
    const { fullMatch, language, jsonContent, startIndex } = block;

    // Safely parse JSON with size and depth validation
    const parseResult = safeParseJSON(jsonContent.trim());

    if (!parseResult.success) {
      const error = parseResult.error!;
      console.warn('Flowy parser: Failed to parse code block:', error);

      // Replace with visible error marker so Claude can see and fix it
      const errorMarker = `[FLOWY_PARSE_ERROR: ${error.message}]`;
      replacements.push({ from: fullMatch, to: errorMarker });
      continue;
    }

    const document = parseResult.data!;

    // Validate required fields
    if (!document.type || !document.content) {
      const error: ParsingError = {
        code: 'MISSING_REQUIRED_FIELDS',
        message: 'Document missing required fields (type or content)',
        context: `hasType: ${!!document.type}, hasContent: ${!!document.content}`,
      };
      console.warn('Flowy parser: Invalid document:', error);

      const errorMarker = `[FLOWY_PARSE_ERROR: ${error.message}]`;
      replacements.push({ from: fullMatch, to: errorMarker });
      continue;
    }

    // Validate document type matches language
    const expectedType = language === 'flowy-flowchart' ? 'flowchart' : 'mockup';
    if (document.type !== expectedType) {
      const error: ParsingError = {
        code: 'TYPE_MISMATCH',
        message: `Document type mismatch (expected ${expectedType}, got ${document.type})`,
        context: `language: ${language}, type: ${document.type}`,
      };
      console.warn('Flowy parser:', error);

      const errorMarker = `[FLOWY_PARSE_ERROR: ${error.message}]`;
      replacements.push({ from: fullMatch, to: errorMarker });
      continue;
    }

    // Create inline embed
    const embed: FlowyInlineEmbed = {
      id: uuidv4(),
      document,
      displayMode: 'preview', // Default to preview mode
      position: startIndex,
    };

    embeds.push(embed);

    // Create human-readable replacement marker
    const marker = `[Diagram: ${document.name || 'Untitled'}]`;
    replacements.push({ from: fullMatch, to: marker });
  }

  // Apply all replacements
  for (const { from, to } of replacements) {
    cleanedContent = cleanedContent.replace(from, to);
  }

  return { embeds, cleanedContent };
}
