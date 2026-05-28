/**
 * WeChat IM renders plain text only (no Markdown). The agent's output is
 * Markdown, so we strip the common syntax down to readable plain text before
 * sending — mirrors the role of the Lark adapter's `stripMarkdownForLarkText`.
 */
export function stripMarkdownForWeChat(input: string): string {
  if (!input) return ''
  let t = input

  // Fenced code blocks: ```lang\n...\n``` → keep the inner code.
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => code.replace(/\n$/, ''))
  // Inline code: `x` → x
  t = t.replace(/`([^`]+)`/g, '$1')
  // Images: ![alt](url) → "alt (url)" or just url
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, url: string) =>
    alt ? `${alt} (${url})` : url,
  )
  // Links: [text](url) → "text (url)"
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, text: string, url: string) => `${text} (${url})`)
  // Bold: **x** / __x__ → x
  t = t.replace(/(\*\*|__)(.+?)\1/g, '$2')
  // Italic: *x* / _x_ → x
  t = t.replace(/(\*|_)(.+?)\1/g, '$2')
  // Strikethrough: ~~x~~ → x
  t = t.replace(/~~(.+?)~~/g, '$1')
  // Headings: leading #'s
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  // Blockquotes: leading >
  t = t.replace(/^\s{0,3}>\s?/gm, '')

  return t.trim()
}
