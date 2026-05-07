import type { AgentProvider, LlmAuthType } from '@craft-agent/shared/agent/backend'
import { isCompatProvider, modelSupportsImages, type LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'

export interface BackendRuntimeSignatureInput {
  connection: LlmConnection | null
  provider: AgentProvider
  authType?: LlmAuthType
  resolvedModel: string
}

export interface ModelAttachmentFilterResult {
  /** Attachments safe to pass to the model, or undefined when none remain. */
  attachments?: FileAttachment[]
  /** Image attachments intentionally omitted from the model payload. */
  omittedImages: FileAttachment[]
}

function definedObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined))
}

function normalizeCustomModels(connection: LlmConnection): Array<Record<string, unknown>> {
  return (connection.models ?? [])
    .map(model => {
      if (typeof model === 'string') return { id: model }
      return definedObject({
        id: model.id,
        contextWindow: model.contextWindow,
        supportsImages: typeof model.supportsImages === 'boolean' ? model.supportsImages : undefined,
      })
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

/**
 * Build a stable signature over the fields that the `update_runtime_config`
 * IPC envelope cannot safely propagate to a live subprocess. When this
 * signature drifts, the in-place refresh path must be skipped in favour of
 * a clean dispose + recreate so the new auth/provider routing actually takes
 * effect.
 *
 * Concretely, `update_runtime_config` (see `pi-agent.ts:requestRuntimeConfigUpdate`
 * and the matching handler at `pi-agent-server/src/index.ts:handleUpdateRuntimeConfig`)
 * carries `model, providerType, authType, baseUrl, customEndpoint, customModels` —
 * but NOT `piAuthProvider`, and switching `slug`/`providerType`/`authType` mid-life
 * pulls in credential routing and provider-registry state the subprocess doesn't
 * fully reset on a runtime update.
 */
export function buildRestartRequiredSignature(input: BackendRuntimeSignatureInput): string {
  const { connection, provider, authType } = input
  return JSON.stringify(definedObject({
    provider,
    authType,
    slug: connection?.slug,
    providerType: connection?.providerType,
    piAuthProvider: connection?.piAuthProvider,
  }))
}

/**
 * Build a stable signature for config fields that affect an already-created
 * backend runtime. Metadata such as `lastUsedAt` is intentionally omitted.
 */
export function buildBackendRuntimeSignature(input: BackendRuntimeSignatureInput): string {
  const { connection, provider, authType, resolvedModel } = input

  const connectionShape = connection
    ? definedObject({
        slug: connection.slug,
        providerType: connection.providerType,
        authType: connection.authType,
        defaultModel: connection.defaultModel,
        ...(isCompatProvider(connection.providerType)
          ? {
              baseUrl: connection.baseUrl,
              piAuthProvider: connection.piAuthProvider,
              customEndpoint: connection.customEndpoint
                ? definedObject({
                    api: connection.customEndpoint.api,
                    supportsImages: typeof connection.customEndpoint.supportsImages === 'boolean'
                      ? connection.customEndpoint.supportsImages
                      : undefined,
                  })
                : undefined,
              models: normalizeCustomModels(connection),
            }
          : {}),
      })
    : null

  return JSON.stringify(definedObject({
    provider,
    authType,
    resolvedModel,
    connection: connectionShape,
  }))
}

export function isImageAttachment(attachment: Pick<FileAttachment, 'type' | 'mimeType'>): boolean {
  return attachment.type === 'image' || attachment.mimeType?.startsWith('image/') === true
}

/**
 * Enforce saved custom-endpoint image capability at send time. The session can
 * still persist/display image attachments, but they are not passed to text-only
 * models even if an older subprocess has stale vision-capable registry state.
 */
export function filterAttachmentsForModelInput(
  attachments: FileAttachment[] | undefined,
  connection: LlmConnection | null,
  modelId: string,
): ModelAttachmentFilterResult {
  if (!attachments?.length) return { attachments, omittedImages: [] }
  if (!connection || !isCompatProvider(connection.providerType)) return { attachments, omittedImages: [] }
  if (modelSupportsImages(connection, modelId)) return { attachments, omittedImages: [] }

  const modelAttachments: FileAttachment[] = []
  const omittedImages: FileAttachment[] = []

  for (const attachment of attachments) {
    if (isImageAttachment(attachment)) {
      omittedImages.push(attachment)
    } else {
      modelAttachments.push(attachment)
    }
  }

  return {
    attachments: modelAttachments.length > 0 ? modelAttachments : undefined,
    omittedImages,
  }
}
