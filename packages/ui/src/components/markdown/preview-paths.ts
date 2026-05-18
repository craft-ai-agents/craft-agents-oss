const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const WINDOWS_DRIVE_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/
const WINDOWS_UNC_ABSOLUTE_RE = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/

function isAbsoluteLocalPath(src: string): boolean {
  return src.startsWith('/') || WINDOWS_DRIVE_ABSOLUTE_RE.test(src) || WINDOWS_UNC_ABSOLUTE_RE.test(src)
}

function isUrlLike(src: string): boolean {
  // Check Windows drive-letter paths before scheme detection so C:/foo is a path, not a URL.
  return !WINDOWS_DRIVE_ABSOLUTE_RE.test(src) && URL_SCHEME_RE.test(src)
}

function normalizeSessionFolderPath(sessionFolderPath: string): string {
  return sessionFolderPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function getSafeSessionRelativePath(src: string): string | null {
  const normalized = src.replace(/\\/g, '/')
  const match = /^(data|plans)\/(.+)$/.exec(normalized)
  if (!match) return null

  const folder = match[1]
  const relativePath = match[2]
  if (!folder || !relativePath) return null
  const segments = relativePath.split('/')

  // Keep support deliberately narrow: no traversal, current-dir segments, empty segments,
  // absolute subpaths, or NUL bytes. The file RPC validates again after resolution.
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    return null
  }

  return `${folder}/${segments.join('/')}`
}

/**
 * Resolve file-backed markdown preview src values.
 *
 * Preview blocks still pass absolute paths to the platform read APIs. This helper adds
 * a small session-context convenience for generated artifacts: when a preview is rendered
 * inside a session, `data/foo.png` and `plans/foo.md` resolve under that session folder.
 */
export function resolveSessionPreviewPath(src: string, sessionFolderPath?: string): string {
  const trimmed = src.trim()
  if (!trimmed) return src
  if (isAbsoluteLocalPath(trimmed) || isUrlLike(trimmed)) return trimmed
  if (!sessionFolderPath) return src

  const safeRelativePath = getSafeSessionRelativePath(trimmed)
  if (!safeRelativePath) return src

  return `${normalizeSessionFolderPath(sessionFolderPath)}/${safeRelativePath}`
}
