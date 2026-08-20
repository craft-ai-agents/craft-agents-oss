import type { ProviderMaterialization } from './types.ts';

const AUTHORIZATION = 'Authorization';
const REDACTED_BEARER = 'Bearer ***';

function readToken(materialization: ProviderMaterialization): string {
  const token = materialization.payload?.value;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('missing_token');
  }
  return token;
}

function copyWithoutAuthorization(headers: Readonly<Record<string, string>>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') continue;
    next[key] = value;
  }
  return next;
}

/** Inject Authorization: Bearer from lease materialization. Caller must not log the result. */
export function applyTrustedHttpHeader(
  headers: Readonly<Record<string, string>>,
  materialization: ProviderMaterialization,
): Record<string, string> {
  const next = copyWithoutAuthorization(headers);
  next[AUTHORIZATION] = `Bearer ${readToken(materialization)}`;
  return next;
}

/** Copy headers with Authorization replaced by Bearer *** for logs/audit JSON. */
export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    next[key] = key.toLowerCase() === 'authorization' ? REDACTED_BEARER : value;
  }
  return next;
}
