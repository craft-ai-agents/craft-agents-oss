/**
 * Requested queries — the agent's REQUEST for live data.
 *
 * This is a PROPOSAL, not an authorization. It lives in `page.json`, which is
 * agent-writable, so a hand-edited manifest can claim any query it likes and
 * nothing here would stop it. The controls that matter run at approval time,
 * in an app-controlled store outside every agent-writable directory: the
 * read-only allowlist, parameter-schema validation, and the fixed-argument
 * collision check (ADR 0001 D6, server-core `grants/store.ts`).
 *
 * What this file buys is that a malformed or abusive request fails at the tool
 * boundary — where the agent gets an error it can act on — instead of reaching
 * the user as a broken or unreadable consent dialog.
 */

/** A query the page wants to run, named so its code can refer to it. */
export interface RequestedQuery {
  /**
   * Stable handle the page's JS uses: `craftQuery('unread', {...})`.
   * The agent cannot know a grant id at authoring time — the user has not
   * approved anything yet — so the name is the indirection between the two.
   */
  name: string;
  sourceSlug: string;
  toolName: string;
  /** Proposed constants. Re-validated and baked at approval time. */
  fixedArgs: Record<string, unknown>;
  /** Proposed runtime parameters. Re-validated at approval time. */
  paramSchema: Record<string, unknown>;
}

/**
 * A page asking for dozens of queries is a consent-fatigue attack: the dialog
 * becomes unreadable and the user approves it to make it stop. Eight is more
 * than any legitimate dashboard has needed in practice.
 */
export const MAX_REQUESTED_QUERIES = 8;

/** Handles appear in page JS, so keep them to what reads as an identifier. */
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** Names that would collide with object machinery once used as a map key. */
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export type ValidateResult =
  | { ok: true; queries: RequestedQuery[] }
  | { ok: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Copy own enumerable keys onto a clean object, dropping `__proto__`.
 *
 * `JSON.parse('{"__proto__": {...}}')` produces an OWN `__proto__` property.
 * Spreading that into a fresh object is safe today, but this record is written
 * to disk, read back, and later merged into connector arguments — so it is
 * normalised once, here, rather than relying on every future consumer.
 */
function sanitize(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === '__proto__') continue;
    out[k] = val;
  }
  return out;
}

export function validateRequestedQueries(input: unknown): ValidateResult {
  if (input === undefined || input === null) return { ok: true, queries: [] };
  if (!Array.isArray(input)) return { ok: false, reason: '"queries" must be an array' };
  if (input.length > MAX_REQUESTED_QUERIES) {
    return { ok: false, reason: `a page may request at most ${MAX_REQUESTED_QUERIES} queries` };
  }

  const queries: RequestedQuery[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (!isPlainObject(raw)) return { ok: false, reason: 'each query must be an object' };

    const { name, sourceSlug, toolName } = raw as Record<string, unknown>;

    if (typeof name !== 'string' || !NAME_RE.test(name) || RESERVED_NAMES.has(name)) {
      return {
        ok: false,
        reason: `query name ${JSON.stringify(name)} must be 1-32 characters of letters, digits, "-" or "_", starting with a letter or digit`,
      };
    }
    // Case-insensitive: two names differing only in case are a confusable pair
    // in page code, and both would resolve through the same lookup.
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, reason: `duplicate query name "${name}"` };
    seen.add(key);

    if (typeof sourceSlug !== 'string' || sourceSlug.length === 0) {
      return { ok: false, reason: `query "${name}" needs a "sourceSlug"` };
    }
    if (typeof toolName !== 'string' || toolName.length === 0) {
      return { ok: false, reason: `query "${name}" needs a "toolName"` };
    }

    const fixedArgs = raw.fixedArgs ?? {};
    const paramSchema = raw.paramSchema ?? {};
    if (!isPlainObject(fixedArgs)) {
      return { ok: false, reason: `query "${name}": "fixedArgs" must be an object` };
    }
    if (!isPlainObject(paramSchema)) {
      return { ok: false, reason: `query "${name}": "paramSchema" must be an object` };
    }

    queries.push({
      name,
      sourceSlug,
      toolName,
      fixedArgs: sanitize(fixedArgs),
      paramSchema: sanitize(paramSchema),
    });
  }

  return { ok: true, queries };
}

/**
 * Read requested queries back off a manifest, dropping anything invalid.
 *
 * Fail-SOFT on read and fail-CLOSED on content: a manifest written by an older
 * version (or by hand) must not make the page unopenable, but nothing that
 * fails validation reaches the consent dialog.
 */
export function readRequestedQueries(raw: unknown): RequestedQuery[] {
  const r = validateRequestedQueries(raw);
  return r.ok ? r.queries : [];
}
