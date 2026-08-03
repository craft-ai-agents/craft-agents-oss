/**
 * Browser-safe `path` shim for the renderer.
 *
 * Vite externalizes Node builtins for the browser, so any renderer code (ours
 * or a dependency's) that transitively imports `path` throws
 * "Module 'path' has been externalized for browser compatibility" the moment a
 * member is accessed — which blanks the whole window because it happens during
 * render.
 *
 * This provides the pure string-manipulation subset of `path` (POSIX
 * semantics, tolerant of Windows separators), which is all a renderer can
 * legitimately need. Anything filesystem-backed belongs in the main process
 * behind IPC.
 */

const SEP_RE = /[\\/]+/

function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/')
}

function splitParts(p: string): string[] {
  return normalizeSeparators(p).split('/')
}

export function basename(p: string, ext?: string): string {
  const parts = splitParts(p).filter(Boolean)
  const base = parts.length > 0 ? parts[parts.length - 1]! : ''
  if (ext && base.endsWith(ext) && base !== ext) {
    return base.slice(0, -ext.length)
  }
  return base
}

export function extname(p: string): string {
  const base = basename(p)
  const dot = base.lastIndexOf('.')
  // A leading dot is part of the name (".gitignore"), not an extension.
  if (dot <= 0) return ''
  return base.slice(dot)
}

export function dirname(p: string): string {
  const normalized = normalizeSeparators(p)
  const trimmed = normalized.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return '.'
  if (idx === 0) return '/'
  return trimmed.slice(0, idx)
}

export function normalize(p: string): string {
  const normalized = normalizeSeparators(p)
  const isAbsolute_ = normalized.startsWith('/')
  const out: string[] = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute_) out.push('..')
      continue
    }
    out.push(part)
  }
  const joined = out.join('/')
  if (isAbsolute_) return `/${joined}`
  return joined || '.'
}

export function join(...segments: string[]): string {
  const filtered = segments.filter(s => typeof s === 'string' && s.length > 0)
  if (filtered.length === 0) return '.'
  return normalize(filtered.join('/'))
}

export function isAbsolute(p: string): boolean {
  const normalized = normalizeSeparators(p)
  // POSIX root or a Windows drive letter ("C:/...").
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
}

export function resolve(...segments: string[]): string {
  let resolved = ''
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (!segment) continue
    resolved = resolved ? `${segment}/${resolved}` : segment
    if (isAbsolute(segment)) break
  }
  // No cwd in the browser — treat an unrooted result as root-relative.
  const normalized = normalize(resolved || '/')
  return isAbsolute(normalized) ? normalized : `/${normalized}`
}

export function relative(from: string, to: string): string {
  const fromParts = normalize(resolve(from)).split(SEP_RE).filter(Boolean)
  const toParts = normalize(resolve(to)).split(SEP_RE).filter(Boolean)

  let shared = 0
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared++
  }

  const up = new Array(fromParts.length - shared).fill('..')
  return [...up, ...toParts.slice(shared)].join('/')
}

export function parse(p: string) {
  const ext = extname(p)
  return {
    root: isAbsolute(p) ? '/' : '',
    dir: dirname(p),
    base: basename(p),
    ext,
    name: basename(p, ext),
  }
}

export function format(parsed: { dir?: string; root?: string; base?: string; name?: string; ext?: string }): string {
  const base = parsed.base ?? `${parsed.name ?? ''}${parsed.ext ?? ''}`
  const dir = parsed.dir ?? parsed.root ?? ''
  return dir ? `${dir}/${base}` : base
}

export const sep = '/'
export const delimiter = ':'

const posix = {
  basename,
  extname,
  dirname,
  normalize,
  join,
  isAbsolute,
  resolve,
  relative,
  parse,
  format,
  sep,
  delimiter,
}

export { posix, posix as win32 }

export default { ...posix, posix, win32: posix }
