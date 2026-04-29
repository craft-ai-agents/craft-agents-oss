/**
 * Telegram outbound text formatting helpers.
 *
 * Plain text remains plain by default. Callers must explicitly request
 * `format: 'html'` to send Telegram HTML.
 */

import type { OutboundTextOptions } from '../../types'

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

export function sanitizeTelegramHtml(text: string): string {
  const replacements: string[] = []

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

  return restore(escapeTelegramHtml(out), replacements)
}

export function prepareTelegramText(
  text: string,
  options?: OutboundTextOptions,
): { text: string; parseMode?: typeof TELEGRAM_PARSE_MODE } {
  if (options?.format === 'html') {
    return {
      text: sanitizeTelegramHtml(text),
      parseMode: TELEGRAM_PARSE_MODE,
    }
  }

  return { text }
}
