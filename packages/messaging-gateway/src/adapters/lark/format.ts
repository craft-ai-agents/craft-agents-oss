/**
 * Markdown → Lark `post` converter.
 *
 * Lark/Feishu's `post` rich-text type is a structured JSON format with a
 * subset of formatting (bold, italic, strikethrough, links, code blocks).
 * Headers, lists, and tables have no native equivalents — those fall through
 * as plain text within `text` elements.
 *
 * Returns `{ kind: 'text', text }` when the input has no formatting cues so
 * the adapter can dispatch the lighter `text` message type. Returns
 * `{ kind: 'post', post }` otherwise.
 *
 * The parser handles only the inline subset described above. Nested styles
 * (bold-inside-italic) work via a state machine; deeper nesting and obscure
 * Markdown edge-cases are intentionally not supported — keeping scope narrow
 * limits the bug surface that haunts richer Markdown converters.
 */

export type LarkPostStyle = 'bold' | 'italic' | 'underline' | 'strikethrough'

export type LarkPostElement =
  | { tag: 'text'; text: string; style?: LarkPostStyle[] }
  | { tag: 'a'; text: string; href: string; style?: LarkPostStyle[] }
  | { tag: 'code_block'; language?: string; text: string }

export interface LarkPost {
  post: {
    en_us: {
      content: LarkPostElement[][]
    }
  }
}

export type LarkFormatted =
  | { kind: 'text'; text: string }
  | { kind: 'post'; post: LarkPost }

/**
 * Convert agent Markdown output to a Lark wire payload.
 *
 * Coverage:
 *   - `**bold**`              → `text` with `style: ['bold']`
 *   - `*italic*` / `_italic_` → `text` with `style: ['italic']`
 *   - `~~strike~~`            → `text` with `style: ['strikethrough']`
 *   - `[label](url)`          → `a` element
 *   - ` ```lang\ncode``` `    → `code_block` element
 *   - `` `inline` ``          → `text` with `style: ['bold']` (Lark has no
 *                              inline-code element; bold is the closest visual cue)
 *   - `\n\n`                  → new top-level paragraph entry
 *   - `\n` (within paragraph) → handled by Lark's word-wrapping
 *
 * Out of scope (rendered as literal text): headers, lists, tables, images.
 */
export function formatForLarkPost(markdown: string): LarkFormatted {
  const trimmed = markdown.replace(/\r\n/g, '\n')
  const paragraphs = splitParagraphs(trimmed)

  const content: LarkPostElement[][] = []
  let anyStyled = false

  for (const para of paragraphs) {
    const codeMatch = matchCodeBlock(para)
    if (codeMatch) {
      content.push([
        codeMatch.language
          ? { tag: 'code_block', language: codeMatch.language, text: codeMatch.text }
          : { tag: 'code_block', text: codeMatch.text },
      ])
      anyStyled = true
      continue
    }

    const elements = parseInline(para)
    if (elements.some((el) => isStyled(el))) anyStyled = true
    content.push(elements)
  }

  // No styled elements anywhere → plain text path. Reconstruct from elements
  // is unnecessary; the original input was plain.
  if (!anyStyled) {
    return { kind: 'text', text: trimmed }
  }

  return {
    kind: 'post',
    post: { post: { en_us: { content } } },
  }
}

/**
 * Wrap arbitrary text as a trivial post message. Used by `editMessage` when
 * the original send was a `post` and the edit content is plain — Lark
 * requires the new `msg_type` to match the original.
 */
