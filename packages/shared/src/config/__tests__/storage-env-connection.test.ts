import { afterEach, describe, expect, it } from 'bun:test'
import {
  ENV_CONNECTION_SLUG,
  OPENLLM_ENV_CONNECTION_SLUG,
  OPENLLM_CUSTOM_ENDPOINT,
  OPENLLM_PI_AUTH_PROVIDER,
  getDefaultLlmConnection,
  getLlmConnection,
  synthesizeEnvConnection,
  synthesizeOpenLlmEnvConnection,
} from '../index'

const ORIGINAL_ENV = {
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_CONNECTION_NAME: process.env.LLM_CONNECTION_NAME,
  OPENLLM_BASE_HOST: process.env.OPENLLM_BASE_HOST,
  OPENLLM_BASE_MODELS: process.env.OPENLLM_BASE_MODELS,
  OPENLLM_BASE_CONNECTION_NAME: process.env.OPENLLM_BASE_CONNECTION_NAME,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('getLlmConnection environment connection', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('returns the synthesized environment connection when LLM_BASE_URL is set', () => {
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1'
    process.env.LLM_MODEL = 'gpt-oss-120b'
    process.env.LLM_CONNECTION_NAME = 'Local LLM'

    expect(getLlmConnection(ENV_CONNECTION_SLUG)).toEqual(
      synthesizeEnvConnection({
        LLM_BASE_URL: process.env.LLM_BASE_URL,
        LLM_MODEL: process.env.LLM_MODEL,
        LLM_CONNECTION_NAME: process.env.LLM_CONNECTION_NAME,
      }),
    )
  })

  it('returns null for the environment connection when LLM_BASE_URL is absent', () => {
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL
    delete process.env.LLM_CONNECTION_NAME

    expect(getLlmConnection(ENV_CONNECTION_SLUG)).toBeNull()
  })
})

describe('getDefaultLlmConnection environment connection fallback', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('returns env-provider slug when LLM_BASE_URL is set and no stored default exists', () => {
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1'
    delete process.env.OPENLLM_BASE_HOST
    // In test env loadStoredConfig() returns null, so no persisted default
    expect(getDefaultLlmConnection()).toBe(ENV_CONNECTION_SLUG)
  })

  it('does not return an env-synthesized slug when neither LLM_BASE_URL nor OPENLLM_BASE_HOST is set', () => {
    delete process.env.LLM_BASE_URL
    delete process.env.OPENLLM_BASE_HOST
    const result = getDefaultLlmConnection()
    expect(result).not.toBe(ENV_CONNECTION_SLUG)
    expect(result).not.toBe(OPENLLM_ENV_CONNECTION_SLUG)
  })

  it('returns openllm-env slug when OPENLLM_HOST is set, taking priority over LLM_BASE_URL', () => {
    process.env.OPENLLM_BASE_HOST = 'http://openllm.internal'
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1'
    expect(getDefaultLlmConnection()).toBe(OPENLLM_ENV_CONNECTION_SLUG)
  })

  it('returns openllm-env slug when only OPENLLM_HOST is set', () => {
    process.env.OPENLLM_BASE_HOST = 'http://openllm.internal'
    delete process.env.LLM_BASE_URL
    expect(getDefaultLlmConnection()).toBe(OPENLLM_ENV_CONNECTION_SLUG)
  })
})

describe('getLlmConnection openllm-env connection', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('returns the synthesized openllm-env connection when OPENLLM_BASE_HOST is set', () => {
    process.env.OPENLLM_BASE_HOST = 'http://openllm.internal'
    process.env.OPENLLM_BASE_MODELS = 'llama-3,mistral-7b'
    process.env.OPENLLM_BASE_CONNECTION_NAME = 'Corp LLM'

    const conn = getLlmConnection(OPENLLM_ENV_CONNECTION_SLUG)
    expect(conn).not.toBeNull()
    expect(conn?.slug).toBe(OPENLLM_ENV_CONNECTION_SLUG)
    expect(conn?.name).toBe('Corp LLM')
    expect(conn?.providerType).toBe('openllm')
    expect(conn?.authType).toBe('none')
    expect(conn?.piAuthProvider).toBe(OPENLLM_PI_AUTH_PROVIDER)
    expect(conn?.customEndpoint).toEqual(OPENLLM_CUSTOM_ENDPOINT)
    expect(conn?.models).toEqual(['llama-3', 'mistral-7b'])
    expect(conn?.defaultModel).toBe('llama-3')
    expect(conn?.isEnvironmentConnection).toBe(true)
  })

  it('uses default name "OpenLLM" when OPENLLM_BASE_CONNECTION_NAME is absent', () => {
    process.env.OPENLLM_BASE_HOST = 'http://openllm.internal'
    delete process.env.OPENLLM_BASE_CONNECTION_NAME
    expect(getLlmConnection(OPENLLM_ENV_CONNECTION_SLUG)?.name).toBe('OpenLLM')
  })

  it('returns empty model list when OPENLLM_BASE_MODELS is absent', () => {
    process.env.OPENLLM_BASE_HOST = 'http://openllm.internal'
    delete process.env.OPENLLM_BASE_MODELS
    const conn = getLlmConnection(OPENLLM_ENV_CONNECTION_SLUG)
    expect(conn?.models).toEqual([])
    expect(conn?.defaultModel).toBeUndefined()
  })

  it('returns null for openllm-env when OPENLLM_BASE_HOST is absent', () => {
    delete process.env.OPENLLM_BASE_HOST
    expect(getLlmConnection(OPENLLM_ENV_CONNECTION_SLUG)).toBeNull()
  })
})

describe('synthesizeOpenLlmEnvConnection', () => {
  it('trims whitespace from OPENLLM_BASE_MODELS entries', () => {
    const conn = synthesizeOpenLlmEnvConnection({ OPENLLM_BASE_HOST: 'http://h', OPENLLM_BASE_MODELS: ' llama-3 , mistral-7b ' })
    expect(conn?.models).toEqual(['llama-3', 'mistral-7b'])
  })

  it('filters empty entries from OPENLLM_BASE_MODELS', () => {
    const conn = synthesizeOpenLlmEnvConnection({ OPENLLM_BASE_HOST: 'http://h', OPENLLM_BASE_MODELS: 'llama-3,,mistral-7b' })
    expect(conn?.models).toEqual(['llama-3', 'mistral-7b'])
  })
})
