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

import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { useTranslation } from 'react-i18next'

export function getInputLabels(t: (key: string) => string) {
  return {
    pageTitle: t('settings:input.pageTitle'),
    typingTitle: t('settings:input.typing.title'),
    typingDescription: t('settings:input.typing.description'),
    autoCapitalisationLabel: t('settings:input.typing.autoCapitalisation.label'),
    autoCapitalisationDescription: t('settings:input.typing.autoCapitalisation.description'),
    spellCheckLabel: t('settings:input.typing.spellCheck.label'),
    spellCheckDescription: t('settings:input.typing.spellCheck.description'),
    sendingTitle: t('settings:input.sending.title'),
    sendingDescription: t('settings:input.sending.description'),
    sendMessageLabel: t('settings:input.sendMessage.label'),
    sendMessageDescription: t('settings:input.sendMessage.description'),
    sendMessageEnterLabel: t('settings:input.sendMessage.options.enter.label'),
    sendMessageEnterDescription: t('settings:input.sendMessage.options.enter.description'),
    sendMessageCmdEnterLabel: t('settings:input.sendMessage.options.cmdEnter.label'),
    sendMessageCmdEnterDescription: t('settings:input.sendMessage.options.cmdEnter.description'),
  }
}

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'input',
}

// ============================================
// Main Component
// ============================================

export default function InputSettingsPage() {
  const { t } = useTranslation(['settings'])
  const labels = getInputLabels(t)
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
      <PanelHeader title={labels.pageTitle} actions={<HeaderMenu route={routes.view.settings('input')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Typing Behavior */}
              <SettingsSection title={labels.typingTitle} description={labels.typingDescription}>
                <SettingsCard>
                  <SettingsToggle
                    label={labels.autoCapitalisationLabel}
                    description={labels.autoCapitalisationDescription}
                    checked={autoCapitalisation}
                    onCheckedChange={handleAutoCapitalisationChange}
                  />
                  <SettingsToggle
                    label={labels.spellCheckLabel}
                    description={labels.spellCheckDescription}
                    checked={spellCheck}
                    onCheckedChange={handleSpellCheckChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Send Behavior */}
              <SettingsSection title={labels.sendingTitle} description={labels.sendingDescription}>
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label={labels.sendMessageLabel}
                    description={labels.sendMessageDescription}
                    value={sendMessageKey}
                    onValueChange={handleSendMessageKeyChange}
                    options={[
                      { value: 'enter', label: labels.sendMessageEnterLabel, description: labels.sendMessageEnterDescription },
                      { value: 'cmd-enter', label: labels.sendMessageCmdEnterLabel, description: labels.sendMessageCmdEnterDescription },
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
