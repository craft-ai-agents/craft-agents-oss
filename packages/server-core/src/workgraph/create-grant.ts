import type { CredentialRefId } from '@craft-agent/core/platform'
import type { InProcessCredentialBroker } from '@craft-agent/shared/credentials'

import type { WorkGraphKernel } from './index'

export type CreateConnectionGrantKernel = Pick<
  WorkGraphKernel,
  'getConnection' | 'bindConsumer' | 'appendConnectionAudit'
>

export async function createConnectionGrant(input: {
  kernel: CreateConnectionGrantKernel
  broker: InProcessCredentialBroker
  workspaceId: string
  connectionId: string
  consumerId: string
  purpose: string
  actions: readonly string[]
  resources: readonly string[]
}): Promise<{ bindingId: string; grantId: string }> {
  if (!input.consumerId.trim()) throw new Error('Invalid consumer ID')
  if (!input.purpose.trim()) throw new Error('Invalid purpose')
  if (input.actions.length === 0) throw new Error('Invalid actions')
  if (input.resources.length === 0) throw new Error('Invalid resources')

  const connection = await input.kernel.getConnection(input.workspaceId, input.connectionId)
  if (!connection) throw new Error('Connection not found')

  const binding = await input.kernel.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    consumerId: input.consumerId,
    purpose: input.purpose,
    allowedActions: input.actions,
    resources: input.resources,
  })

  const credentialRefId = connection.credentialRefId as CredentialRefId
  const grant = input.broker.grant({
    workspaceId: input.workspaceId,
    consumerId: input.consumerId,
    credentialRefId,
    actions: input.actions,
    resources: input.resources,
  })

  await input.kernel.appendConnectionAudit({
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    credentialRefId,
    consumer: input.consumerId,
    action: 'connection.grant',
    decision: 'allow',
    eventType: 'connection-audit',
  })

  return { bindingId: binding.id, grantId: grant.id }
}
