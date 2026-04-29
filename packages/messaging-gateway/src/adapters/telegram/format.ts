/**
 * Markdown / limited HTML → Telegram HTML formatting.
 *
 * Telegram supports a small HTML subset via `parse_mode: 'HTML'`. This file
 * converts the most common Markdown emitted by the agent (headings, emphasis,
 * links, inline code, fenced code blocks, lists) and preserves already-valid
 * Telegram HTML tags like `<b>` / `<i>` / `<code>`.
 */

export const TELEGRAM_PARSE_MODE = 'HTML' as const

const PLACEHOLDER_START = '\uE000'
const PLACEHOLDER_END = '\uE001'
const SUPPORTED_HTML_TAGS: Record<string, string> = {
  b: 'b',
  strong: 'b',
  i: 'i',
  em: 'i',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  pre: 'pre',
  blockquote: 'blockquote',
}

function stash(replacements: string[], value: string): string {
  const index = replacements.push(value) - 1
  return `${PLACEHOLDER_START}${index}${PLACEHOLDER_END}`
}

function restore(text: string, replacements: string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (match, index) => replacements[Number(index)] ?? match)
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeTelegramAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, '&quot;')
}

function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function preserveSupportedHtml(text: string, replacements: string[]): string {
  let out = text.replace(/<a\s+href=("|')(.*?)\1\s*>/gi, (match, _quote, href: string) => {
    const safeHref = sanitizeUrl(href.trim())
    if (!safeHref) return match
    return stash(replacements, `<a href="${escapeTelegramAttribute(safeHref)}">`)
  })

  out = out.replace(/<\/a>/gi, () => stash(replacements, '</a>'))

  out = out.replace(/<(\/?)\s*(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote)\s*>/gi, (_match, slash: string, tag: string) => {
    const normalized = SUPPORTED_HTML_TAGS[tag.toLowerCase()]
    return stash(replacements, `<${slash}${normalized}>`)
  })

  return out
}

function formatInline(text: string): string {
  const replacements: string[] = []
  let out = preserveSupportedHtml(text, replacements)

  out = out.replace(/`([^`]+?)`/g, (_match, code: string) => stash(replacements, `<code>${escapeTelegramHtml(code)}</code>`))

  out = out.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, (match, label: string, url: string) => {
    const safeHref = sanitizeUrl(url)
    if (!safeHref) return match
    return stash(replacements, `<a href="${escapeTelegramAttribute(safeHref)}">${formatInline(label)}</a>`)
  })

  out = out.replace(/\*\*(?=\S)(.+?\S)\*\*/g, (_match, content: string) => stash(replacements, `<b>${formatInline(content)}</b>`))
  out = out.replace(/__(?=\S)(.+?\S)__/g, (_match, content: string) => stash(replacements, `<b>${formatInline(content)}</b>`))
  out = out.replace(/~~(?=\S)(.+?\S)~~/g, (_match, content: string) => stash(replacements, `<s>${formatInline(content)}</s>`))
  out = out.replace(/\*(?=\S)(.+?\S)\*(?!\*)/g, (_match, content: string) => stash(replacements, `<i>${formatInline(content)}</i>`))
  out = out.replace(/(^|[^_])_(?=\S)(.+?\S)_(?!_)/g, (_match, prefix: string, content: string) => `${prefix}${stash(replacements, `<i>${formatInline(content)}</i>`)}`)

  out = escapeTelegramHtml(out)
  return restore(out, replacements)
}

function formatLine(line: string): string {
  const headingMatch = line.match(/^#{1,6}\s+(.+)$/)
  if (headingMatch) return `<b>${formatInline(headingMatch[1]!.trim())}</b>`

  const orderedListMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/)
  if (orderedListMatch) {
    const [, indent, index, content] = orderedListMatch
    return `${indent}${index}. ${formatInline(content!)}`
  }

  const unorderedListMatch = line.match(/^(\s*)[-*+]\s+(.+)$/)
  if (unorderedListMatch) {
    const [, indent, content] = unorderedListMatch
    return `${indent}• ${formatInline(content!)}`
  }

  const blockquoteMatch = line.match(/^>\s?(.*)$/)
  if (blockquoteMatch) {
    return `<blockquote>${formatInline(blockquoteMatch[1] ?? '')}</blockquote>`
  }

  return formatInline(line)
}

function renderCodeBlock(code: string): string {
  return `<pre><code>${escapeTelegramHtml(code.replace(/\n+$/g, ''))}</code></pre>`
}

export function formatForTelegram(text: string): string {
  const normalized = normalizeLineEndings(text)
  const replacements: string[] = []

  const withoutCodeBlocks = normalized.replace(/```(?:[A-Za-z0-9_+-]+)?\n?([\s\S]*?)```/g, (_match, code: string) => {
    return stash(replacements, renderCodeBlock(code))
  })

  const formatted = withoutCodeBlocks
    .split('\n')
    .map((line) => line.length === 0 ? '' : formatLine(line))
    .join('\n')

  return restore(formatted, replacements)
}
