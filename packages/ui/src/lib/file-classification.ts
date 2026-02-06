/**
 * File type classification for the link interceptor.
 *
 * Classifies file paths by extension to determine whether the app can show
 * an in-app preview overlay, and if so, which type of preview to use.
 * Used by useLinkInterceptor to decide between in-app preview vs. opening externally.
 */

/** Preview types that map to specific overlay components */
export type FilePreviewType = 'image' | 'code' | 'markdown' | 'json' | 'text' | 'pdf'

export interface FileClassification {
  /** The preview type, or null if no in-app preview is available */
  type: FilePreviewType | null
  /** Whether the file can be previewed in-app */
  canPreview: boolean
}

/**
 * Image formats — rendered in ImagePreviewOverlay via data URL.
 * Only includes formats Chromium can natively decode.
 * HEIC/HEIF and TIFF are excluded — Chromium has no codec for these,
 * so they fall through to system open (external app).
 */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
])

/**
 * Code file extensions — rendered in CodePreviewOverlay with syntax highlighting.
 * Mirrors LANGUAGE_MAP from file-utils.ts but as a flat set for classification only.
 */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'cpp', 'h', 'hpp', 'cs',
  'css', 'scss', 'less',
  'html', 'xml', 'svg',  // SVG is also code-viewable, but image takes priority
  'yaml', 'yml', 'toml',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'graphql',
  'dockerfile',
  'makefile',
  'r', 'lua', 'perl', 'php',
])

/** Markdown files — rendered with the Markdown component */
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx'])

/** JSON files — rendered in JSONPreviewOverlay or code viewer */
const JSON_EXTENSIONS = new Set(['json', 'jsonc', 'json5'])

/** Plain text files — rendered as plaintext in code viewer */
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'csv', 'tsv',
  'cfg', 'ini', 'conf',
  'env', 'env.local', 'env.development', 'env.production',
  'gitignore', 'gitattributes', 'editorconfig',
  'npmrc', 'nvmrc',
  'rtf',
])

/** PDF files — rendered in PDFPreviewOverlay via embedded viewer */
const PDF_EXTENSIONS = new Set(['pdf'])

/**
 * Extract the file extension from a path, lowercased.
 * Handles compound extensions like .env.local by returning the last segment.
 * Also handles URLs with query params (e.g., https://host/file.png?sig=xxx)
 */
function getExtension(filePath: string): string {
  // For URLs, strip query params before extracting extension
  let path = filePath
  try {
    const url = new URL(filePath)
    path = url.pathname
  } catch {
    // Not a URL, use as-is
  }

  const basename = path.split('/').pop() ?? path
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === 0) return ''
  return basename.slice(dotIndex + 1).toLowerCase()
}

/**
 * Check if a path is a remote URL (http/https)
 */
export function isRemoteUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

/**
 * Classify a file path by extension to determine preview capability.
 *
 * Priority order when an extension matches multiple sets (e.g. svg):
 * image > code > markdown > json > text > pdf
 */
export function classifyFile(filePath: string): FileClassification {
  const ext = getExtension(filePath)
  if (!ext) return { type: null, canPreview: false }

  if (IMAGE_EXTENSIONS.has(ext))    return { type: 'image', canPreview: true }
  if (MARKDOWN_EXTENSIONS.has(ext)) return { type: 'markdown', canPreview: true }
  if (JSON_EXTENSIONS.has(ext))     return { type: 'json', canPreview: true }
  if (CODE_EXTENSIONS.has(ext))     return { type: 'code', canPreview: true }
  if (TEXT_EXTENSIONS.has(ext))     return { type: 'text', canPreview: true }
  if (PDF_EXTENSIONS.has(ext))      return { type: 'pdf', canPreview: true }

  return { type: null, canPreview: false }
}
