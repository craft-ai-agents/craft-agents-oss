import { describe, expect, it } from 'bun:test';
import {
  credentialPayloadFingerprint,
  decodeCredentialEnvelope,
  decodeCredentialEnvelopeOrLegacy,
  encodeCredentialEnvelope,
} from '../envelope.ts';

describe('credential envelope v1', () => {
  const payload = { value: 'token', expiresAt: 1_700_000_000_000, source: 'native' as const };

  it('round-trips a scalar credential payload and records a stable fingerprint', () => {
    const encoded = encodeCredentialEnvelope({ kind: 'bearer_token', payload });
    const decoded = decodeCredentialEnvelope(encoded);

    expect(decoded?.version).toBe(1);
    expect(decoded?.codec).toBe('stored-credential/v1');
    expect(decoded?.payload).toEqual(payload);
    expect(decoded?.fingerprint).toBe(credentialPayloadFingerprint('bearer_token', payload));
  });

  it('fingerprints equivalent payload key order identically', () => {
    expect(
      credentialPayloadFingerprint('oauth2_token_set', { value: 'k', clientId: 'client' }),
    ).toBe(credentialPayloadFingerprint('oauth2_token_set', { clientId: 'client', value: 'k' }));
    expect(credentialPayloadFingerprint('api_key', { value: 'k' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects mappings and lists where a scalar payload is required', () => {
    expect(() => encodeCredentialEnvelope({ kind: 'api_key', payload: { value: { token: 'x' } as unknown as string } })).toThrow();
    expect(() => encodeCredentialEnvelope({ kind: 'api_key', payload: { value: ['x'] as unknown as string } })).toThrow();
  });

  it('fails closed for tampering and malformed envelopes', () => {
    const encoded = encodeCredentialEnvelope({ kind: 'api_key', payload: { value: 'secret' } });
    const tampered = encoded.replace('secret', 'changed');
    expect(decodeCredentialEnvelope(tampered)).toBeNull();
    expect(decodeCredentialEnvelope('{"version":1}')).toBeNull();
  });

  it('wraps a legacy payload in memory without rewriting it', () => {
    const legacy = { value: 'legacy-token' };
    const decoded = decodeCredentialEnvelopeOrLegacy(legacy, 'bearer_token');
    expect(decoded?.payload).toEqual(legacy);
    expect(decoded?.version).toBe(1);
  });

  it('rejects an invalid kind for legacy wrapping', () => {
    expect(
      decodeCredentialEnvelopeOrLegacy({ value: 'legacy-token' }, 'not-a-kind' as never),
    ).toBeNull();
  });

  it('rejects empty value and kind-illegal fields', () => {
    expect(() => encodeCredentialEnvelope({ kind: 'api_key', payload: { value: '' } })).toThrow();
    expect(() => encodeCredentialEnvelope({
      kind: 'api_key',
      payload: { value: 'k', awsAccessKeyId: 'AKIA' },
    })).toThrow();
  });

  it('rejects unapproved GCP ADC metadata', () => {
    for (const field of ['gcpProjectId', 'gcpRegion', 'serviceAccountEmail'] as const) {
      expect(() => encodeCredentialEnvelope({
        kind: 'gcp_adc',
        payload: { value: 'secret', [field]: 'unapproved' },
      })).toThrow();
    }
  });

  it('accepts oauth refresh metadata and requires aws access key id', () => {
    const encoded = encodeCredentialEnvelope({
      kind: 'oauth2_token_set',
      payload: { value: 'access', refreshToken: 'refresh', expiresAt: 9 },
    });
    expect(decodeCredentialEnvelope(encoded)?.payload.refreshToken).toBe('refresh');
    expect(() => encodeCredentialEnvelope({
      kind: 'aws_credential_source',
      payload: { value: 'secret' },
    })).toThrow();
    const aws = encodeCredentialEnvelope({
      kind: 'aws_credential_source',
      payload: { value: 'secret', awsAccessKeyId: 'AKIA' },
    });
    expect(decodeCredentialEnvelope(aws)?.payload.awsAccessKeyId).toBe('AKIA');
  });

  it('does not wrap a bare token string as legacy', () => {
    expect(decodeCredentialEnvelopeOrLegacy('legacy-token', 'bearer_token')).toBeNull();
  });
});
