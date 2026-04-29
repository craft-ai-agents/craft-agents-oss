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
const SUPPORTED_TAG_PATTERN = Object.keys(SUPPORTED_HTML_TAGS).join('|')
const TELEGRAM_TAG_RE = new RegExp(`<a\\s+href=("|')(.*?)\\1\\s*>|<\\/a>|<(\\/?)\\s*(${SUPPORTED_TAG_PATTERN})\\s*>`, 'gi')
const TELEGRAM_CODE_CLASS_RE = /<code\s+class=("|')[^"']*\1\s*>/gi
const TELEGRAM_RENDERED_TAG_RE = /<a href="[^"]*">|<\/a>|<\/?(?:b|i|u|s|code|pre|blockquote)>/gi
const TELEGRAM_SUPPORTED_ENTITY_RE = /&(lt|gt|amp|quot);|&#(\d+);|&#x([0-9a-fA-F]+);/gi

function stash(replacements: string[], value: string): string {
  const index = replacements.push(value) - 1
  return `${PLACEHOLDER_START}${index}${PLACEHOLDER_END}`
}

function restore(text: string, replacements: string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (match, index) => replacements[Number(index)] ?? match)
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&(?!(?:lt|gt|amp|quot|#\d+|#x[0-9a-fA-F]+);)/gi, '&amp;')
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

function decodeTelegramEntity(
  match: string,
  named?: string,
  decimal?: string,
  hex?: string,
): string {
  if (named === 'lt') return '<'
  if (named === 'gt') return '>'
  if (named === 'amp') return '&'
  if (named === 'quot') return '"'

  const codePoint = decimal
    ? Number.parseInt(decimal, 10)
    : hex
      ? Number.parseInt(hex, 16)
      : Number.NaN

  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
    return match
  }

  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return match
  }
}

export function sanitizeTelegramHtml(text: string): string {
  const normalizedInput = text.replace(TELEGRAM_CODE_CLASS_RE, '<code>')
  const replacements: string[] = []
  const stack: string[] = []
  let malformed = false
  let lastIndex = 0
  let out = ''

  let match: RegExpExecArray | null
  while ((match = TELEGRAM_TAG_RE.exec(normalizedInput)) !== null) {
    const full = match[0]
    const index = match.index
    out += normalizedInput.slice(lastIndex, index)
    lastIndex = index + full.length

    const href = match[2]
    const slash = match[3]
    const tag = match[4]
    const lastTag = stack[stack.length - 1]

    if (full.toLowerCase() === '</a>') {
      if (lastTag !== 'a') {
        malformed = true
        out += full
      } else {
        stack.pop()
        out += stash(replacements, '</a>')
      }
      continue
    }

    if (href !== undefined) {
      const safeHref = sanitizeUrl(href.trim())
      if (!safeHref) {
        malformed = true
        out += full
      } else {
        stack.push('a')
        out += stash(replacements, `<a href="${escapeTelegramAttribute(safeHref)}">`)
      }
      continue
    }

    const normalized = tag ? SUPPORTED_HTML_TAGS[tag.toLowerCase()] : undefined
    if (!normalized) {
      malformed = true
      out += full
      continue
    }

    if (slash) {
      if (lastTag !== normalized) {
        malformed = true
        out += full
      } else {
        stack.pop()
        out += stash(replacements, `</${normalized}>`)
      }
      continue
    }

    stack.push(normalized)
    out += stash(replacements, `<${normalized}>`)
  }
  TELEGRAM_TAG_RE.lastIndex = 0

  out += normalizedInput.slice(lastIndex)

  if (malformed || stack.length > 0) {
    return escapeTelegramHtml(normalizedInput)
  }

  return restore(escapeTelegramHtml(out), replacements)
}

function telegramHtmlToRenderedText(text: string, includeHrefTargets: boolean): string {
  const sanitized = sanitizeTelegramHtml(text)
  const withLinks = includeHrefTargets
    ? sanitized.replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/gi, '$2 ($1)')
    : sanitized

  return withLinks
    .replace(TELEGRAM_RENDERED_TAG_RE, '')
    .replace(TELEGRAM_SUPPORTED_ENTITY_RE, decodeTelegramEntity)
}

export function telegramHtmlToPlainText(text: string): string {
  return telegramHtmlToRenderedText(text, true)
}

export function getTelegramHtmlTextLength(text: string): number {
  return telegramHtmlToRenderedText(text, false).length
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