export function wrapAsTrivialPost(text: string): LarkPost {
  return {
    post: {
      en_us: {
        content: [[{ tag: 'text', text }]],
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function splitParagraphs(input: string): string[] {
  // Paragraph break = two or more newlines. Trim trailing whitespace per
  // paragraph but keep internal single-newlines (Lark wraps within a `text`).
  const raw = input.split(/\n{2,}/)
  return raw.map((p) => p.trimEnd()).filter((p) => p.length > 0)
}

function matchCodeBlock(para: string): { language: string | undefined; text: string } | null {
  // Match a paragraph that's a single fenced code block: starts with ```,
  // optional language, content until closing ```. We accept the whole
  // paragraph as a code block only if the fences delimit the entire content.
  const m = para.match(/^```([a-zA-Z0-9_+-]*)\n([\s\S]*?)\n```$/)
  if (!m) return null
  const lang = m[1]?.trim() || undefined
  return { language: lang, text: m[2] ?? '' }
}

function isStyled(el: LarkPostElement): boolean {
  if (el.tag === 'code_block') return true
  if (el.tag === 'a') return true
  if (el.tag === 'text' && el.style && el.style.length > 0) return true
  return false
}

interface InlineToken {
  type: 'text' | 'open' | 'close' | 'link'
  /** For `text`: the literal characters. For `open`/`close`: the style. For `link`: text. */
  value: string
  /** Only on `link` tokens. */
  href?: string
  /** Only on `open`/`close` tokens. */
  style?: LarkPostStyle
}

/**
 * Tokenize + assemble an inline span into Lark `text`/`a` elements.
 *
 * Algorithm: scan the string, recognize formatting markers (`**`, `*`, `_`,
 * `~~`, backtick, `[label](url)`), build a list of tokens, then walk tokens
 * with a style stack to produce elements. Escape characters (`\*` etc.) are
 * preserved as literal text.
 */
function parseInline(input: string): LarkPostElement[] {
  const tokens = tokenizeInline(input)
  const elements: LarkPostElement[] = []
  const styleStack: LarkPostStyle[] = []

  const pushText = (text: string) => {
    if (text.length === 0) return
    const styles = [...styleStack]
    if (styles.length > 0) {
      elements.push({ tag: 'text', text, style: dedupeStyles(styles) })
    } else {
      elements.push({ tag: 'text', text })
    }
  }

  for (const tok of tokens) {
    if (tok.type === 'text') {
      pushText(tok.value)
    } else if (tok.type === 'open' && tok.style) {
      styleStack.push(tok.style)
    } else if (tok.type === 'close' && tok.style) {
      // Pop the most-recent matching style. If the stack is malformed
      // (close without open), treat as a literal — degrade gracefully.
      const idx = styleStack.lastIndexOf(tok.style)
      if (idx >= 0) styleStack.splice(idx, 1)
      else pushText(tok.value)
    } else if (tok.type === 'link' && tok.href) {
      const styles = [...styleStack]
      if (styles.length > 0) {
        elements.push({ tag: 'a', text: tok.value, href: tok.href, style: dedupeStyles(styles) })
      } else {
        elements.push({ tag: 'a', text: tok.value, href: tok.href })
      }
    }
  }

  return mergeAdjacentText(elements)
}

function dedupeStyles(styles: LarkPostStyle[]): LarkPostStyle[] {
  return Array.from(new Set(styles))
}

function mergeAdjacentText(elements: LarkPostElement[]): LarkPostElement[] {
  if (elements.length === 0) return [{ tag: 'text', text: '' }]
  const out: LarkPostElement[] = []
  for (const el of elements) {
    const prev = out[out.length - 1]
    if (
      el.tag === 'text' &&
      prev &&
      prev.tag === 'text' &&
      sameStyle(prev.style, el.style)
    ) {
      prev.text += el.text
    } else {
      out.push(el)
    }
  }
  return out
}

function sameStyle(a?: LarkPostStyle[], b?: LarkPostStyle[]): boolean {
  const aArr = a ?? []
  const bArr = b ?? []
  if (aArr.length !== bArr.length) return false
  return aArr.every((s) => bArr.includes(s))
}

function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let buf = ''
  const flushBuf = () => {
    if (buf.length > 0) {
      tokens.push({ type: 'text', value: buf })
      buf = ''
    }
  }

  // Track which inline styles are currently open so we know whether the next
  // marker should open or close.
  const openStyles = new Set<LarkPostStyle>()

  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    const next = input[i + 1]
    const next2 = input[i + 2]

    // Escape: keep next char as literal
    if (ch === '\\' && next) {
      buf += next
      i += 2
      continue
    }

    // Link: [label](url) — non-greedy on label, parens may contain query strings
    if (ch === '[') {
      const linkMatch = input.slice(i).match(/^\[([^\]]+)\]\((https?:[^)\s]+)\)/)
      if (linkMatch) {
        flushBuf()
        tokens.push({ type: 'link', value: linkMatch[1]!, href: linkMatch[2]! })
        i += linkMatch[0].length
        continue
      }
    }

    // Bold (**) — consume two markers
    if (ch === '*' && next === '*') {
      flushBuf()
      const open = !openStyles.has('bold')
      tokens.push({ type: open ? 'open' : 'close', value: '**', style: 'bold' })
      if (open) openStyles.add('bold')
      else openStyles.delete('bold')
      i += 2
      continue
    }

    // Italic — `*single*` or `_single_`. Standard Markdown rules:
    //   - Open marker: next char must be non-whitespace
    //   - Close marker: previous char must be non-whitespace
    // We track italic with a single open-flag (no marker pairing across mixed
    // `*`/`_`) since Lark `post` doesn't differentiate.
    if ((ch === '*' || ch === '_') && next !== ch) {
      if (openStyles.has('italic')) {
        // Closing case — previous char must be non-whitespace.
        const prevChar = buf.length > 0 ? buf[buf.length - 1] : input[i - 1]
        if (prevChar && prevChar !== ' ' && prevChar !== '\n') {
          flushBuf()
          tokens.push({ type: 'close', value: ch, style: 'italic' })
          openStyles.delete('italic')
          i += 1
          continue
        }
      } else if (next && next !== ' ' && next !== '\n') {
        // Opening case — must have a corresponding close later.
        const closeIdx = findClosingMarker(input, i + 1, ch)
        if (closeIdx > 0) {
          flushBuf()
          tokens.push({ type: 'open', value: ch, style: 'italic' })
          openStyles.add('italic')
          i += 1
          continue
        }
      }
    }

    // Strikethrough (~~)
    if (ch === '~' && next === '~') {
      flushBuf()
      const open = !openStyles.has('strikethrough')
      tokens.push({ type: open ? 'open' : 'close', value: '~~', style: 'strikethrough' })
      if (open) openStyles.add('strikethrough')
      else openStyles.delete('strikethrough')
      i += 2
      continue
    }

    // Inline code — backtick delimited; map to bold per documented fallback
    if (ch === '`' && next !== '`') {
      const closeIdx = input.indexOf('`', i + 1)
      if (closeIdx > i) {
        flushBuf()
        tokens.push({ type: 'open', value: '`', style: 'bold' })
        tokens.push({ type: 'text', value: input.slice(i + 1, closeIdx) })
        tokens.push({ type: 'close', value: '`', style: 'bold' })
        i = closeIdx + 1
        continue
      }
    }

    // Suppress unused-var warning from the lookahead variable
    void next2

    buf += ch
    i += 1
  }

  flushBuf()
  return tokens
}

/**
 * Find the index of the next single-char marker (`*` or `_`) that's a valid
 * closing position. Closing position = char before the marker is non-space
 * AND the marker isn't immediately followed by another marker of the same kind.
 */
function findClosingMarker(input: string, from: number, marker: string): number {
  for (let j = from; j < input.length; j++) {
    if (input[j] !== marker) continue
    if (input[j + 1] === marker) continue
    const prev = input[j - 1]
    if (prev === ' ' || prev === '\n') continue
    return j
  }
  return -1
}
