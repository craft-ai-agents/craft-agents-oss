import type { CredentialKind, CredentialRefId } from '@craft-agent/core/platform';
import type { StoredCredential } from '../types.ts';
import type { ProviderMaterialization } from './types.ts';

export function createProviderMaterialization(
  credentialRefId: CredentialRefId,
  kind: CredentialKind,
  payload: StoredCredential,
): ProviderMaterialization {
  const materialization = {
    credentialRefId,
    kind,
  } as ProviderMaterialization;
  Object.defineProperty(materialization, 'payload', {
    value: payload,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return materialization;
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}
