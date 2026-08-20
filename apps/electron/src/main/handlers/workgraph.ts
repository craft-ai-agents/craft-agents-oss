import { CredentialRefRegistry } from '@craft-agent/core/platform'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  InProcessCredentialBroker,
  LocalFileSecretProvider,
  SecureStorageBackend,
} from '@craft-agent/shared/credentials'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  commitGitHelperImport,
  commitGithubEnvImport,
  previewGitHelperImport,
  previewGithubEnvImport,
  convertCopyToReferenceAndRevalidate,
  repairConnectionAndRevalidate,
  revokeConnectionAndRevalidate,
  revokeConnectionBindingAndRevalidate,
  rotateConnectionAndRevalidate,
  testGithubConnection,
  previewAdcImport,
  commitAdcImport,
  previewAwsProfileImport,
  commitAwsProfileImport,
  previewDockerHelperImport,
  commitDockerHelperImport,
  previewKeychainImport,
  commitKeychainImport,
  previewSshAgentImport,
  commitSshAgentImport,
  createConnectionGrant,
  type CreateConnectionInput,
  type GithubFetch,
  type WorkGraphKernel,
} from '@craft-agent/server-core/workgraph'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workgraph.GET_HEALTH,
  RPC_CHANNELS.workgraph.GET_VERSION,
  RPC_CHANNELS.workgraph.LIST_CONNECTIONS,
  RPC_CHANNELS.workgraph.LIST_CONNECTION_AUDIT,
  RPC_CHANNELS.workgraph.LIST_CONNECTION_BINDINGS,
  RPC_CHANNELS.workgraph.CONVERT_CONNECTION,
  RPC_CHANNELS.workgraph.REVOKE_CONNECTION_BINDING,
  RPC_CHANNELS.workgraph.GET_CONNECTION,
  RPC_CHANNELS.workgraph.CREATE_CONNECTION,
  RPC_CHANNELS.workgraph.GRANT_CONNECTION,
  RPC_CHANNELS.workgraph.PREVIEW_GITHUB_ENV,
  RPC_CHANNELS.workgraph.IMPORT_GITHUB_ENV,
  RPC_CHANNELS.workgraph.PREVIEW_GIT_HELPER,
  RPC_CHANNELS.workgraph.IMPORT_GIT_HELPER,
  RPC_CHANNELS.workgraph.REVOKE_CONNECTION,
  RPC_CHANNELS.workgraph.REPAIR_CONNECTION,
  RPC_CHANNELS.workgraph.ROTATE_CONNECTION,
  RPC_CHANNELS.workgraph.TEST_CONNECTION,
  RPC_CHANNELS.workgraph.PREVIEW_DOCKER_HELPER,
  RPC_CHANNELS.workgraph.IMPORT_DOCKER_HELPER,
  RPC_CHANNELS.workgraph.PREVIEW_AWS_PROFILES,
  RPC_CHANNELS.workgraph.IMPORT_AWS_PROFILE,
  RPC_CHANNELS.workgraph.PREVIEW_KEYCHAIN,
  RPC_CHANNELS.workgraph.IMPORT_KEYCHAIN,
  RPC_CHANNELS.workgraph.PREVIEW_ADC,
  RPC_CHANNELS.workgraph.IMPORT_ADC,
  RPC_CHANNELS.workgraph.PREVIEW_SSH_AGENT,
  RPC_CHANNELS.workgraph.IMPORT_SSH_AGENT,
] as const

export interface FabricImportHost {
  readonly provider: LocalFileSecretProvider
  readonly broker: InProcessCredentialBroker
  readonly previewGithub: typeof previewGithubEnvImport
  readonly commitGithub: typeof commitGithubEnvImport
  readonly previewGitHelper: typeof previewGitHelperImport
  readonly commitGitHelper: typeof commitGitHelperImport
  readonly revoke: typeof revokeConnectionAndRevalidate
  readonly repair: typeof repairConnectionAndRevalidate
  readonly rotate: typeof rotateConnectionAndRevalidate
  readonly testGithub: typeof testGithubConnection
  readonly fetchImpl: GithubFetch
  readonly convert: typeof convertCopyToReferenceAndRevalidate
  readonly unbind: typeof revokeConnectionBindingAndRevalidate
}

export type GithubEnvImportHost = FabricImportHost

