import { isFilePathTarget } from './linkify'

export type ResolvedMarkdownLinkTarget =
  | { kind: 'file'; path: string }
  | { kind: 'url'; url: string }

function normalizeFileUrlPath(path: string): string {
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}

/**
 * Percent-decode a bare file path so a link destination with %20 (the only
 * CommonMark-legal way to encode a space in a bare destination) resolves to the
 * real on-disk path. No-op when there's no '%'; falls back to the raw string if
 * the value isn't valid percent-encoding (#944).
 */
function decodeFilePath(path: string): string {
  if (!path.includes('%')) return path
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function resolveFileUrlPath(target: string): string | null {
  if (!/^file:/i.test(target)) return null

  try {
    const parsed = new URL(target)
    if (parsed.protocol !== 'file:') return null

    const pathname = decodeURIComponent(parsed.pathname || '')
    if (!pathname && !parsed.hostname) return null

    if (parsed.hostname) {
      const hostname = decodeURIComponent(parsed.hostname)
      return normalizeFileUrlPath(`//${hostname}${pathname}`)
    }

    return normalizeFileUrlPath(pathname)
  } catch {
    return null
  }
}

/**
 * Resolve markdown link targets for click dispatch.
 *
 * - Raw filesystem paths are routed through onFileClick
 * - Explicit file:// URLs are normalized to filesystem paths and also routed through onFileClick
 * - Everything else is treated as a URL and routed through onUrlClick
 */
export function resolveMarkdownLinkTarget(target: string): ResolvedMarkdownLinkTarget {
  const trimmed = target.trim()

  const fileUrlPath = resolveFileUrlPath(trimmed)
  if (fileUrlPath) {
    return { kind: 'file', path: fileUrlPath }
  }

  if (isFilePathTarget(trimmed)) {
    return { kind: 'file', path: decodeFilePath(trimmed) }
  }

  return { kind: 'url', url: trimmed }
}

/**
 * Backward-compatible classifier for tests and existing callers that only need the kind.
 */
export function classifyMarkdownLinkTarget(target: string): 'file' | 'url' {
  return resolveMarkdownLinkTarget(target).kind
}

/** A click on a file link: where the link is, so the host can show choices next to it, and whether ⌥/Alt was held. */
export interface FileLinkClick {
  /** The link's box in viewport pixels; for a link that wraps, the line that was clicked. */
  anchor: { x: number; y: number; width: number; height: number }
  /** ⌥/Alt held: open the file right away instead of offering choices. */
  altKey: boolean
}

/**
 * Opens a local file. `click` is set only when the request comes from clicking a file link, so a
 * host can offer choices there and keep its direct behavior for every other caller.
 */
export type FileOpenHandler = (path: string, click?: FileLinkClick) => void

/** The parts of a link's click event that `describeFileLinkClick` reads. */
export interface FileLinkClickEvent {
  currentTarget: Pick<Element, 'getClientRects' | 'getBoundingClientRect'>
  /** Click count; 0 when the link was activated from the keyboard, which has no pointer position. */
  detail: number
  clientY: number
  altKey: boolean
}

export function describeFileLinkClick(event: FileLinkClickEvent): FileLinkClick {
  const lines = Array.from(event.currentTarget.getClientRects())
  const clickedLine = event.detail > 0
    ? lines.find((line) => event.clientY >= line.top && event.clientY <= line.bottom)
    : undefined
  const box = clickedLine ?? lines[0] ?? event.currentTarget.getBoundingClientRect()
  return {
    anchor: { x: box.left, y: box.top, width: box.width, height: box.height },
    altKey: event.altKey,
  }
}
