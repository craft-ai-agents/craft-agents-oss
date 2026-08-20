import type { CredentialRefId } from '@craft-agent/core/platform'
import type {
  EnvFileImporter,
  InProcessCredentialBroker,
  LocalFileSecretProvider,
  ProviderMaterialization,
} from '@craft-agent/shared/credentials'
import { applyTrustedHttpHeader } from '@craft-agent/shared/credentials'

import type { ConnectionRecord, WorkGraphKernel } from './index'

const GITHUB_ENV_NAMES = new Set(['GH_TOKEN', 'GITHUB_TOKEN'])

export function isGithubEnvCandidate(label: string): boolean {
  return GITHUB_ENV_NAMES.has(label)
}

export type GithubFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>

export async function performGithubUser(
  materialization: ProviderMaterialization,
  fetchImpl: GithubFetch,
): Promise<{ login: string }> {
  const headers = applyTrustedHttpHeader(
    { Accept: 'application/vnd.github+json' },
    materialization,
  )
  const response = await fetchImpl('https://api.github.com/user', { headers })
  const body = await response.json() as { login?: unknown }
  if (typeof body.login !== 'string' || !body.login) throw new Error('operation_failed')
  return { login: body.login }
}

export interface GithubVerticalInput {
  readonly importer: EnvFileImporter
  readonly candidateId: string
  readonly kernel: WorkGraphKernel
  readonly broker: InProcessCredentialBroker
  readonly provider: LocalFileSecretProvider
  readonly workspaceId: string
  readonly consumerId: string
  readonly fetchImpl: GithubFetch
}

export interface GithubVerticalResult {
  readonly credentialRefId: CredentialRefId
  readonly connection: ConnectionRecord
  readonly leaseId: string
  readonly login: string
}

export async function runGithubVertical(input: GithubVerticalInput): Promise<GithubVerticalResult> {
  if (!isGithubEnvCandidate(input.candidateId)) {
    throw new Error('not_github_candidate')
  }
  const committed = await input.importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.consumerId,
  })
  const connection = await input.kernel.createConnection({
    workspaceId: input.workspaceId,
    integrationId: 'github',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['github:user'],
  })
  await input.kernel.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    consumerId: input.consumerId,
    purpose: 'github.user',
    allowedActions: ['github.api'],
    resources: ['github:user'],
  })
  input.broker.grant({
    workspaceId: input.workspaceId,
    consumerId: input.consumerId,
    credentialRefId: committed.credentialRefId,
    actions: ['github.api'],
    resources: ['github:user'],
  })
  const consumer = {
    kind: 'agent' as const,
    id: input.consumerId,
    workspaceId: input.workspaceId,
  }
  const lease = await input.broker.acquireLease({
    credentialRef: committed.credentialRefId,
    consumer,
    purpose: 'github.user',
    action: 'github.api',
    resources: ['github:user'],
    audience: 'local-broker',
    ttl: 5_000,
  })
  const { login } = await input.broker.perform(lease.id, (materialization) => (
    performGithubUser(materialization, input.fetchImpl)
  ))
  return {
    credentialRefId: committed.credentialRefId,
    connection,
    leaseId: lease.id,
    login,
  }
}
