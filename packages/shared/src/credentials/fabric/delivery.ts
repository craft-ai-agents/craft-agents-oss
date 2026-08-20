export const DELIVERY_MECHANISM_RANK = [
  'trusted-http-header',
  'broker-proxy',
  'broker-perform',
  'mcp-tool-host',
  'git-credential-helper',
  'docker-credential-helper',
  'aws-credential-process',
  'ssh-agent',
  'stdin',
  'fd',
  'temporary-file',
  'browser-partition',
  'env-legacy',
] as const;

export type DeliveryMechanism = (typeof DELIVERY_MECHANISM_RANK)[number];

export interface DeliverySelectionInput {
  readonly requestedMechanism?: DeliveryMechanism;
  readonly allowEnvLegacy?: boolean;
  readonly supportedMechanisms?: readonly DeliveryMechanism[];
  readonly grantAllowsEnvLegacy?: boolean;
}

export function selectDeliveryMechanism(
  input: DeliverySelectionInput,
): { ok: true; mechanism: DeliveryMechanism } | { ok: false; code: 'unsupported_delivery' } {
  const supported = input.supportedMechanisms?.length
    ? input.supportedMechanisms
    : (['broker-perform'] as const);
  const envAllowed = Boolean(input.allowEnvLegacy || input.grantAllowsEnvLegacy);

  if (input.requestedMechanism) {
    if (!supported.includes(input.requestedMechanism)) {
      return { ok: false, code: 'unsupported_delivery' };
    }
    if (input.requestedMechanism === 'env-legacy' && !envAllowed) {
      return { ok: false, code: 'unsupported_delivery' };
    }
    return { ok: true, mechanism: input.requestedMechanism };
  }

  const selected = DELIVERY_MECHANISM_RANK.find((mechanism) => supported.includes(mechanism));
  if (!selected) return { ok: false, code: 'unsupported_delivery' };
  if (selected === 'env-legacy' && !envAllowed) {
    return { ok: false, code: 'unsupported_delivery' };
  }
  return { ok: true, mechanism: selected };
}

export { applyTrustedHttpHeader, redactHeaders } from './http-header-delivery.ts';
