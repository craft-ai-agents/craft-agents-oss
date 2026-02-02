/**
 * InputSettingsPage
 *
 * Input behavior settings that control how the chat input works.
 *
 * Settings:
 * - Auto Capitalisation (on/off)
 * - Spell Check (on/off)
 * - Send Message Key (Enter or ⌘+Enter)
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useI18n } from '@/i18n'

import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'input',
}

// ============================================
// Main Component
// ============================================

export default function InputSettingsPage() {
  const { t } = useI18n('settings')

  // Auto-capitalisation state
  const [autoCapitalisation, setAutoCapitalisation] = useState(true)

  // Spell check state (default off)
  const [spellCheck, setSpellCheck] = useState(false)

  // Send message key state
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter'>('enter')

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [autoCapEnabled, spellCheckEnabled, sendKey] = await Promise.all([
          window.electronAPI.getAutoCapitalisation(),
          window.electronAPI.getSpellCheck(),
          window.electronAPI.getSendMessageKey(),
        ])
        setAutoCapitalisation(autoCapEnabled)
        setSpellCheck(spellCheckEnabled)
        setSendMessageKey(sendKey)
      } catch (error) {
        console.error('Failed to load input settings:', error)
      }
    }
    loadSettings()
  }, [])

  const handleAutoCapitalisationChange = useCallback(async (enabled: boolean) => {
    setAutoCapitalisation(enabled)
    await window.electronAPI.setAutoCapitalisation(enabled)
  }, [])

  const handleSpellCheckChange = useCallback(async (enabled: boolean) => {
    setSpellCheck(enabled)
    await window.electronAPI.setSpellCheck(enabled)
  }, [])

  const handleSendMessageKeyChange = useCallback(async (key: 'enter' | 'cmd-enter') => {
    setSendMessageKey(key)
    await window.electronAPI.setSendMessageKey(key)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('input.title')} actions={<HeaderMenu route={routes.view.settings('input')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Typing Behavior */}
              <SettingsSection title={t('input.typing.title')} description={t('input.typing.description')}>
                <SettingsCard>
                  <SettingsToggle
                    label={t('input.typing.autoCapitalisation')}
                    description={t('input.typing.autoCapitalisationDescription')}
                    checked={autoCapitalisation}
                    onCheckedChange={handleAutoCapitalisationChange}
                  />
                  <SettingsToggle
                    label={t('input.typing.spellCheck')}
                    description={t('input.typing.spellCheckDescription')}
                    checked={spellCheck}
                    onCheckedChange={handleSpellCheckChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Send Behavior */}
              <SettingsSection title={t('input.sending.title')} description={t('input.sending.description')}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={t('input.sending.sendMessageWith')}
                    description={t('input.sending.sendMessageWithDescription')}
                    value={sendMessageKey}
                    onValueChange={handleSendMessageKeyChange}
                    options={[
                      { value: 'enter', label: t('input.sending.enterOption'), description: t('input.sending.enterOptionDescription') },
                      { value: 'cmd-enter', label: t('input.sending.cmdEnterOption'), description: t('input.sending.cmdEnterOptionDescription') },
                    ]}
                  />
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
