import {
  EnvFileImporter,
  type InProcessCredentialBroker,
  type LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import type { ConnectionRecord, WorkGraphKernel } from './index'
import { isGithubEnvCandidate } from './github-vertical.ts'

export interface GithubImportPreview {
  readonly candidateId: string
  readonly label: string
  readonly maskedSummary: string
}

export async function previewGithubEnvImport(input: {
  readonly envPath: string
  readonly provider: LocalFileSecretProvider
}): Promise<readonly GithubImportPreview[]> {
  const importer = new EnvFileImporter(input.envPath, input.provider)
  const discovered = await importer.discover()
  const out: GithubImportPreview[] = []
  for (const candidate of discovered) {
    if (!isGithubEnvCandidate(candidate.label)) continue
    const preview = await importer.preview({ candidateId: candidate.id })
    out.push({
      candidateId: candidate.id,
      label: candidate.label,
      maskedSummary: preview.maskedSummary,
    })
  }
  return out
}

export async function commitGithubEnvImport(input: {
  readonly envPath: string
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection' | 'bindConsumer'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly broker?: InProcessCredentialBroker
}): Promise<ConnectionRecord> {
  if (!isGithubEnvCandidate(input.candidateId)) throw new Error('not_github_candidate')
  const importer = new EnvFileImporter(input.envPath, input.provider)
  await importer.discover()
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  const connection = await input.kernel.createConnection({
    workspaceId: input.workspaceId,
    integrationId: 'github',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['github:user'],
  })
  if (!input.broker) return connection
  await input.kernel.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    consumerId: input.requestedBy,
    purpose: 'github.user',
    allowedActions: ['github.api'],
    resources: ['github:user'],
  })
  input.broker.grant({
    workspaceId: input.workspaceId,
    consumerId: input.requestedBy,
    credentialRefId: committed.credentialRefId,
    actions: ['github.api'],
    resources: ['github:user'],
  })
  return connection
}
