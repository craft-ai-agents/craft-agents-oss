/**
 * Telegram Result Formatter
 *
 * Converts agent output (Message array from Claude Agent SDK) into
 * Telegram-compatible message format with 4096 character limit per message.
 *
 * Strategy:
 * - Small results (≤4096 chars): Send as-is with citations
 * - Medium results (4KB-16KB): Chunk into multiple messages
 * - Large results (>16KB): Send truncated preview + deep link to desktop session
 */

import type { Message } from '@vesper/core/types'
import type { FormattedResult } from './types'

// --- Constants for Telegram message size limits ---

/** Maximum characters per Telegram message */
export const MAX_MESSAGE_SIZE = 4096

/** Maximum total size before switching to deep link (16KB) */
export const MAX_TOTAL_SIZE = 16384

/** Preview length when using deep links */
export const PREVIEW_LENGTH = 500

// --- Deep Link Helper Functions ---

/**
 * Check if result exceeds Telegram's total message limit and requires a deep link
 *
 * Results over 16KB should use a deep link instead of chunking,
 * as too many messages would be disruptive to the chat.
 *
 * @param result - The result text to check
 * @returns True if result should use a deep link
 */
export function shouldUseDeepLink(result: string): boolean {
  return result.length > MAX_TOTAL_SIZE
}

/**
 * Generate a Vesper deep link for viewing full session details
 *
 * Deep links allow users to open the full session in the desktop app
 * when Telegram message limits are exceeded.
 *
 * @param workspaceId - The workspace ID containing the session
 * @param sessionId - The session ID to link to
 * @returns Deep link URL in format: vesper://session/{workspaceId}/{sessionId}
 */
export function generateDeepLink(workspaceId: string, sessionId: string): string {
  return `vesper://session/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sessionId)}`
}

/**
 * Format large results that exceed Telegram limits
 *
 * Strategy:
 * - Results 4KB-16KB: Chunk into multiple messages
 * - Results >16KB: Send truncated preview + deep link
 *
 * @param result - The full result text
 * @param workspaceId - Workspace ID for deep link generation
 * @param sessionId - Session ID for deep link generation
 * @returns Array of Telegram-compatible messages
 */
export function formatLargeResult(
  result: string,
  workspaceId: string,
  sessionId: string,
): string[] {
  // For very large results (>16KB), use preview + deep link
  if (shouldUseDeepLink(result)) {
    const deepLink = generateDeepLink(workspaceId, sessionId)
    const preview = result.substring(0, PREVIEW_LENGTH).trim()

    // Find a good cutoff point (end of sentence or paragraph)
    const lastSentence = preview.match(/.*[.!?]\s*/s)
    const truncatedPreview = lastSentence
      ? lastSentence[0].trim()
      : preview + '...'

    return [
      `📱 **Result Preview**\n\n` +
        `${truncatedPreview}\n\n` +
        `---\n` +
        `*Result too large for Telegram (${Math.round(result.length / 1024)}KB)*\n\n` +
        `🔗 [View full result in Vesper](${deepLink})`
    ]
  }

  // For medium results (4KB-16KB), chunk into multiple messages
  return chunkForTelegram(result, MAX_MESSAGE_SIZE)
}

/**
 * Format agent output for Telegram constraints
 *
 * Telegram has ~4096 character limit per message.
 * Strategy based on result size:
 * - Small results (≤4KB): Send as-is with citations
 * - Medium results (4KB-16KB): Chunk into multiple messages
 * - Large results (>16KB): Send truncated preview + deep link
 *
 * @param sessionMessages - Array of messages from the SDK session
 * @param sessionId - Session ID for deep linking
 * @param workspaceId - Workspace ID for deep linking (defaults to 'default')
 * @param maxChars - Maximum characters per Telegram message (default 4096)
 * @returns FormattedResult with messages, summary, and metadata
 */
export function formatResult(
  sessionMessages: Message[],
  sessionId: string,
  workspaceId: string = 'default',
  maxChars: number = MAX_MESSAGE_SIZE,
): FormattedResult {
  // Extract assistant text and tool results
  // Internal Message type has content as a string (not ContentBlock array)
  const assistantTexts: string[] = []

  for (const msg of sessionMessages) {
    if (msg.role === 'assistant' && msg.content) {
      // Internal Message.content is a string
      assistantTexts.push(msg.content)
    }
  }

  // Combine assistant messages
  const fullText = assistantTexts.join('\n\n')

  // Extract citations/sources from the conversation
  const sourceMarkdown = extractSources(sessionMessages)
  const citedText = sourceMarkdown
    ? `${fullText}\n\n📋 **Sources:**\n${sourceMarkdown}`
    : fullText

  // Generate one-liner summary
  const summary = generateOneLiner(fullText, 100)

  // Check if fits in single message
  if (citedText.length <= maxChars) {
    return {
      messages: [citedText],
      summary,
      fullMarkdown: citedText,
      truncated: false,
    }
  }

  // Handle large results using the new helper functions
  const deepLink = generateDeepLink(workspaceId, sessionId)

  // Very large results (>16KB): use preview + deep link
  if (shouldUseDeepLink(citedText)) {
    return {
      messages: formatLargeResult(citedText, workspaceId, sessionId),
      summary,
      fullMarkdown: citedText,
      truncated: true,
      deepLink,
    }
  }

  // Medium results (4KB-16KB): chunk into multiple messages
  const chunks = chunkForTelegram(citedText, maxChars)
  return {
    messages: chunks,
    summary,
    fullMarkdown: citedText,
    truncated: chunks.length > 1,
  }
}

