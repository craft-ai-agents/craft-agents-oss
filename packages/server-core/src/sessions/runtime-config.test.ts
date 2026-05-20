import { describe, expect, it } from 'bun:test'
import type { LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { buildBackendRuntimeSignature, buildRestartRequiredSignature, buildRuntimeConfigUpdate, filterAttachmentsForModelInput } from './runtime-config'

const baseCompat: LlmConnection = {
  slug: 'local',
  name: 'Local',
  providerType: 'pi_compat',
  authType: 'none',
  createdAt: 1,
  baseUrl: 'http://127.0.0.1:1234/v1',
  defaultModel: 'gemma',
  piAuthProvider: 'openai',
  customEndpoint: { api: 'openai-completions', supportsImages: true },
  models: [{ id: 'gemma', supportsImages: true } as never],
}

function sig(connection: LlmConnection) {
  return buildBackendRuntimeSignature({
    connection,
    provider: 'pi',
    authType: 'api_key',
    resolvedModel: 'gemma',
  })
}

const imageAttachment: FileAttachment = {
  type: 'image',
  path: '/tmp/image.png',
  name: 'image.png',
  mimeType: 'image/png',
  size: 123,
  base64: 'abc',
}

const textAttachment: FileAttachment = {
  type: 'text',
  path: '/tmp/note.txt',
  name: 'note.txt',
  mimeType: 'text/plain',
  size: 12,
  text: 'hello',
}

describe('buildBackendRuntimeSignature', () => {
  it('changes when a custom endpoint model image override changes', () => {
    const enabled = sig(baseCompat)
    const disabled = sig({
      ...baseCompat,
      models: [{ id: 'gemma', supportsImages: false } as never],
    })

    expect(disabled).not.toBe(enabled)
  })

  it('ignores non-runtime metadata such as lastUsedAt', () => {
    expect(sig({ ...baseCompat, lastUsedAt: 1 })).toBe(sig({ ...baseCompat, lastUsedAt: 2 }))
  })

  it('supports in-place OpenLLM model switches by changing runtime baseUrl without changing restart signature', () => {
    const previousHost = process.env.OPENLLM_HOST
    process.env.OPENLLM_HOST = 'http://myserver:8000'
    const connection: LlmConnection = {
      slug: 'openllm',
      name: 'OpenLLM',
      providerType: 'openllm',
      authType: 'api_key',
      defaultModel: 'llama-3',
      createdAt: 1,
      models: ['llama-3', 'mistral-7b'],
    }

    try {
      const llama = {
        connection,
        provider: 'pi' as const,
        authType: 'api_key' as const,
        resolvedModel: 'llama-3',
      }
      const mistral = {
        ...llama,
        resolvedModel: 'mistral-7b',
      }

      expect(buildRuntimeConfigUpdate({
        ...llama,
        capabilities: { needsHttpPoolServer: false },
      }).runtime?.baseUrl).toBe('http://myserver:8000/llm/llama-3/v1')
      expect(buildRuntimeConfigUpdate({
        ...mistral,
        capabilities: { needsHttpPoolServer: false },
      }).runtime?.baseUrl).toBe('http://myserver:8000/llm/mistral-7b/v1')
      expect(buildRuntimeConfigUpdate({
        ...mistral,
        capabilities: { needsHttpPoolServer: false },
      }).runtime?.customEndpoint).toEqual({ api: 'anthropic-messages' })
      expect(buildBackendRuntimeSignature(llama)).not.toBe(buildBackendRuntimeSignature(mistral))
      expect(buildRestartRequiredSignature(llama)).toBe(buildRestartRequiredSignature(mistral))
    } finally {
      if (previousHost === undefined) delete process.env.OPENLLM_HOST
      else process.env.OPENLLM_HOST = previousHost
    }
  })
})

describe('filterAttachmentsForModelInput', () => {
  it('omits images for pi_compat text-only models while preserving other attachments', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment, textAttachment],
      { ...baseCompat, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages.map(a => a.name)).toEqual(['image.png'])
    expect(result.attachments?.map(a => a.name)).toEqual(['note.txt'])
  })

  it('keeps images when the per-model override enables images', () => {
    const result = filterAttachmentsForModelInput([imageAttachment], baseCompat, 'gemma')

    expect(result.omittedImages).toHaveLength(0)
    expect(result.attachments).toEqual([imageAttachment])
  })

  it('treats explicit supportsImages=false as overriding endpoint-level true', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment],
      { ...baseCompat, customEndpoint: { api: 'openai-completions', supportsImages: true }, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages).toEqual([imageAttachment])
    expect(result.attachments).toBeUndefined()
  })
})
