/**
 * Notification Settings Section
 *
 * Configure desktop notification preferences including sound, quiet hours, and notification types.
 */

import { useEffect, useState } from 'react'
import { Bell, Volume2, CheckCircle2, XCircle } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsInputRow,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { playNotificationSound } from '@/lib/notification-sound'
import type { NotificationSettings } from '@vesper/shared/config'

export function NotificationSettingsSection() {
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: true,
    sound: true,
    soundVolume: 50,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    agentCompletion: true,
    agentError: true,
    schedulerRun: true,
    messageReceived: true,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI?.getNotificationSettings) return

      setIsLoading(true)
      try {
        const settings = await window.electronAPI.getNotificationSettings()
        setSettings(settings)
      } catch (err) {
        console.error('Failed to load notification settings:', err)
        setError('Failed to load notification settings')
      } finally {
        setIsLoading(false)
      }
    }

    loadSettings()
  }, [])

  // Listen for settings changes
  useEffect(() => {
    if (!window.electronAPI?.onNotificationSettingsChanged) return

    const unsubscribe = window.electronAPI.onNotificationSettingsChanged(async () => {
      // Reload settings when they change
      try {
        const settings = await window.electronAPI.getNotificationSettings()
        setSettings(settings)
      } catch (err) {
        console.error('Failed to reload notification settings:', err)
      }
    })

    return unsubscribe
  }, [])

  // Auto-save settings on change
  const updateSettings = async (updates: Partial<NotificationSettings>) => {
    const newSettings = { ...settings, ...updates }
    setSettings(newSettings)
    setError(null)

    if (!window.electronAPI?.setNotificationSettings) return

    try {
      const result = await window.electronAPI.setNotificationSettings(newSettings)
      if (!result.success) {
        setError(result.error || 'Failed to save settings')
      }
    } catch (err) {
      console.error('Failed to save notification settings:', err)
      setError('Failed to save settings')
    }
  }

  const handleTestNotification = async () => {
    if (!window.electronAPI?.testNotification) return

    setTestStatus('testing')
    setError(null)

    try {
      const result = await window.electronAPI.testNotification()
      if (result.success) {
        setTestStatus('success')
        setTimeout(() => setTestStatus('idle'), 3000)
      } else {
        setTestStatus('error')
        setError(result.error || 'Failed to send test notification')
      }
    } catch (err) {
      console.error('Failed to send test notification:', err)
      setTestStatus('error')
      setError('Failed to send test notification')
    }
  }

  const isDisabled = !settings.enabled

  return (
    <SettingsSection
      title="Notifications"
      description="Configure desktop notification preferences"
    >
      {/* Master toggle */}
      <SettingsCard>
        <SettingsToggle
          label="Enable Notifications"
          description="Show desktop notifications for important events"
          checked={settings.enabled}
          onCheckedChange={(enabled) => updateSettings({ enabled })}
          disabled={isLoading}
        />
      </SettingsCard>

      {/* Sound Settings */}
      <SettingsCard>
        <SettingsToggle
          label="Play Sound"
          description="Play a notification chime"
          checked={settings.sound}
          onCheckedChange={(sound) => updateSettings({ sound })}
          disabled={isDisabled || isLoading}
        />
        {settings.sound && (
          <div className={cn('px-4 py-3.5 border-t border-border/50', isDisabled && 'opacity-50')}>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Volume</Label>
              <button
                type="button"
                onClick={() => playNotificationSound(settings.soundVolume)}
                disabled={isDisabled || isLoading}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Preview
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="range"
                min="0"
                max="100"
                value={settings.soundVolume}
                onChange={(e) => updateSettings({ soundVolume: parseInt(e.target.value) })}
                disabled={isDisabled || isLoading}
                className="flex-1 h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
              />
              <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
                {settings.soundVolume}%
              </span>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Quiet Hours */}
      <SettingsCard>
        <SettingsToggle
          label="Enable Quiet Hours"
          description="Disable notifications during specific hours"
          checked={settings.quietHoursEnabled}
          onCheckedChange={(quietHoursEnabled) => updateSettings({ quietHoursEnabled })}
          disabled={isDisabled || isLoading}
        />
        {settings.quietHoursEnabled && (
          <>
            <SettingsInputRow
              label="Start Time"
              description="Time when quiet hours begin"
              value={settings.quietHoursStart}
              onChange={(quietHoursStart) => updateSettings({ quietHoursStart })}
              type="text"
              placeholder="22:00"
              disabled={isDisabled || isLoading}
            />
            <SettingsInputRow
              label="End Time"
              description="Time when quiet hours end"
              value={settings.quietHoursEnd}
              onChange={(quietHoursEnd) => updateSettings({ quietHoursEnd })}
              type="text"
              placeholder="08:00"
              disabled={isDisabled || isLoading}
            />
          </>
        )}
      </SettingsCard>

      {/* Notification Types */}
      <SettingsCard>
        <div className="px-4 py-3.5 border-b border-border/50">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notification Types
          </h4>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which events trigger notifications
          </p>
        </div>
        <SettingsToggle
          label="Agent Completion"
          description="Notify when agent finishes a task"
          checked={settings.agentCompletion}
          onCheckedChange={(agentCompletion) => updateSettings({ agentCompletion })}
          disabled={isDisabled || isLoading}
        />
        <SettingsToggle
          label="Agent Errors"
          description="Notify when agent encounters an error"
          checked={settings.agentError}
          onCheckedChange={(agentError) => updateSettings({ agentError })}
          disabled={isDisabled || isLoading}
        />
        <SettingsToggle
          label="Scheduled Runs"
          description="Notify when scheduled tasks run"
          checked={settings.schedulerRun}
          onCheckedChange={(schedulerRun) => updateSettings({ schedulerRun })}
          disabled={isDisabled || isLoading}
        />
        <SettingsToggle
          label="Messages Received"
          description="Notify on WhatsApp/Slack messages"
          checked={settings.messageReceived}
          onCheckedChange={(messageReceived) => updateSettings({ messageReceived })}
          disabled={isDisabled || isLoading}
        />
      </SettingsCard>

      {/* Test Notification */}
      <SettingsCard divided={false}>
        <div className="p-4">
          <Button
            onClick={handleTestNotification}
            disabled={isDisabled || testStatus === 'testing'}
            variant="outline"
            className="w-full"
          >
            {testStatus === 'testing' ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-foreground mr-2" />
                Sending Test...
              </>
            ) : testStatus === 'success' ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2 text-green-600 dark:text-green-400" />
                Test Sent Successfully
              </>
            ) : testStatus === 'error' ? (
              <>
                <XCircle className="w-4 h-4 mr-2 text-red-600 dark:text-red-400" />
                Test Failed
              </>
            ) : (
              <>
                <Bell className="w-4 h-4 mr-2" />
                Send Test Notification
              </>
            )}
          </Button>
        </div>
      </SettingsCard>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
