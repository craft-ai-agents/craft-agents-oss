/**
 * Secret Redaction Utilities
 *
 * Single source of truth for scrubbing credentials out of anything that
 * leaves the process boundary as diagnostics: Sentry events, debug logs,
 * audit trails. Previously this logic existed only as two hand-drifting
 * copies inside the Sentry beforeSend hooks (main + renderer).
 *
 * Semantics intentionally match the historical beforeSend behavior:
 * key-NAME based matching (a key containing token/key/secret/... is
 * redacted), not value-pattern matching.
 */

export const REDACTED_VALUE = '[REDACTED]';

/**
 * Header names whose values must never appear in logs/reports.
 * Compared case-insensitively.
 */
export const SENSITIVE_HEADER_NAMES = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
] as const;

const SENSITIVE_HEADER_SET = new Set<string>(SENSITIVE_HEADER_NAMES);

/**
 * Key-name heuristic for object scrubbing. Deliberately broad (matches
 * "monkey" via "key", "author" via "auth") — over-redacting diagnostics is
 * cheap, leaking a credential is not.
 */
const SENSITIVE_KEY_PATTERN = /token|key|secret|password|credential|auth|cookie/i;

/** True when a key name looks credential-bearing. */
export function isSensitiveKeyName(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Return a copy of a headers record with sensitive header VALUES replaced.
 * Non-sensitive headers pass through untouched. Key casing is preserved.
 */
export function redactSensitiveHeaders<T>(headers: Record<string, T>): Record<string, T | string> {
  const result: Record<string, T | string> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = SENSITIVE_HEADER_SET.has(name.toLowerCase()) ? REDACTED_VALUE : value;
  }
  return result;
}

/**
 * Mutate a headers-shaped record in place, redacting sensitive values.
 * Matches the Sentry beforeSend call shape (event.request.headers).
 */
export function redactSensitiveHeadersInPlace(headers: Record<string, unknown>): void {
  for (const name of Object.keys(headers)) {
    if (SENSITIVE_HEADER_SET.has(name.toLowerCase()) && headers[name] !== undefined) {
      headers[name] = REDACTED_VALUE;
    }
  }
}

/**
 * Mutate a flat data record in place, redacting values whose KEY matches the
 * sensitive-name heuristic. Matches the historical Sentry breadcrumb scrub.
 */
export function redactSensitiveKeysInPlace(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (isSensitiveKeyName(key)) {
      data[key] = REDACTED_VALUE;
    }
  }
}

/**
 * Loggable form of a request URL: origin + path, with every query VALUE
 * replaced (names kept for debuggability). Query strings are a credential
 * channel for query-auth APIs (`?api_key=…`, `?access_token=…`), and origin
 * drops userinfo (`user:pass@host`) and the fragment for free. Unparseable
 * input yields a fixed placeholder — never the raw string, which is exactly
 * the case where we cannot tell what it contains.
 */
export function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    const names = [...new Set(parsed.searchParams.keys())];
    const query = names.length > 0 ? `?${names.map((n) => `${n}=${REDACTED_VALUE}`).join('&')}` : '';
    return `${parsed.origin}${parsed.pathname}${query}`;
  } catch {
    return '[unparseable-url]';
  }
}

const MAX_REDACTION_DEPTH = 8;

/**
 * Deep-copy a JSON-ish value, replacing every value whose key matches the
 * sensitive-name heuristic. Cycle-safe (cycles become '[Circular]') and
 * depth-capped. Use for audit-log payloads and error reports that embed
 * caller-provided objects.
 */
export function redactSensitiveValues<T>(value: T): T {
  // Tracks ANCESTORS of the current node, not everything ever visited: a node
  // is a cycle only when it appears on its own path. A permanent visited-set
  // would also flag diamonds (one object referenced from two keys) as
  // '[Circular]' and silently drop real data from audit payloads.
  const ancestors = new WeakSet<object>();

  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (depth >= MAX_REDACTION_DEPTH) return '[MaxDepth]';
    if (ancestors.has(node)) return '[Circular]';
    ancestors.add(node);

    try {
      if (Array.isArray(node)) {
        return node.map((item) => walk(item, depth + 1));
      }

      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) {
        result[key] = isSensitiveKeyName(key) ? REDACTED_VALUE : walk(entry, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(node);
    }
  };

  return walk(value, 0) as T;
}
