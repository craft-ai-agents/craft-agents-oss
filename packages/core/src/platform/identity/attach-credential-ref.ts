import type { ServiceConnection } from './types.ts';
import {
  CredentialRefRegistry,
  isCredentialRefRegistry,
  isCredentialRefId,
  type CredentialKind,
  type ProviderLocator,
} from './credential-types.ts';

const CONNECTION_FIELDS = ['id', 'workspaceId', 'provider', 'accountLabel', 'credentialRef', 'status', 'readOnly'] as const;
const INPUT_FIELDS = ['kind', 'providerId', 'locator', 'now'] as const;

function assertAllowedFields(value: unknown, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`Invalid credential metadata: ${label}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key) || Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true) {
      throw new Error(`Invalid credential metadata field: ${String(key)}`);
    }
  }
}

export interface AttachCredentialRefInput {
  readonly kind: CredentialKind;
  readonly providerId: string;
  readonly locator: ProviderLocator;
  readonly now?: number;
}

export function attachCredentialRef(
  connection: ServiceConnection,
  registry: CredentialRefRegistry,
  input: AttachCredentialRefInput,
): ServiceConnection {
  assertAllowedFields(connection, CONNECTION_FIELDS, 'connection');
  assertAllowedFields(input, INPUT_FIELDS, 'input');
  if (!isCredentialRefRegistry(registry)) {
    throw new Error('Invalid credential metadata: registry');
  }
  const ref = CredentialRefRegistry.prototype.register.call(registry, {
    kind: input.kind,
    providerId: input.providerId,
    locator: input.locator,
    now: input.now,
  });
  if (!isCredentialRefId(ref.id)) {
    throw new Error('Invalid credential metadata: id');
  }
  return { ...connection, credentialRef: ref.id };
}
