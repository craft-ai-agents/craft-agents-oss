import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getApiSetupLabels, getWelcomeLabels, getReauthLabels, getCredentialsLabels } from '../labels'

describe('onboarding i18n', () => {
  it('returns localized welcome labels', () => {
    const t: TFunction = ((key: string) => ({
      'onboarding:welcome.title': '欢迎使用 Craft Agents',
      'onboarding:welcome.cta': '开始',
      'onboarding:welcome.description': '欢迎文案',
      'onboarding:welcome.titleExisting': '更新设置',
      'onboarding:welcome.descriptionExisting': '更新说明',
      'onboarding:welcome.ctaExisting': '继续',
      'onboarding:welcome.loading': '正在检查...',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getWelcomeLabels(t)
    expect(labels.title).toBe('欢迎使用 Craft Agents')
    expect(labels.titleExisting).toBe('更新设置')
    expect(labels.description).toBe('欢迎文案')
    expect(labels.descriptionExisting).toBe('更新说明')
    expect(labels.cta).toBe('开始')
    expect(labels.ctaExisting).toBe('继续')
    expect(labels.loading).toBe('正在检查...')
  })

  it('returns localized reauth labels', () => {
    const t: TFunction = ((key: string) => ({
      'onboarding:reauth.title': '会话已过期',
      'onboarding:reauth.description': '请重新登录。',
      'onboarding:reauth.descriptionSecondary': '请重新登录以继续使用 Craft Agents。',
      'onboarding:reauth.note': '你的会话已保留。',
      'onboarding:reauth.login': '重新登录',
      'onboarding:reauth.loggingIn': '正在登录...',
      'onboarding:reauth.reset': '重置并重新开始...',
      'onboarding:reauth.error': '登录失败',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getReauthLabels(t)
    expect(labels.title).toBe('会话已过期')
    expect(labels.description).toBe('请重新登录。')
    expect(labels.descriptionSecondary).toBe('请重新登录以继续使用 Craft Agents。')
    expect(labels.note).toBe('你的会话已保留。')
    expect(labels.login).toBe('重新登录')
    expect(labels.loggingIn).toBe('正在登录...')
    expect(labels.reset).toBe('重置并重新开始...')
    expect(labels.error).toBe('登录失败')
  })

  it('returns localized api setup labels including actions', () => {
    const t: TFunction = ((key: string) => ({
      'onboarding:apiSetup.title': '设置 API 连接',
      'onboarding:apiSetup.description': '选择连接方式',
      'onboarding:apiSetup.recommended': '推荐',
      'onboarding:apiSetup.back': '返回',
      'onboarding:apiSetup.continue': '继续',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getApiSetupLabels(t)
    expect(labels.title).toBe('设置 API 连接')
    expect(labels.description).toBe('选择连接方式')
    expect(labels.recommended).toBe('推荐')
    expect(labels.back).toBe('返回')
    expect(labels.continue).toBe('继续')
  })

  it('returns localized credentials validation and helper labels', () => {
    const t: TFunction = ((key: string) => ({
      'onboarding:credentials.apiKey.errors.invalid': '请输入有效的 API Key',
      'onboarding:credentials.apiKey.modelHelp.custom': '留空时默认使用 Anthropic 模型名（Opus、Sonnet、Haiku）',
      'onboarding:credentials.apiKey.modelHelp.nonClaude': 'Claude 模型请留空，仅在非 Claude 模型时填写。',
      'onboarding:credentials.apiKey.modelHelp.formatPrefix': '格式：',
      'onboarding:credentials.apiKey.modelHelp.browseModels': '浏览模型',
      'onboarding:credentials.apiKey.modelHelp.viewSupportedModels': '查看支持模型',
      'onboarding:credentials.apiKey.modelHelp.ollama': '使用通过 ollama pull 拉取的任意模型。无需 API Key。',
      'onboarding:credentials.actions.back': '返回',
      'onboarding:credentials.actions.continue': '继续',
      'onboarding:credentials.apiKey.modelLabel': '模型',
      'onboarding:credentials.apiKey.optional': '可选',
      'onboarding:credentials.apiKey.presets.custom': '自定义',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getCredentialsLabels(t)
    expect(labels.apiKeyInvalid).toBe('请输入有效的 API Key')
    expect(labels.customModelDefaultHint).toBe('留空时默认使用 Anthropic 模型名（Opus、Sonnet、Haiku）')
    expect(labels.nonClaudeHint).toBe('Claude 模型请留空，仅在非 Claude 模型时填写。')
    expect(labels.formatPrefix).toBe('格式：')
    expect(labels.browseModels).toBe('浏览模型')
    expect(labels.viewSupportedModels).toBe('查看支持模型')
    expect(labels.ollamaHint).toBe('使用通过 ollama pull 拉取的任意模型。无需 API Key。')
    expect(labels.back).toBe('返回')
    expect(labels.continue).toBe('继续')
    expect(labels.customModelLabel).toBe('模型')
    expect(labels.optional).toBe('可选')
    expect(labels.customPreset).toBe('自定义')
  })
})
