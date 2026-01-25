/**
 * Slack Message Formatter
 *
 * Handles message formatting for Slack's mrkdwn syntax and chunking
 * for the 4000 character message limit.
 */

const SLACK_MESSAGE_LIMIT = 4000;

// Regex to match Slack angle-bracket tokens that should NOT be escaped
const SLACK_ANGLE_TOKEN_RE = /<[^>]*>/g;

/**
 * Check if an angle-bracket token is a valid Slack token that should be preserved
 */
function isAllowedSlackAngleToken(token: string): boolean {
  // User mention: <@U123ABC>
  if (/^<@[UW][A-Z0-9]+>$/i.test(token)) return true;

  // Channel mention: <#C123ABC> or <#C123ABC|channel-name>
  if (/^<#C[A-Z0-9]+(\|[^>]+)?>$/i.test(token)) return true;

  // Special mentions: <!here>, <!channel>, <!everyone>
  if (/^<!(?:here|channel|everyone)>$/i.test(token)) return true;

  // Links: <https://...> or <https://...|label>
  if (/^<(?:https?|mailto|tel):[^>]+>$/i.test(token)) return true;

  return false;
}

/**
 * Escape HTML entities in text segment (NOT in Slack tokens)
 */
function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape Slack mrkdwn content while preserving valid Slack tokens
 *
 * Slack uses angle brackets for special tokens like <@U123> for mentions.
 * We need to preserve these while escaping any raw HTML entities.
 */
export function escapeSlackMrkdwn(text: string): string {
  const result: string[] = [];
  let lastIndex = 0;

  const matches = Array.from(text.matchAll(SLACK_ANGLE_TOKEN_RE));

  for (const match of matches) {
    // Escape text before this token
    if (match.index !== undefined && match.index > lastIndex) {
      result.push(escapeHtmlEntities(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    // Preserve valid Slack tokens, escape others
    if (isAllowedSlackAngleToken(token)) {
      result.push(token);
    } else {
      result.push(escapeHtmlEntities(token));
    }

    lastIndex = (match.index ?? 0) + token.length;
  }

  // Escape remaining text
  result.push(escapeHtmlEntities(text.slice(lastIndex)));

  return result.join('');
}

/**
 * Build a Slack-formatted link
 *
 * @param href - The URL
 * @param label - Optional display text
 * @returns Formatted Slack link: <url|label> or just <url>
 */
export function buildSlackLink(href: string, label?: string): string {
  const trimmedHref = href.trim();
  const trimmedLabel = label?.trim();

  // Remove mailto: for comparison
  const comparableHref = trimmedHref.startsWith('mailto:')
    ? trimmedHref.slice(7)
    : trimmedHref;

  // Only use markup if label differs meaningfully from href
  const useMarkup = trimmedLabel &&
    trimmedLabel.length > 0 &&
    trimmedLabel !== trimmedHref &&
    trimmedLabel !== comparableHref;

  if (!useMarkup) {
    return `<${escapeHtmlEntities(trimmedHref)}>`;
  }

  return `<${escapeHtmlEntities(trimmedHref)}|${escapeHtmlEntities(trimmedLabel)}>`;
}

/**
 * Convert standard Markdown to Slack mrkdwn format
 *
 * Differences from standard Markdown:
 * - Bold: *text* (not **text**)
 * - Italic: _text_ (same)
 * - Strikethrough: ~text~ (same)
 * - Code: `text` (same)
 * - Links: <url|text> (not [text](url))
 */
export function markdownToSlackMrkdwn(markdown: string): string {
  let result = markdown;

  // Convert bold: **text** -> *text*
  result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // Convert links: [text](url) -> <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    return buildSlackLink(url, text);
  });

  // Headers: ## Header -> *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, '---');

  return result;
}

/**
 * Chunk a message to fit within Slack's character limit
 *
 * Attempts to split at natural boundaries:
 * 1. Paragraph breaks (double newline)
 * 2. Sentence boundaries (. ! ?)
 * 3. Word boundaries (space)
 * 4. Hard limit (rare, for very long words)
 */
export function chunkSlackMessage(text: string, limit: number = SLACK_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining.trim());
      break;
    }

    let splitIndex = limit;

    // Try paragraph boundary (double newline)
    const paraBreak = remaining.lastIndexOf('\n\n', limit);
    if (paraBreak > limit * 0.7) {
      splitIndex = paraBreak + 2;
    } else {
      // Try single newline
      const lineBreak = remaining.lastIndexOf('\n', limit);
      if (lineBreak > limit * 0.7) {
        splitIndex = lineBreak + 1;
      } else {
        // Try sentence boundary
        const sentenceEnd = Math.max(
          remaining.lastIndexOf('. ', limit),
          remaining.lastIndexOf('! ', limit),
          remaining.lastIndexOf('? ', limit)
        );
        if (sentenceEnd > limit * 0.7) {
          splitIndex = sentenceEnd + 2;
        } else {
          // Try word boundary
          const space = remaining.lastIndexOf(' ', limit);
          if (space > 0) {
            splitIndex = space + 1;
          }
          // else: hard split at limit (for very long words/URLs)
        }
      }
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIndex);
  }

  return chunks;
}

/**
 * Format a result for sending to Slack
 *
 * Applies all formatting and chunking in the correct order.
 */
export function formatSlackResult(text: string, options?: {
  convertMarkdown?: boolean;
  escapeContent?: boolean;
  maxChunkSize?: number;
}): string[] {
  const {
    convertMarkdown = true,
    escapeContent = true,
    maxChunkSize = SLACK_MESSAGE_LIMIT,
  } = options ?? {};

  let result = text;

  if (convertMarkdown) {
    result = markdownToSlackMrkdwn(result);
  }

  if (escapeContent) {
    result = escapeSlackMrkdwn(result);
  }

  return chunkSlackMessage(result, maxChunkSize);
}

// Re-export constants
export const SLACK_MESSAGE_LIMIT_CHARS = SLACK_MESSAGE_LIMIT;
