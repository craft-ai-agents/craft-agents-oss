import type { CredentialRefId } from '@craft-agent/core/platform'
import type { InProcessCredentialBroker, SecretProvider } from '@craft-agent/shared/credentials'

import type { WorkGraphKernel } from './index'

export type WorkGraphRevokeSurface = Pick<
  WorkGraphKernel,
  'getConnection' | 'appendConnectionAudit' | 'affectedClosure'
>

export type WorkGraphConvertSurface = WorkGraphRevokeSurface & Pick<
  WorkGraphKernel,
  'convertConnectionToReference'
>

export type WorkGraphBindingSurface = WorkGraphRevokeSurface & Pick<
  WorkGraphKernel,
  'getConnection' | 'revokeConnectionBinding'
>

export interface RevokeConnectionInput {
  readonly kernel: WorkGraphRevokeSurface
  readonly broker: InProcessCredentialBroker
  readonly provider: SecretProvider
  readonly workspaceId: string
  readonly connectionId: string
  readonly reason: string
}

export type RotateConnectionInput = RevokeConnectionInput

export interface RepairConnectionInput {
  readonly kernel: WorkGraphRevokeSurface
  readonly broker: InProcessCredentialBroker
  readonly workspaceId: string
  readonly connectionId: string
}

export interface RevalidatedConsumer {
  readonly consumerId: string
  readonly status: 'ok' | 'denied' | 'repair_required'
}

async function revalidateAffected(
  input: RepairConnectionInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const consumerIds = await input.kernel.affectedClosure(input.workspaceId, input.connectionId)
  const consumers: RevalidatedConsumer[] = []
  for (const consumerId of consumerIds) {
    const result = await input.broker.revalidateConsumer({
      kind: 'agent',
      id: consumerId,
      workspaceId: input.workspaceId,
    })
    consumers.push({ consumerId, status: result.status })
  }
  return { consumers }
}

async function requireConnection(
  kernel: WorkGraphRevokeSurface,
  workspaceId: string,
  connectionId: string,
) {
  const connection = await kernel.getConnection(workspaceId, connectionId)
  if (!connection) throw new Error('Connection not found')
  return connection
}

export async function revokeConnectionAndRevalidate(
  input: RevokeConnectionInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  await input.provider.revoke({
    credentialRef: {
      id: credentialRefId,
      kind: 'bearer_token',
      providerId: input.provider.id,
      locator: { type: 'local', key: credentialRefId },
      createdAt: 0,
      updatedAt: 0,
    },
  })
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    action: 'connection.revoke',
    decision: 'allow',
    eventType: 'connection-revoked',
  })
  return revalidateAffected(input)
}

export async function rotateConnectionAndRevalidate(
  input: RotateConnectionInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    action: 'connection.rotate',
    decision: 'allow',
    eventType: 'connection-rotated',
  })
  return revalidateAffected(input)
}

export async function repairConnectionAndRevalidate(
  input: RepairConnectionInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId: connection.credentialRefId,
    action: 'connection.repair',
    decision: 'allow',
    eventType: 'connection-repaired',
  })
  return revalidateAffected(input)
}

export interface ConvertConnectionInput {
  readonly kernel: WorkGraphConvertSurface
  readonly broker: InProcessCredentialBroker
  readonly provider: SecretProvider & { dropCopy?(ref: Parameters<SecretProvider['revoke']>[0]['credentialRef']): Promise<void> }
  readonly workspaceId: string
  readonly connectionId: string
  readonly reason: string
}

export async function convertCopyToReferenceAndRevalidate(
  input: ConvertConnectionInput,
): Promise<{ readonly storageMode: 'reference'; readonly consumers: readonly RevalidatedConsumer[] }> {
  const connection = await requireConnection(input.kernel, input.workspaceId, input.connectionId)
  const converted = await input.kernel.convertConnectionToReference(input.workspaceId, input.connectionId)
  const credentialRefId = connection.credentialRefId as CredentialRefId
  await input.broker.revokeLeasesForRef(credentialRefId, input.reason)
  if (typeof input.provider.dropCopy === 'function') {
    await input.provider.dropCopy({
      id: credentialRefId,
      kind: 'bearer_token',
      providerId: input.provider.id,
      locator: { type: 'local', key: credentialRefId },
      createdAt: 0,
      updatedAt: 0,
    })
  }
  const consumers = await revalidateAffected(input)
  return { storageMode: 'reference', consumers }
}

export interface RevokeBindingInput {
  readonly kernel: WorkGraphBindingSurface
  readonly broker: InProcessCredentialBroker
  readonly workspaceId: string
  readonly bindingId: string
}

export async function revokeConnectionBindingAndRevalidate(
  input: RevokeBindingInput,
): Promise<{ readonly consumers: readonly RevalidatedConsumer[] }> {
  const binding = await input.kernel.revokeConnectionBinding(input.workspaceId, input.bindingId)
  const grants = await input.broker.listGrants()
  const connection = await input.kernel.getConnection(input.workspaceId, binding.connectionId)
  for (const grant of grants) {
    if (
      grant.status === 'active'
      && grant.workspaceId === input.workspaceId
      && grant.consumerId === binding.consumerId
      && connection
      && grant.credentialRefId === connection.credentialRefId
    ) {
      input.broker.revokeGrant(grant.id)
    }
  }
  const result = await input.broker.revalidateConsumer({
    kind: 'agent',
    id: binding.consumerId,
    workspaceId: input.workspaceId,
  })
  return { consumers: [{ consumerId: binding.consumerId, status: result.status }] }
}
