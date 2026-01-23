/**
 * Tests for result-formatter.ts
 *
 * Tests cover:
 * - Small results that fit in single message
 * - Large results that trigger summary + link
 * - Edge cases around 4096 character boundary
 * - Source extraction and citation formatting
 * - Chunking logic
 */

import { describe, it, expect } from 'bun:test'
import {
  formatResult,
  chunkForWhatsApp,
  estimateWhatsAppSize,
} from '../result-formatter'
import type { Message, MessageRole } from '@craft-agent/core/types'

// Helper to create mock Message objects matching internal Vespr Message type
function createMockMessage(role: MessageRole, content: { type: string; text?: string; content?: string; name?: string; id?: string; input?: unknown }[]): Message {
  // Extract text content from content blocks (Vespr Message has content as string)
  const textContent = content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')

  // Extract tool result content
  const toolResultContent = content
    .filter((block) => block.type === 'tool_result' && block.content)
    .map((block) => block.content)
    .join('\n')

  return {
    id: 'msg_' + Math.random().toString(36).slice(2),
    role,
    content: textContent || toolResultContent || '',
    timestamp: Date.now(),
    // Include toolResult for tool_result content blocks
    ...(toolResultContent && { toolResult: toolResultContent }),
  }
}

describe('formatResult', () => {
  it('small result fits in single message', () => {
    const smallMessages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'Hello! This is a short response.',
        },
      ]),
    ]

    const result = formatResult(smallMessages, 'session-1')

    expect(result.messages.length).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.messages[0]).toBe('Hello! This is a short response.')
  })

  it('medium result (4KB-16KB) chunks into multiple messages', () => {
    const mediumText = 'x'.repeat(5000) // Exceeds 4096 limit but under 16KB
    const mediumMessages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: mediumText,
        },
      ]),
    ]

    const result = formatResult(mediumMessages, 'whatsapp_group::sender')

    // Medium results get chunked into multiple messages
    expect(result.messages.length).toBeGreaterThan(1)
    expect(result.truncated).toBe(true)
    // Each chunk should respect the 4096 limit
    result.messages.forEach((msg) => {
      expect(msg.length).toBeLessThanOrEqual(4096)
    })
  })

  it('very large result (>16KB) includes summary + deep link', () => {
    const veryLargeText = 'x'.repeat(20000) // Exceeds 16KB limit
    const largeMessages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: veryLargeText,
        },
      ]),
    ]

    const result = formatResult(largeMessages, 'whatsapp_group::sender')

    // Very large results use preview + deep link
    expect(result.messages.length).toBe(1)
    expect(result.truncated).toBe(true)
    expect(result.messages[0]).toContain('View full result in Vespr')
    expect(result.deepLink).toBeDefined()
  })

  it('4096 char edge case fits in single message', () => {
    const exactLimitMessage = 'a'.repeat(4096)
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: exactLimitMessage,
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.messages.length).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.messages[0]?.length).toBe(4096)
  })

  it('4097 chars triggers chunking into multiple messages', () => {
    const overLimitMessage = 'a'.repeat(4097)
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: overLimitMessage,
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    // Just over the limit gets chunked (not deep link, that's for >16KB)
    expect(result.messages.length).toBeGreaterThan(1)
    expect(result.truncated).toBe(true)
    // First chunk should be at the limit
    expect(result.messages[0]?.length).toBeLessThanOrEqual(4096)
  })

  it('extracts and formats sources from tool results', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'Found some information.',
        },
      ]),
      createMockMessage('user', [
        {
          type: 'tool_result',
          content:
            'Result from https://example.com/article and https://test.org/page',
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.fullMarkdown).toContain('https://example.com/article')
    expect(result.fullMarkdown).toContain('https://test.org/page')
    expect(result.fullMarkdown).toContain('📋 **Sources:**')
  })

  it('generates appropriate one-liner summary', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'This is a detailed explanation with lots of information. It continues here. And more details.',
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    // Summary should be the first sentence or truncated
    expect(result.summary.length).toBeLessThanOrEqual(100)
    expect(result.summary).toBeTruthy()
  })

  it('combines multiple assistant messages', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'First part of response.',
        },
      ]),
      createMockMessage('user', [
        {
          type: 'text',
          text: 'User question',
        },
      ]),
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'Second part of response.',
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.fullMarkdown).toContain('First part of response')
    expect(result.fullMarkdown).toContain('Second part of response')
  })

  it('handles empty assistant messages gracefully', () => {
    const messages = [
      createMockMessage('assistant', []),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.messages.length).toBeGreaterThan(0)
    expect(result.summary).toBeTruthy()
  })

  it('respects custom maxChars parameter', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'a'.repeat(1000),
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1', 'default', 500) // Custom limit

    expect(result.truncated).toBe(true)
  })

  it('preserves full markdown in fullMarkdown field', () => {
    const longText = 'x'.repeat(5000)
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: longText,
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.fullMarkdown.length).toBeGreaterThan(4096)
    expect(result.fullMarkdown).toContain('xxx')
  })
})

