import { isFilePathTarget, decodeFilePathHref } from './linkify'

/**
 * Classify markdown link targets for click dispatch.
 * File paths are handled by onFileClick; everything else is treated as a URL.
 *
 * Decodes percent-encoded hrefs first so that paths with spaces, brackets,
 * or Unicode characters (e.g. CJK) are correctly recognised as files.
 */
export function classifyMarkdownLinkTarget(target: string): 'file' | 'url' {
  // Try decoding first — markdown renderers percent-encode special characters
  const decoded = decodeFilePathHref(target)
  return isFilePathTarget(decoded) ? 'file' : 'url'
}

export { decodeFilePathHref }
