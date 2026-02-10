import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getSessionListLabels } from '../session-list-labels'
import { getSetupAuthBannerLabels } from '../SetupAuthBanner'

describe('toast and banner labels', () => {
  it('returns localized session list labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:sessionList.share.linkCopied': '链接已复制',
      'common:sessionList.share.updateFailed': '更新分享失败',
      'common:sessionList.date.today': '今天',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSessionListLabels(t)
    expect(labels.linkCopied).toBe('链接已复制')
    expect(labels.updateFailed).toBe('更新分享失败')
    expect(labels.today).toBe('今天')
  })

  it('returns localized setup auth banner labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:authBanner.title.mcpAuth': '需要连接',
      'common:authBanner.cta.connect': '连接',
      'common:authBanner.description.error': '出现错误，请重试。',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSetupAuthBannerLabels(t)
    expect(labels.title.mcpAuth).toBe('需要连接')
    expect(labels.cta.connect).toBe('连接')
    expect(labels.description.error).toBe('出现错误，请重试。')
  })
})
