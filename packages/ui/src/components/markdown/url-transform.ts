import { defaultUrlTransform, type UrlTransform } from 'react-markdown'

export const markdownUrlTransform: UrlTransform = (value, key, node) => {
  const tagName = typeof node === 'object' && node && 'tagName' in node
    ? String((node as { tagName?: unknown }).tagName)
    : ''

  // ReactMarkdown's default transform strips file:/javascript:/data: before
  // custom components receive props. For anchors, preserve the original target
  // so our custom <a> can route normal clicks through onFileClick/onUrlClick
  // while still writing a separately sanitized DOM href. Keep default
  // sanitization for images and every other URL-bearing attribute.
  if (key === 'href' && tagName === 'a') return value
  return defaultUrlTransform(value)
}
