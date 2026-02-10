import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getChatLabels } from '../chat-labels'

describe('chat labels', () => {
  it('returns localized labels', () => {
    const t: TFunction = ((key: string) => ({
      'chat:panel.title': 'Chat Localized',
      'chat:rename.title': 'Rename Chat Localized',
      'chat:rename.placeholder': 'Rename Placeholder',
      'chat:share.action': 'Share Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getChatLabels(t)
    expect(labels.title).toBe('Chat Localized')
    expect(labels.renameTitle).toBe('Rename Chat Localized')
    expect(labels.renamePlaceholder).toBe('Rename Placeholder')
    expect(labels.shareAction).toBe('Share Localized')
  })
})
