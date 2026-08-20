import { readFileSync } from 'node:fs'

import {
  createGitCredentialFill,
  GitCredentialHelperImporter,
  type GitCredentialHelperFill,
  type InProcessCredentialBroker,
  type LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import type { ConnectionRecord, WorkGraphKernel } from './index'

export interface GitHelperImportPreview {
  readonly candidateId: string
  readonly label: string
  readonly maskedSummary: string
}

function readConfigText(configPath: string): string {
  if (typeof configPath !== 'string' || configPath.includes('\0')) {
    throw new Error('Invalid path')
  }
  return readFileSync(configPath, 'utf8')
}

function createImporter(input: {
  readonly configPath: string
  readonly provider: LocalFileSecretProvider
  readonly fill?: GitCredentialHelperFill
}): GitCredentialHelperImporter {
  return new GitCredentialHelperImporter({
    configText: readConfigText(input.configPath),
    provider: input.provider,
    fill: input.fill ?? createGitCredentialFill(),
  })
}

function integrationIdFor(label: string, candidateId: string): string {
  const haystack = `${label} ${candidateId}`.toLowerCase()
  return haystack.includes('github.com') ? 'github' : 'git'
}

export async function previewGitHelperImport(input: {
  readonly configPath: string
  readonly provider: LocalFileSecretProvider
  readonly fill?: GitCredentialHelperFill
}): Promise<readonly GitHelperImportPreview[]> {
  const importer = createImporter(input)
  const discovered = await importer.discover()
  const out: GitHelperImportPreview[] = []
  for (const candidate of discovered) {
    const preview = await importer.preview({ candidateId: candidate.id })
    out.push({
      candidateId: candidate.id,
      label: candidate.label,
      maskedSummary: preview.maskedSummary,
    })
  }
  return out
}

export async function commitGitHelperImport(input: {
  readonly configPath: string
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection' | 'bindConsumer'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly fill?: GitCredentialHelperFill
  readonly broker?: InProcessCredentialBroker
}): Promise<ConnectionRecord> {
  const importer = createImporter(input)
  const discovered = await importer.discover()
  const found = discovered.find((candidate) => candidate.id === input.candidateId)
  if (!found) throw new Error('unknown_candidate')
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  const integrationId = integrationIdFor(found.label, found.id)
  const scopes = integrationId === 'github' ? ['github:user'] : ['git:credential']
  const connection = await input.kernel.createConnection({
    workspaceId: input.workspaceId,
    integrationId,
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes,
  })
  if (!input.broker) return connection
  await input.kernel.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    consumerId: input.requestedBy,
    purpose: integrationId === 'github' ? 'github.user' : 'git.credential',
    allowedActions: integrationId === 'github' ? ['github.api'] : ['git.credential'],
    resources: scopes,
  })
  input.broker.grant({
    workspaceId: input.workspaceId,
    consumerId: input.requestedBy,
    credentialRefId: committed.credentialRefId,
    actions: integrationId === 'github' ? ['github.api'] : ['git.credential'],
    resources: scopes,
  })
  return connection
}
