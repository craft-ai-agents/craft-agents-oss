import { createHash } from 'node:crypto';
import { isCredentialKind, type CredentialKind } from '@craft-agent/core/platform';
import type { StoredCredential } from './types.ts';

export const CREDENTIAL_ENVELOPE_FORMAT = 'rox-credential-envelope' as const;
export const CREDENTIAL_ENVELOPE_VERSION = 1 as const;
export const CREDENTIAL_ENVELOPE_CODEC = 'stored-credential/v1' as const;

export interface CredentialEnvelopeV1 {
  readonly format: typeof CREDENTIAL_ENVELOPE_FORMAT;
  readonly version: typeof CREDENTIAL_ENVELOPE_VERSION;
  readonly codec: typeof CREDENTIAL_ENVELOPE_CODEC;
  readonly kind: CredentialKind;
  readonly payload: StoredCredential;
  readonly fingerprint: string;
}

export interface CredentialEnvelopeInput {
  readonly kind: CredentialKind;
  readonly payload: StoredCredential;
}

const STRING_FIELDS = new Set([
  'value',
  'refreshToken',
  'clientId',
  'clientSecret',
  'tokenType',
  'idToken',
  'awsAccessKeyId',
  'awsRegion',
  'awsSessionToken',
  'gcpProjectId',
  'gcpRegion',
  'serviceAccountEmail',
]);
const ALLOWED_PAYLOAD_FIELDS = new Set([...STRING_FIELDS, 'expiresAt', 'source']);

const KIND_FIELDS: Record<CredentialKind, readonly string[]> = {
  api_key: ['value', 'expiresAt', 'source', 'tokenType'],
  bearer_token: ['value', 'expiresAt', 'source', 'tokenType'],
  oauth2_token_set: ['value', 'refreshToken', 'expiresAt', 'clientId', 'clientSecret', 'idToken', 'tokenType', 'source'],
  aws_credential_source: ['value', 'awsAccessKeyId', 'awsRegion', 'awsSessionToken', 'expiresAt', 'source'],
  gcp_adc: ['value', 'expiresAt', 'source'],
  basic_auth: ['value', 'expiresAt', 'source'],
  ssh_agent_identity: ['value', 'expiresAt', 'source'],
  x509_identity: ['value', 'expiresAt', 'source'],
  opaque_bundle: ['value', 'expiresAt', 'source'],
  browser_session: ['value', 'expiresAt', 'source'],
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCredentialKind(value: unknown): asserts value is CredentialKind {
  if (!isCredentialKind(value)) throw new Error('Credential envelope kind is invalid');
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Credential payload contains a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  throw new Error('Credential payload contains an unsupported value');
}

function normalizePayload(value: unknown, kind: CredentialKind): StoredCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Credential payload must contain a non-empty scalar value');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.value !== 'string' || record.value.length === 0) {
    throw new Error('Credential payload must contain a non-empty scalar value');
  }

  const allowed = new Set(KIND_FIELDS[kind] ?? ['value', 'expiresAt', 'source']);
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PAYLOAD_FIELDS.has(key) || !allowed.has(key)) {
      throw new Error(`Credential payload contains unsupported field: ${key}`);
    }
  }
  if (kind === 'aws_credential_source' && typeof record.awsAccessKeyId !== 'string') {
    throw new Error('Credential payload field must be scalar: awsAccessKeyId');
  }

  const payload: Record<string, unknown> = { value: record.value };
  for (const key of Object.keys(record)) {
    if (key === 'value') continue;
    const field = record[key];
    if (STRING_FIELDS.has(key)) {
      if (typeof field !== 'string') throw new Error(`Credential payload field must be scalar: ${key}`);
      payload[key] = field;
    } else if (key === 'expiresAt') {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) {
        throw new Error('Credential payload field must be a finite timestamp: expiresAt');
      }
      payload[key] = field;
    } else if (key === 'source') {
      if (field !== 'native' && field !== 'cli') throw new Error('Credential payload source is invalid');
      payload[key] = field;
    }
  }
  return payload as unknown as StoredCredential;
}

export function credentialPayloadFingerprint(kind: CredentialKind, payload: StoredCredential): string {
  assertCredentialKind(kind);
  const normalized = normalizePayload(payload, kind);
  return createHash('sha256').update(`${kind}\0${canonicalize(normalized)}`).digest('hex');
}

export function encodeCredentialEnvelope(input: CredentialEnvelopeInput): string {
  assertCredentialKind(input.kind);
  const payload = normalizePayload(input.payload, input.kind);
  const envelope: CredentialEnvelopeV1 = {
    format: CREDENTIAL_ENVELOPE_FORMAT,
    version: CREDENTIAL_ENVELOPE_VERSION,
    codec: CREDENTIAL_ENVELOPE_CODEC,
    kind: input.kind,
    payload,
    fingerprint: credentialPayloadFingerprint(input.kind, payload),
  };
  return JSON.stringify(envelope);
}

/**
 * Decode only the current envelope. Invalid input returns null so callers can
 * preserve the legacy source and enter repair flow instead of guessing.
 */
export function decodeCredentialEnvelope(serialized: string): CredentialEnvelopeV1 | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) return null;
    if (
      parsed.format !== CREDENTIAL_ENVELOPE_FORMAT ||
      parsed.version !== CREDENTIAL_ENVELOPE_VERSION ||
      parsed.codec !== CREDENTIAL_ENVELOPE_CODEC ||
      !isCredentialKind(parsed.kind) ||
      typeof parsed.fingerprint !== 'string'
    ) {
      return null;
    }
    const payload = normalizePayload(parsed.payload, parsed.kind);
    const fingerprint = credentialPayloadFingerprint(parsed.kind, payload);
    if (fingerprint !== parsed.fingerprint) return null;
    return {
      format: CREDENTIAL_ENVELOPE_FORMAT,
      version: CREDENTIAL_ENVELOPE_VERSION,
      codec: CREDENTIAL_ENVELOPE_CODEC,
      kind: parsed.kind,
      payload,
      fingerprint,
    };
  } catch {
    return null;
  }
}

/**
 * Read the new envelope without breaking the existing legacy payload shape.
 * Legacy values are wrapped in memory only; this function does not rewrite or
 * delete the legacy source.
 */
export function decodeCredentialEnvelopeOrLegacy(raw: unknown, kind: CredentialKind): CredentialEnvelopeV1 | null {
  if (!isCredentialKind(kind)) return null;
  if (typeof raw === 'string') return decodeCredentialEnvelope(raw);
  try {
    const payload = normalizePayload(raw, kind);
    return {
      format: CREDENTIAL_ENVELOPE_FORMAT,
      version: CREDENTIAL_ENVELOPE_VERSION,
      codec: CREDENTIAL_ENVELOPE_CODEC,
      kind,
      payload,
      fingerprint: credentialPayloadFingerprint(kind, payload),
    };
  } catch {
    return null;
  }
}