/**
 * Extract citations and sources from assistant messages
 *
 * Looks for URLs in tool results and generates a numbered reference list.
 * Tool results often contain sources/URLs that should be cited.
 *
 * @param sessionMessages - Array of messages from the session
 * @returns Markdown-formatted source list, empty string if no sources found
 */
function extractSources(sessionMessages: Message[]): string {
  const sources = new Set<string>()

  for (const msg of sessionMessages) {
    // Skip if no content
    if (!msg.content) continue

    // Internal Message.content is a string
    // Extract URLs from message content
    if (msg.role === 'assistant' || msg.role === 'user' || msg.role === 'tool') {
      const urls = msg.content.match(/https?:\/\/[^\s)>\]]+/g) || []
      urls.forEach((url: string) => {
        // Clean up URL if it has trailing punctuation
        const cleaned = url.replace(/[.,;:!?"\]}\)]*$/, '')
        sources.add(cleaned)
      })

      // Also check toolResult field for tool messages
      if (msg.toolResult) {
        const toolUrls = msg.toolResult.match(/https?:\/\/[^\s)>\]]+/g) || []
        toolUrls.forEach((url: string) => {
          const cleaned = url.replace(/[.,;:!?"\]}\)]*$/, '')
          sources.add(cleaned)
        })
      }
    }
  }

  if (sources.size === 0) return ''

  // Format as numbered list
  return Array.from(sources)
    .map((url, i) => `[${i + 1}] ${url}`)
    .join('\n')
}

/**
 * Generate one-line summary from text
 *
 * Prefers the first sentence if it fits within maxLength.
 * Falls back to truncation at maxLength with ellipsis.
 *
 * @param text - Full text to summarize
 * @param maxLength - Maximum length for summary
 * @returns One-liner summary
 */
function generateOneLiner(text: string, maxLength: number = 100): string {
  const trimmed = text.trim()

  // Handle empty text
  if (!trimmed) {
    return '(No response)'
  }

  // Already short enough
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  // Try to extract first sentence
  const sentenceMatch = trimmed.match(/[^.!?]*[.!?]/)
  if (sentenceMatch) {
    const sentence = sentenceMatch[0].trim()
    if (sentence.length <= maxLength) {
      return sentence
    }
  }

  // Fallback: truncate at maxLength
  return trimmed.substring(0, maxLength).trim() + '...'
}

/**
 * Split large text into Telegram-compatible chunks
 *
 * Intelligently breaks text at paragraph boundaries when possible
 * to avoid breaking up formatted content.
 *
 * @param text - Text to split
 * @param maxChars - Maximum characters per chunk (default 4096)
 * @returns Array of text chunks, each ≤ maxChars
 */
export function chunkForTelegram(
  text: string,
  maxChars: number = 4096,
): string[] {
  if (text.length <= maxChars) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Text fits in remaining space
    if (remaining.length <= maxChars) {
      chunks.push(remaining)
      break
    }

    // Find split point: prefer paragraph breaks (\n\n)
    const chunk = remaining.substring(0, maxChars)
    const lastDoublNewline = chunk.lastIndexOf('\n\n')

    if (lastDoublNewline > maxChars * 0.5) {
      // Found paragraph break in second half of chunk
      chunks.push(chunk.substring(0, lastDoublNewline))
      remaining = remaining.substring(lastDoublNewline + 2)
      continue
    }

    // Fallback: use single newline
    const lastNewline = chunk.lastIndexOf('\n')
    if (lastNewline > maxChars * 0.5) {
      chunks.push(chunk.substring(0, lastNewline))
      remaining = remaining.substring(lastNewline + 1)
      continue
    }

    // Last resort: split at maxChars
    chunks.push(chunk)
    remaining = remaining.substring(maxChars)
  }

  return chunks
}

/**
 * Calculate the estimated character count for a formatted result
 * Useful for determining if the result will fit in Telegram message limits
 *
 * @param formattedResult - The result from formatResult()
 * @returns Total characters across all messages
 */
export function estimateTelegramSize(formattedResult: FormattedResult): number {
  return formattedResult.messages.reduce((sum, msg) => sum + msg.length, 0)
}