export function createGithubEnvImportHost(): FabricImportHost {
  const registry = new CredentialRefRegistry()
  const provider = new LocalFileSecretProvider(new SecureStorageBackend(), registry)
  return {
    provider,
    broker: new InProcessCredentialBroker(provider, (id) => registry.get(id)),
    previewGithub: previewGithubEnvImport,
    commitGithub: commitGithubEnvImport,
    previewGitHelper: previewGitHelperImport,
    commitGitHelper: commitGitHelperImport,
    revoke: revokeConnectionAndRevalidate,
    repair: repairConnectionAndRevalidate,
    rotate: rotateConnectionAndRevalidate,
    testGithub: testGithubConnection,
    fetchImpl: globalThis.fetch.bind(globalThis),
    convert: convertCopyToReferenceAndRevalidate,
    unbind: revokeConnectionBindingAndRevalidate,
  }
}

const CONNECTION_INPUT_KEYS = new Set([
  'workspaceId',
  'integrationId',
  'credentialRefId',
  'storageMode',
  'scopes',
])

function assertConnectionMetadata(input: unknown): CreateConnectionInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid connection metadata')
  }
  for (const key of Object.keys(input)) {
    if (!CONNECTION_INPUT_KEYS.has(key)) {
      throw new Error(`Invalid connection metadata field: ${key}`)
    }
  }
  return input as CreateConnectionInput
}

const GRANT_INPUT_KEYS = new Set([
  'workspaceId',
  'connectionId',
  'consumerId',
  'purpose',
  'actions',
  'resources',
])

function assertGrantMetadata(input: unknown): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid grant metadata')
  }
  for (const key of Object.keys(input)) {
    if (!GRANT_INPUT_KEYS.has(key)) {
      throw new Error(`Invalid grant metadata field: ${key}`)
    }
  }
}

function assertLocalPath(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid path')
  return value
}

type WorkGraphSurface = Pick<
  WorkGraphKernel,
  | 'getHealth'
  | 'getVersion'
  | 'listConnections'
  | 'listConnectionAudit'
  | 'listConnectionBindings'
  | 'convertConnectionToReference'
  | 'revokeConnectionBinding'
  | 'getConnection'
  | 'createConnection'
  | 'bindConsumer'
  | 'appendConnectionAudit'
  | 'affectedClosure'
>

/**
 * WorkGraph is deliberately composed only by Electron main. The transport's
 * localElectron access class additionally requires the renderer's trusted,
 * main-issued window/workspace binding before these channels are advertised.
 */
