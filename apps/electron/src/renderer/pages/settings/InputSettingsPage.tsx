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
import { isMac } from '@/lib/platform'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useTranslations } from '@/i18n'

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
  const { t } = useTranslations()
  
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

  const handleSendMessageKeyChange = useCallback((value: string) => {
    const key = value as 'enter' | 'cmd-enter'
    setSendMessageKey(key)
    window.electronAPI.setSendMessageKey(key)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.input.title', 'Input')} actions={<HeaderMenu route={routes.view.settings('input')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Typing Behavior */}
              <SettingsSection title={t('settings.input.typing', 'Typing')} description={t('settings.input.typingDescription', 'Control how text is entered in the chat input.')}>
                <SettingsCard>
                  <SettingsToggle
                    label={t('settings.input.autoCapitalisation', 'Auto capitalisation')}
                    description={t('settings.input.autoCapitalisationDescription', 'Automatically capitalise the first letter when typing a message.')}
                    checked={autoCapitalisation}
                    onCheckedChange={handleAutoCapitalisationChange}
                  />
                  <SettingsToggle
                    label={t('settings.input.spellCheck', 'Spell check')}
                    description={t('settings.input.spellCheckDescription', 'Underline misspelled words while typing.')}
                    checked={spellCheck}
                    onCheckedChange={handleSpellCheckChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Send Behavior */}
              <SettingsSection title={t('settings.input.sending', 'Sending')} description={t('settings.input.sendingDescription', 'Choose how to send messages.')}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={t('settings.input.sendMessageWith', 'Send message with')}
                    description={t('settings.input.sendMessageWithDescription', 'Keyboard shortcut for sending messages')}
                    value={sendMessageKey}
                    onValueChange={handleSendMessageKeyChange}
                    options={[
                      { value: 'enter', label: t('settings.input.enter', 'Enter'), description: t('settings.input.useShiftEnterForNewLines', 'Use Shift+Enter for new lines') },
                      { value: 'cmd-enter', label: isMac ? t('settings.input.cmdEnter', '⌘ Enter') : t('settings.input.ctrlEnter', 'Ctrl+Enter'), description: t('settings.input.useEnterForNewLines', 'Use Enter for new lines') },
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
