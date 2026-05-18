import { isCompatProvider, modelSupportsImages, type LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'

export interface ModelAttachmentFilterResult {
  /** Attachments safe to pass to the model, or undefined when none remain. */
  attachments?: FileAttachment[]
  /** Image attachments intentionally omitted from the model payload. */
  omittedImages: FileAttachment[]
}

export function isImageAttachment(attachment: Pick<FileAttachment, 'type' | 'mimeType'>): boolean {
  return attachment.type === 'image' || attachment.mimeType?.startsWith('image/') === true
}

/**
 * Enforce saved custom-endpoint image capability at send time. The session can
 * still persist/display image attachments, but they are not passed to text-only
 * custom endpoint models.
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