export function registerWorkGraphHandlers(
  server: RpcServer,
  workGraph: WorkGraphSurface,
  fabric?: FabricImportHost,
): void {
  server.handle(RPC_CHANNELS.workgraph.GET_HEALTH, () => workGraph.getHealth(), { access: 'localElectron' })
  server.handle(RPC_CHANNELS.workgraph.GET_VERSION, () => workGraph.getVersion(), { access: 'localElectron' })
  server.handle(
    RPC_CHANNELS.workgraph.LIST_CONNECTIONS,
    (_ctx, workspaceId: string) => workGraph.listConnections(workspaceId),
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.LIST_CONNECTION_AUDIT,
    (_ctx, input: { workspaceId: string; connectionId?: string }) => (
      workGraph.listConnectionAudit(input.workspaceId, input.connectionId)
    ),
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.LIST_CONNECTION_BINDINGS,
    (_ctx, input: { workspaceId: string; connectionId?: string }) => (
      workGraph.listConnectionBindings(input.workspaceId, input.connectionId)
    ),
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.CONVERT_CONNECTION,
    async (_ctx, input: { workspaceId: string; connectionId: string }) => {
      if (!fabric) throw new Error('convert_unavailable')
      return fabric.convert({
        kernel: workGraph,
        broker: fabric.broker,
        provider: fabric.provider,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        reason: 'owner-convert',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.REVOKE_CONNECTION_BINDING,
    async (_ctx, input: { workspaceId: string; bindingId: string }) => {
      if (!fabric) throw new Error('unbind_unavailable')
      return fabric.unbind({
        kernel: workGraph,
        broker: fabric.broker,
        workspaceId: input.workspaceId,
        bindingId: input.bindingId,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.GET_CONNECTION,
    (_ctx, input: { workspaceId: string; connectionId: string }) => (
      workGraph.getConnection(input.workspaceId, input.connectionId)
    ),
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.CREATE_CONNECTION,
    (_ctx, input: unknown) => workGraph.createConnection(assertConnectionMetadata(input)),
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.GRANT_CONNECTION,
    async (_ctx, input: {
      workspaceId: string
      connectionId: string
      consumerId: string
      purpose: string
      actions: readonly string[]
      resources: readonly string[]
    }) => {
      assertGrantMetadata(input)
      if (!fabric) throw new Error('grant_unavailable')
      return createConnectionGrant({
        kernel: workGraph,
        broker: fabric.broker,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        consumerId: input.consumerId,
        purpose: input.purpose,
        actions: input.actions,
        resources: input.resources,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_GITHUB_ENV,
    async (_ctx, envPath: string) => {
      if (!fabric) return []
      return fabric.previewGithub({ envPath: assertLocalPath(envPath), provider: fabric.provider })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_GITHUB_ENV,
    async (_ctx, input: { envPath: string; candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('github_import_unavailable')
      return fabric.commitGithub({
        envPath: assertLocalPath(input?.envPath),
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
        broker: fabric.broker,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_GIT_HELPER,
    async (_ctx, configPath: string) => {
      if (!fabric) return []
      return fabric.previewGitHelper({ configPath: assertLocalPath(configPath), provider: fabric.provider })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_GIT_HELPER,
    async (_ctx, input: { configPath: string; candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('git_helper_import_unavailable')
      return fabric.commitGitHelper({
        configPath: assertLocalPath(input?.configPath),
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
        broker: fabric.broker,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.REVOKE_CONNECTION,
    async (_ctx, input: { workspaceId: string; connectionId: string }) => {
      if (!fabric) throw new Error('revoke_unavailable')
      return fabric.revoke({
        kernel: workGraph,
        broker: fabric.broker,
        provider: fabric.provider,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        reason: 'owner-revoke',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.REPAIR_CONNECTION,
    async (_ctx, input: { workspaceId: string; connectionId: string }) => {
      if (!fabric) throw new Error('repair_unavailable')
      return fabric.repair({
        kernel: workGraph,
        broker: fabric.broker,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.ROTATE_CONNECTION,
    async (_ctx, input: { workspaceId: string; connectionId: string }) => {
      if (!fabric) throw new Error('rotate_unavailable')
      return fabric.rotate({
        kernel: workGraph,
        broker: fabric.broker,
        provider: fabric.provider,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        reason: 'owner-rotate',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.TEST_CONNECTION,
    async (_ctx, input: { workspaceId: string; connectionId: string }) => {
      if (!fabric) throw new Error('test_unavailable')
      return fabric.testGithub({
        kernel: workGraph,
        provider: fabric.provider,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        fetchImpl: fabric.fetchImpl,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_DOCKER_HELPER,
    async (_ctx, configPath: string) => {
      if (!fabric) return []
      return previewDockerHelperImport({ configPath: assertLocalPath(configPath), provider: fabric.provider })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_DOCKER_HELPER,
    async (_ctx, input: { configPath: string; candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('docker_import_unavailable')
      return commitDockerHelperImport({
        configPath: assertLocalPath(input?.configPath),
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_AWS_PROFILES,
    async (_ctx, input: { credentialsPath: string; configPath: string }) => {
      if (!fabric) return []
      return previewAwsProfileImport({
        credentialsPath: assertLocalPath(input?.credentialsPath),
        configPath: assertLocalPath(input?.configPath),
        provider: fabric.provider,
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_AWS_PROFILE,
    async (_ctx, input: { credentialsPath: string; configPath: string; candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('aws_import_unavailable')
      return commitAwsProfileImport({
        credentialsPath: assertLocalPath(input?.credentialsPath),
        configPath: assertLocalPath(input?.configPath),
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_KEYCHAIN,
    async () => {
      if (!fabric) return []
      return previewKeychainImport({ provider: fabric.provider })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_KEYCHAIN,
    async (_ctx, input: { candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('keychain_import_unavailable')
      return commitKeychainImport({
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_ADC,
    async (_ctx, credentialsPath: string) => {
      if (!fabric) return []
      return previewAdcImport({ credentialsPath: assertLocalPath(credentialsPath), provider: fabric.provider })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_ADC,
    async (_ctx, input: { credentialsPath: string; candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('adc_import_unavailable')
      return commitAdcImport({
        credentialsPath: assertLocalPath(input?.credentialsPath),
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
      })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.PREVIEW_SSH_AGENT,
    async () => {
      if (!fabric) return []
      return previewSshAgentImport({ provider: fabric.provider })
    },
    { access: 'localElectron' },
  )
  server.handle(
    RPC_CHANNELS.workgraph.IMPORT_SSH_AGENT,
    async (_ctx, input: { candidateId: string; workspaceId: string }) => {
      if (!fabric) throw new Error('ssh_import_unavailable')
      return commitSshAgentImport({
        candidateId: input.candidateId,
        provider: fabric.provider,
        kernel: workGraph,
        workspaceId: input.workspaceId,
        requestedBy: 'owner',
      })
    },
    { access: 'localElectron' },
  )
}
