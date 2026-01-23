/**
 * WhatsApp Result Formatter
 *
 * Converts agent output (Message array from Claude Agent SDK) into
 * WhatsApp-compatible message format with 4096 character limit per message.
 *
 * Strategy:
 * - Small results (≤4096 chars): Send as-is with citations
 * - Large results (>4096 chars): Send summary + deep link to desktop session
 */

import type { Message } from '@anthropic-ai/sdk/resources/messages'

export interface FormattedResult {
  /** Array of WhatsApp messages (≤4096 chars each) */
  messages: string[]
  /** One-liner summary (max ~100 chars) */
  summary: string
  /** Full untruncated result in markdown */
  fullMarkdown: string
  /** True if result was split across multiple messages or truncated */
  truncated: boolean
}

/**
 * Format agent output for WhatsApp constraints
 *
 * WhatsApp has ~4096 character limit per message.
 * For small results, we preserve full formatting and citations.
 * For large results, we provide a summary with a deep link.
 *
 * @param sessionMessages - Array of messages from the SDK session
 * @param sessionId - Session ID for deep linking (e.g., "whatsapp_group::sender")
 * @param maxChars - Maximum characters per WhatsApp message (default 4096)
 * @returns FormattedResult with messages, summary, and metadata
 */
export function formatResult(
  sessionMessages: Message[],
  sessionId: string,
  maxChars: number = 4096,
): FormattedResult {
  // Extract assistant text and tool results
  const assistantTexts: string[] = []

  for (const msg of sessionMessages) {
    if (msg.role === 'assistant' && msg.content) {
      for (const block of msg.content) {
        if (block.type === 'text') {
          assistantTexts.push(block.text)
        }
      }
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

  // Too large: send summary + link to full session in desktop app
  return {
    messages: [
      `📱 **Research Results**\n\n` +
        `Summary:\n${summary}\n\n` +
        `🔗 [View full details in Vespr](vespr://session/${sessionId})`,
    ],
    summary,
    fullMarkdown: citedText,
    truncated: true,
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
    if (msg.role === 'user' && msg.content) {
      // Tool results are in user messages (responses from tools)
      for (const block of msg.content) {
        if (block.type === 'toolResult' && block.content) {
          // Extract URLs from tool result content
          const urls = block.content.match(/https?:\/\/[^\s)>\]]+/g) || []
          urls.forEach((url: string) => {
            // Clean up URL if it has trailing punctuation
            const cleaned = url.replace(/[.,;:!?"\]}\)]*$/, '')
            sources.add(cleaned)
          })
        }
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
 * Split large text into WhatsApp-compatible chunks
 *
 * Intelligently breaks text at paragraph boundaries when possible
 * to avoid breaking up formatted content.
 *
 * @param text - Text to split
 * @param maxChars - Maximum characters per chunk (default 4096)
 * @returns Array of text chunks, each ≤ maxChars
 */
export function chunkForWhatsApp(
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
 * Useful for determining if the result will fit in WhatsApp message limits
 *
 * @param formattedResult - The result from formatResult()
 * @returns Total characters across all messages
 */
export function estimateWhatsAppSize(formattedResult: FormattedResult): number {
  return formattedResult.messages.reduce((sum, msg) => sum + msg.length, 0)
}
