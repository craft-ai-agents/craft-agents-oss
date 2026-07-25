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
  // Local markdown images are loaded through PlatformContext by Markdown.tsx.
  // Preserve file:// here so the custom image component can convert it to a
  // filesystem path; ReactMarkdown's default transform strips file: URLs.
  if (key === 'src' && tagName === 'img' && /^file:/i.test(value)) return value
  return defaultUrlTransform(value)
}
