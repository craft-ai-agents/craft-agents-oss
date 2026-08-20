import { readFileSync } from 'node:fs'

import {
  AwsSharedProfileImporter,
  createAwsCredentialProcessRun,
  createDockerCredentialGet,
  createKeychainGet,
  createKeychainList,
  createSshAgentList,
  DockerCredentialHelperImporter,
  GoogleAdcImporter,
  KeychainImporter,
  SshAgentImporter,
  type AwsCredentialProcessRun,
  type DockerCredentialHelperGet,
  type KeychainGet,
  type KeychainList,
  type LocalFileSecretProvider,
  type SshAgentList,
} from '@craft-agent/shared/credentials'

import type { ConnectionRecord, WorkGraphKernel } from './index'

export interface LocalImportPreview {
  readonly candidateId: string
  readonly label: string
  readonly maskedSummary: string
}

function readText(path: string): string {
  if (typeof path !== 'string' || path.includes('\0')) throw new Error('Invalid path')
  if (!path) return ''
  return readFileSync(path, 'utf8')
}

async function previewsFrom(discover: () => Promise<readonly { id: string; label: string }[]>, preview: (id: string) => Promise<{ maskedSummary: string }>): Promise<LocalImportPreview[]> {
  const discovered = await discover()
  const out: LocalImportPreview[] = []
  for (const candidate of discovered) {
    const next = await preview(candidate.id)
    out.push({ candidateId: candidate.id, label: candidate.label, maskedSummary: next.maskedSummary })
  }
  return out
}

async function commitConnection(input: {
  kernel: Pick<WorkGraphKernel, 'createConnection'>
  workspaceId: string
  integrationId: string
  credentialRefId: string
  storageMode: ConnectionRecord['storageMode']
  scopes: readonly string[]
}): Promise<ConnectionRecord> {
  return input.kernel.createConnection({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    credentialRefId: input.credentialRefId,
    storageMode: input.storageMode,
    scopes: input.scopes,
  })
}

export async function previewDockerHelperImport(input: {
  readonly configPath: string
  readonly provider: LocalFileSecretProvider
  readonly get?: DockerCredentialHelperGet
}): Promise<readonly LocalImportPreview[]> {
  const importer = new DockerCredentialHelperImporter({
    configText: readText(input.configPath),
    provider: input.provider,
    get: input.get ?? createDockerCredentialGet(),
  })
  return previewsFrom(() => importer.discover(), (id) => importer.preview({ candidateId: id }))
}

export async function commitDockerHelperImport(input: {
  readonly configPath: string
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly get?: DockerCredentialHelperGet
}): Promise<ConnectionRecord> {
  const importer = new DockerCredentialHelperImporter({
    configText: readText(input.configPath),
    provider: input.provider,
    get: input.get ?? createDockerCredentialGet(),
  })
  await importer.discover()
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  return commitConnection({
    kernel: input.kernel,
    workspaceId: input.workspaceId,
    integrationId: 'docker',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['docker:registry'],
  })
}

export async function previewAwsProfileImport(input: {
  readonly credentialsPath: string
  readonly configPath: string
  readonly provider: LocalFileSecretProvider
  readonly run?: AwsCredentialProcessRun
}): Promise<readonly LocalImportPreview[]> {
  const importer = new AwsSharedProfileImporter({
    credentialsText: input.credentialsPath ? readText(input.credentialsPath) : '',
    configText: input.configPath ? readText(input.configPath) : '',
    provider: input.provider,
    run: input.run ?? createAwsCredentialProcessRun(),
  })
  return previewsFrom(() => importer.discover(), (id) => importer.preview({ candidateId: id }))
}

export async function commitAwsProfileImport(input: {
  readonly credentialsPath: string
  readonly configPath: string
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly run?: AwsCredentialProcessRun
}): Promise<ConnectionRecord> {
  const importer = new AwsSharedProfileImporter({
    credentialsText: input.credentialsPath ? readText(input.credentialsPath) : '',
    configText: input.configPath ? readText(input.configPath) : '',
    provider: input.provider,
    run: input.run ?? createAwsCredentialProcessRun(),
  })
  await importer.discover()
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  return commitConnection({
    kernel: input.kernel,
    workspaceId: input.workspaceId,
    integrationId: 'aws',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['aws:profile'],
  })
}

export async function previewAdcImport(input: {
  readonly credentialsPath: string
  readonly provider: LocalFileSecretProvider
}): Promise<readonly LocalImportPreview[]> {
  const importer = new GoogleAdcImporter({
    credentialsText: readText(input.credentialsPath),
    provider: input.provider,
  })
  return previewsFrom(() => importer.discover(), (id) => importer.preview({ candidateId: id }))
}

export async function commitAdcImport(input: {
  readonly credentialsPath: string
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection'>
  readonly workspaceId: string
  readonly requestedBy: string
}): Promise<ConnectionRecord> {
  const importer = new GoogleAdcImporter({
    credentialsText: readText(input.credentialsPath),
    provider: input.provider,
  })
  await importer.discover()
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  return commitConnection({
    kernel: input.kernel,
    workspaceId: input.workspaceId,
    integrationId: 'gcp',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['gcp:adc'],
  })
}

export async function previewKeychainImport(input: {
  readonly provider: LocalFileSecretProvider
  readonly list?: KeychainList
  readonly get?: KeychainGet
}): Promise<readonly LocalImportPreview[]> {
  const importer = new KeychainImporter({
    provider: input.provider,
    list: input.list ?? createKeychainList(),
    get: input.get ?? createKeychainGet(),
  })
  return previewsFrom(() => importer.discover(), (id) => importer.preview({ candidateId: id }))
}

export async function commitKeychainImport(input: {
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly list?: KeychainList
  readonly get?: KeychainGet
}): Promise<ConnectionRecord> {
  const importer = new KeychainImporter({
    provider: input.provider,
    list: input.list ?? createKeychainList(),
    get: input.get ?? createKeychainGet(),
  })
  await importer.discover()
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'copy',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  return commitConnection({
    kernel: input.kernel,
    workspaceId: input.workspaceId,
    integrationId: 'keychain',
    credentialRefId: committed.credentialRefId,
    storageMode: 'copy',
    scopes: ['keychain:item'],
  })
}

export async function previewSshAgentImport(input: {
  readonly provider: LocalFileSecretProvider
  readonly list?: SshAgentList
}): Promise<readonly LocalImportPreview[]> {
  const importer = new SshAgentImporter({
    provider: input.provider,
    list: input.list ?? createSshAgentList(),
  })
  return previewsFrom(() => importer.discover(), (id) => importer.preview({ candidateId: id }))
}

export async function commitSshAgentImport(input: {
  readonly candidateId: string
  readonly provider: LocalFileSecretProvider
  readonly kernel: Pick<WorkGraphKernel, 'createConnection'>
  readonly workspaceId: string
  readonly requestedBy: string
  readonly list?: SshAgentList
}): Promise<ConnectionRecord> {
  const importer = new SshAgentImporter({
    provider: input.provider,
    list: input.list ?? createSshAgentList(),
  })
  await importer.discover()
  const committed = await importer.commit({
    candidateId: input.candidateId,
    targetProviderId: input.provider.id,
    mode: 'reference',
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
  })
  return commitConnection({
    kernel: input.kernel,
    workspaceId: input.workspaceId,
    integrationId: 'ssh',
    credentialRefId: committed.credentialRefId,
    storageMode: 'reference',
    scopes: ['ssh:agent'],
  })
}
