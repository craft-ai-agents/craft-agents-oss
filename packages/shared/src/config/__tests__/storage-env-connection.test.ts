import { afterEach, describe, expect, it } from 'bun:test'
import {
  ENV_CONNECTION_SLUG,
  getDefaultLlmConnection,
  getLlmConnection,
  synthesizeEnvConnection,
} from '../index'

const ORIGINAL_ENV = {
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_CONNECTION_NAME: process.env.LLM_CONNECTION_NAME,
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
    // In test env loadStoredConfig() returns null, so no persisted default
    expect(getDefaultLlmConnection()).toBe(ENV_CONNECTION_SLUG)
  })

  it('returns null when LLM_BASE_URL is absent and no stored connections exist', () => {
    delete process.env.LLM_BASE_URL
    expect(getDefaultLlmConnection()).toBeNull()
  })
})
