import { describe, expect, it } from 'bun:test'
import { parseWebDeepLink } from '../adapter/deep-link'

describe('WebUI app links', () => {
  it('preserves a skill creation prompt and context badges through URL decoding', () => {
    const input = '<edit_request>\n<file>D:\\workspace\\skills/</file>\n</edit_request>\n\n创建周报摘要技能，保留 A&B + C?'
    const badges = JSON.stringify([{ type: 'context', label: '添加技能', start: 0, end: 82 }])
    const params = new URLSearchParams({ input, badges, send: 'true', mode: 'allow-all', workdir: 'none' })

    expect(parseWebDeepLink(`craftagents://action/new-session?${params}`)).toEqual({
      action: 'new-session',
      actionParams: { input, badges, send: 'true', mode: 'allow-all', workdir: 'none' },
    })
  })

  it('preserves model and prompt selection without native window controls', () => {
    expect(parseWebDeepLink('craftagents://action/new-session?model=fast&systemPrompt=mini&window=focused&sidebar=history')).toEqual({
      action: 'new-session',
      actionParams: { model: 'fast', systemPrompt: 'mini' },
    })
  })

  it('routes view links through the shared route parser', () => {
    for (const view of ['skills/skill/weekly-summary', 'sources/source/git', 'settings/appearance', 'allSessions/session/abc']) {
      expect(parseWebDeepLink(`craftagents://${view}?window=focused`)).toEqual({ view })
    }
  })

  it('preserves path-based action IDs', () => {
    expect(parseWebDeepLink('craftagents://action/flag-session/abc')).toEqual({
      action: 'flag-session', actionParams: { id: 'abc' },
    })
  })

  it('rejects malformed, external, and unsupported links instead of navigating elsewhere', () => {
    for (const url of ['invalid', 'https://example.com/action/new-session', 'javascript:alert(1)', 'craftagents://auth-callback?code=secret', 'craftagents://unknown', 'craftagents://workspace/another/action/new-session']) {
      expect(parseWebDeepLink(url)).toBeNull()
    }
  })
})
