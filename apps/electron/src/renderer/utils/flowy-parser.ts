/**
 * Flowy Parser - Extracts Flowy diagrams from code blocks
 *
 * Parses Claude's output for flowy-flowchart and flowy-mockup code blocks,
 * converts them to FlowyInlineEmbed objects for inline rendering.
 */

import type { FlowyDocument } from '@vesper/shared/flowy';
import type { FlowyInlineEmbed } from '@vesper/core';
import { v4 as uuidv4 } from 'uuid';

export interface ParseResult {
  embeds: FlowyInlineEmbed[];
  cleanedContent: string; // Content with code blocks replaced by markers
}

/**
 * Parse Flowy code blocks from assistant message content
 *
 * Detects code blocks with language identifier:
 * - ```flowy-flowchart
 * - ```flowy-mockup
 *
 * Extracts the JSON content, validates it, and creates inline embeds.
 * Replaces code blocks with human-readable markers.
 */
export function parseFlowyCodeBlocks(content: string): ParseResult {
  const embeds: FlowyInlineEmbed[] = [];
  let cleanedContent = content;

  // Regex to match ```flowy-flowchart or ```flowy-mockup code blocks
  // Captures: [fullMatch, language, jsonContent]
  const codeBlockRegex = /```(flowy-flowchart|flowy-mockup)\n([\s\S]*?)```/g;

  let match;
  const replacements: Array<{ from: string; to: string }> = [];

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const [fullMatch, language, jsonContent] = match;

    try {
      // Parse JSON document
      const document = JSON.parse(jsonContent.trim()) as FlowyDocument;

      // Validate required fields
      if (!document.type || !document.content) {
        console.warn('Flowy parser: Skipping invalid document (missing required fields)', {
          hasType: !!document.type,
          hasContent: !!document.content,
        });
        continue;
      }

      // Validate document type matches language
      const expectedType = language === 'flowy-flowchart' ? 'flowchart' : 'mockup';
      if (document.type !== expectedType) {
        console.warn(`Flowy parser: Document type mismatch (expected ${expectedType}, got ${document.type})`);
        continue;
      }

      // Create inline embed
      const embed: FlowyInlineEmbed = {
        id: uuidv4(),
        document,
        displayMode: 'preview', // Default to preview mode
        position: match.index,
      };

      embeds.push(embed);

      // Create human-readable replacement marker
      const marker = `[Diagram: ${document.name || 'Untitled'}]`;
      replacements.push({ from: fullMatch, to: marker });

    } catch (e) {
      console.warn('Flowy parser: Failed to parse code block JSON:', e);
      // Keep original code block if parsing fails
    }
  }

  // Apply all replacements
  for (const { from, to } of replacements) {
    cleanedContent = cleanedContent.replace(from, to);
  }

  return { embeds, cleanedContent };
}
