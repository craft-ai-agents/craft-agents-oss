import type { CredentialRefId } from '@craft-agent/core/platform'
import type { SecretProvider } from '@craft-agent/shared/credentials'

import { performGithubUser, type GithubFetch } from './github-vertical.ts'
import type { WorkGraphKernel } from './index'

export type { GithubFetch }

export interface TestGithubConnectionInput {
  readonly kernel: Pick<WorkGraphKernel, 'getConnection'>
  readonly provider: SecretProvider
  readonly workspaceId: string
  readonly connectionId: string
  readonly fetchImpl: GithubFetch
}

export async function testGithubConnection(
  input: TestGithubConnectionInput,
): Promise<{ readonly login: string }> {
  const connection = await input.kernel.getConnection(input.workspaceId, input.connectionId)
  if (!connection) throw new Error('Connection not found')
  if (connection.integrationId !== 'github') throw new Error('unsupported_test')
  const credentialRefId = connection.credentialRefId as CredentialRefId
  const materialization = await input.provider.resolveForLease({
    credentialRef: {
      id: credentialRefId,
      kind: 'bearer_token',
      providerId: input.provider.id,
      locator: { type: 'local', key: credentialRefId },
      createdAt: 0,
      updatedAt: 0,
    },
  })
  return performGithubUser(materialization, input.fetchImpl)
}