describe('chunkForWhatsApp', () => {
  it('returns single chunk for small text', () => {
    const text = 'Short text'
    const chunks = chunkForWhatsApp(text)

    expect(chunks.length).toBe(1)
    expect(chunks[0]).toBe(text)
  })

  it('splits large text into multiple chunks', () => {
    const text = 'x'.repeat(10000)
    const chunks = chunkForWhatsApp(text, 4096)

    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    })
  })

  it('preserves paragraph breaks when possible', () => {
    const text = 'First paragraph.\n\nSecond paragraph that is very long.\n\n' + 'x'.repeat(5000)
    const chunks = chunkForWhatsApp(text, 4096)

    // Should break at double newline when possible
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  it('reconstructs text correctly from chunks', () => {
    const original = 'A'.repeat(3000) + '\n\n' + 'B'.repeat(3000)
    const chunks = chunkForWhatsApp(original, 4096)
    const reconstructed = chunks.join('')

    expect(reconstructed).toContain('A'.repeat(3000))
    expect(reconstructed).toContain('B'.repeat(3000))
  })

  it('each chunk respects max character limit', () => {
    const text = 'x'.repeat(20000)
    const maxChars = 2000
    const chunks = chunkForWhatsApp(text, maxChars)

    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(maxChars)
    })
  })

  it('handles newline-containing text', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join('\n')
    const chunks = chunkForWhatsApp(text, 1000)

    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(1000)
    })
  })
})

describe('estimateWhatsAppSize', () => {
  it('calculates total size of all messages', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'Short response that fits.',
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')
    const size = estimateWhatsAppSize(result)

    expect(size).toBe(result.messages[0]?.length ?? 0)
  })

  it('calculates size correctly for multiple messages', () => {
    const msg1 = 'a'.repeat(2000)
    const msg2 = 'b'.repeat(1500)
    const mockResult = {
      messages: [msg1, msg2],
      summary: 'test',
      fullMarkdown: 'test',
      truncated: true,
    }

    const size = estimateWhatsAppSize(mockResult)

    expect(size).toBe(3500)
  })
})

describe('edge cases', () => {
  it('handles messages with no text blocks', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'tool_use',
          name: 'some_tool',
          id: 'tool-1',
          input: {},
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.messages.length).toBeGreaterThan(0)
  })

  it('strips trailing punctuation from URLs', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'Check this out.',
        },
      ]),
      createMockMessage('user', [
        {
          type: 'tool_result',
          content: 'Visit https://example.com/article.',
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    // URL should not have trailing period
    expect(result.fullMarkdown).toContain('https://example.com/article')
    expect(result.fullMarkdown).not.toContain('https://example.com/article.')
  })

  it('deduplicates sources', () => {
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: 'Multiple sources.',
        },
      ]),
      createMockMessage('user', [
        {
          type: 'tool_result',
          content:
            'From https://example.com and also https://example.com and https://other.com',
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    // Should have exactly 2 sources (deduplicated)
    const sourceMatches = result.fullMarkdown.match(/https:\/\/[^\s\n]+/g) || []
    const uniqueSources = [...new Set(sourceMatches)]
    expect(uniqueSources.length).toBe(2)
  })

  it('preserves formatting and whitespace in results', () => {
    const formattedText = '# Header\n\n- Item 1\n- Item 2\n\n**Bold** text'
    const messages = [
      createMockMessage('assistant', [
        {
          type: 'text',
          text: formattedText,
        },
      ]),
    ]

    const result = formatResult(messages, 'session-1')

    expect(result.fullMarkdown).toContain('# Header')
    expect(result.fullMarkdown).toContain('- Item 1')
    expect(result.fullMarkdown).toContain('**Bold**')
  })
})
