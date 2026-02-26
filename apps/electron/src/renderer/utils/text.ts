import { remark } from 'remark'
import strip from 'strip-markdown'

// Pre-configured processor (reusable, avoids creating per call)
const processor = remark().use(strip)

// Regex to match emoji characters (using Unicode property escapes)
const EMOJI_REGEX = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu

/**
 * Strip markdown formatting and emojis using remark AST parser.
 * Uses strip-markdown plugin from the unified/remark ecosystem.
 */
export function stripMarkdown(text: string): string {
  if (!text) return ''

  // Process synchronously (strip-markdown is sync)
  const result = processor.processSync(text)

  // remark/strip-markdown may leave backslash escapes (e.g. \_word\_) in the
  // output when it removes emphasis markers. Unescape them so OS notifications
  // display clean plain text instead of raw markdown escape sequences.
  return String(result)
    .replace(/\\([_*`[\]\\~|>])/g, '$1')
    .replace(EMOJI_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
}
