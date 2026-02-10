import { describe, expect, it } from 'bun:test'
import { mapApiConnectionErrorMessage } from '../useOnboarding'

describe('useOnboarding api connection error localization', () => {
  it('maps backend invalid api key error to localized string', () => {
    const translated = mapApiConnectionErrorMessage('Invalid API key', (key: string, fallback: string) => {
      if (key === 'onboarding:credentials.apiKey.errors.invalid') {
        return '请输入有效的 API Key'
      }
      return fallback
    })

    expect(translated).toBe('请输入有效的 API Key')
  })

  it('maps generic connection error to localized string', () => {
    const translated = mapApiConnectionErrorMessage('Connection error.', (key: string, fallback: string) => {
      if (key === 'onboarding:credentials.apiKey.errors.connectionTestFailed') {
        return '连接测试失败'
      }
      return fallback
    })

    expect(translated).toBe('连接测试失败')
  })
})
