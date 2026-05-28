/** Extracted reasoning text plus the user-visible message content. */
export interface ReasoningExtractionResult {
  /** Reasoning text extracted from the first supported format, or null when absent. */
  reasoningText: string | null;
  /** Message content with any embedded <think>...</think> sections removed. */
  cleanContent: string;
}

/** Minimal model-response shape accepted by the reasoning extractor. */
export interface ReasoningMessage {
  /** Response content as a string or Anthropic-style content block array. */
  content?: unknown;
  /** Provider-specific top-level reasoning field. */
  reasoning_content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getContentString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .join('');
}

function extractThinkingBlock(content: unknown): string | null {
  if (!Array.isArray(content)) return null;

  const block = content.find((candidate) => isRecord(candidate) && candidate.type === 'thinking');
  if (!isRecord(block)) return null;

  if (typeof block.thinking === 'string') return block.thinking;
  if (typeof block.text === 'string') return block.text;

  return null;
}

function extractThinkTags(content: string): ReasoningExtractionResult | null {
  const tagPattern = /<\/?think>/gi;
  const reasoningParts: string[] = [];
  let cleanContent = '';
  let reasoningBuffer = '';
  let depth = 0;
  let cursor = 0;
  let foundTag = false;

  const flushReasoningBuffer = () => {
    const reasoningText = reasoningBuffer.trim();
    if (reasoningText.length > 0) reasoningParts.push(reasoningText);
    reasoningBuffer = '';
  };

  for (const tag of content.matchAll(tagPattern)) {
    const tagText = tag[0] ?? '';
    const tagIndex = tag.index;
    const segment = content.slice(cursor, tagIndex);

    if (depth > 0) {
      reasoningBuffer += segment;
    } else {
      cleanContent += segment;
    }

    foundTag = true;

    if (tagText.startsWith('</')) {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0) {
          flushReasoningBuffer();
        }
      }
    } else {
      if (depth === 0) reasoningBuffer = '';
      depth += 1;
    }

    cursor = tagIndex + tagText.length;
  }

  const tail = content.slice(cursor);
  if (depth > 0) {
    reasoningBuffer += tail;
    flushReasoningBuffer();
  } else {
    cleanContent += tail;
  }

  if (!foundTag) return null;

  return {
    reasoningText: reasoningParts.length > 0 ? reasoningParts.join('\n') : null,
    cleanContent,
  };
}

/**
 * Extracts model reasoning from Anthropic thinking blocks, a top-level
 * reasoning_content field, or embedded <think>...</think> tags, in that order.
 */
export function extractReasoningContent(message: ReasoningMessage): ReasoningExtractionResult {
  const tagResult = typeof message.content === 'string' ? extractThinkTags(message.content) : null;
  const cleanContent = tagResult?.cleanContent ?? getContentString(message.content);
  const reasoningText = extractThinkingBlock(message.content)
    ?? (typeof message.reasoning_content === 'string' ? message.reasoning_content : null);

  return {
    reasoningText: reasoningText ?? tagResult?.reasoningText ?? null,
    cleanContent,
  };
}
