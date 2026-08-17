/**
 * Craft Pages — filesystem containment guard (ADR 0001 D9).
 *
 * Deliberately NOT `validateFilePath` from ../handlers/utils.ts. That function
 * resolves symlinks and THEN checks the result against
 * `[homedir(), tmpdir(), ...additional]`, so a symlink inside a page directory
 * pointing at `~/.craft-agent/credentials.enc` resolves under `homedir()` and
 * is accepted. Measured in WS0:
 *
 *   validateFilePath()  ACCEPTED -> …/.craft-agent/credentials.enc
 *   this guard          rejected
 *
 * (`validateFilePath` does carry a sensitive-file denylist, but `credentials.enc`
 * matches none of its nine patterns — `credentials\.json$` needs `.json`,
 * `secrets?\.` needs "secret." — so the denylist does not save it.)
 *
 * Two independent layers, both required:
 *   1. pure string rules, shared with the authoring side so the two cannot
 *      drift (`checkRelPath` from @craft-agent/session-tools-core)
 *   2. filesystem reality — canonicalise, contain, and reject symlinked
 *      components, which string rules cannot see
 */

import { lstat, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { checkRelPath } from '@craft-agent/session-tools-core'

export type ContainmentResult =
  | { ok: true; absolutePath: string }
  | { ok: false; status: 400 | 404; reason: string }

const reject = (status: 400 | 404, reason: string): ContainmentResult =>
  ({ ok: false, status, reason })

/**
 * Decode a URL path segment sequence exactly once and reject anything that
 * still looks encoded afterwards.
 *
 * Double-decoding is a classic traversal vector: `%252e%252e` decodes to
 * `%2e%2e`, which a second decode turns into `..`. We decode once, then require
 * the result to contain no `%` at all, so a value that was double-encoded is
 * rejected rather than quietly normalised.
 */
function decodeOnce(raw: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null // malformed percent-encoding
  }
  if (decoded.includes('%')) return null
  return decoded
}

/**
 * Resolve a request path against a page's public root.
 *
 * @param publicRoot absolute path to `{…}/revisions/{rev}/public`
 * @param rawUrlPath the URL path AFTER the route prefix, still percent-encoded
 */
export async function resolveWithinPublicRoot(
  publicRoot: string,
  rawUrlPath: string,
): Promise<ContainmentResult> {
  const decoded = decodeOnce(rawUrlPath)
  if (decoded === null) {
    return reject(400, 'malformed or double percent-encoding in path')
  }

  // The route hands us the path after its prefix, which may carry a leading
  // slash. Strip it before anything else — checkRelPath rejects absolute paths,
  // so leaving it on would 400 every legitimate request.
  const trimmed = decoded.replace(/^\/+/, '')

  // Directory-style URLs resolve to index.html; a listing is never served.
  //
  // The third case matters for real sites: the reference target uses pretty
  // URLs like `/en/`, and browsers and hand-written links routinely drop the
  // trailing slash. Treating an extensionless final segment as a directory is
  // ordinary static-server behaviour. It is done as a pure string rule rather
  // than by probing the filesystem, so no path is touched before containment
  // has been established.
  const lastSegment = trimmed.split('/').pop() ?? ''
  const relPath =
    trimmed === '' || trimmed.endsWith('/')
      ? `${trimmed}index.html`
      : !lastSegment.includes('.')
        ? `${trimmed}/index.html`
        : trimmed

  // Layer 1: the same string rules the authoring side enforces.
  const stringCheck = checkRelPath(relPath)
  if (!stringCheck.ok) return reject(400, stringCheck.reason)

  // Layer 2: filesystem reality.
  const realRoot = await realpath(publicRoot).catch(() => null)
  if (realRoot === null) return reject(404, 'page revision not found')

  const candidate = resolve(join(realRoot, relPath))
  if (candidate !== realRoot && !candidate.startsWith(realRoot + sep)) {
    return reject(400, 'path escapes the page root')
  }

  // Reject if ANY component below the root is a symlink. Checking only the
  // final realpath is not enough: a symlinked *directory* mid-path would
  // otherwise let a request walk outside the page.
  const segments = candidate.slice(realRoot.length).split(sep).filter(Boolean)
  let walk = realRoot
  for (const segment of segments) {
    walk = join(walk, segment)
    const st = await lstat(walk).catch(() => null)
    if (st === null) return reject(404, 'not found')
    if (st.isSymbolicLink()) return reject(400, 'symlinked path component')
    if (st.isDirectory()) continue
    if (!st.isFile()) return reject(400, 'not a regular file')
  }

  const finalStat = await lstat(candidate).catch(() => null)
  if (finalStat === null) return reject(404, 'not found')
  if (finalStat.isDirectory()) return reject(404, 'directory listings are not served')
  if (!finalStat.isFile()) return reject(400, 'not a regular file')

  return { ok: true, absolutePath: candidate }
}

/** Methods a page route may answer. Anything else is 405. */
export function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}
