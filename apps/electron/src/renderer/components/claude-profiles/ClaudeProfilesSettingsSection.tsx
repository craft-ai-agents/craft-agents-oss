/**
 * Claude Profiles Settings Section
 *
 * Main settings component for managing Claude multi-account profiles.
 * Includes profile list, OAuth flow, auto-switch settings, and monitoring controls.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { RefreshCw, Activity, Loader2 } from 'lucide-react'
import {
  SettingsSection,
  SettingsGroup,
  SettingsCard,
  SettingsToggle,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { ProfileList } from './ProfileList'
import { AutoSwitchSettings } from './AutoSwitchSettings'
import {
  profilesAtom,
  autoSwitchAtom,
  monitoringAtom,
  loadProfilesAtom,
  loadAutoSwitchSettingsAtom,
  updateAutoSwitchSettingsAtom,
  startOAuthAtom,
  completeOAuthAtom,
  updateProfileAtom,
  deleteProfileAtom,
  setActiveProfileAtom,
  setDefaultProfileAtom,
  pollProfileUsageAtom,
  startMonitoringAtom,
  stopMonitoringAtom,
  checkMonitoringAtom,
  setupProfileEventsAtom,
} from '@/atoms/claude-profiles'
import type { ClaudeAutoSwitchSettings } from '../../../shared/types'

/** OAuth Dialog State */
interface OAuthDialogState {
  isOpen: boolean
  step: 'name' | 'authorize' | 'code'
  profileName: string
  oauthState: string | null
  error: string | null
}

export function ClaudeProfilesSettingsSection() {
  // Atoms
  const [profiles, setProfiles] = useAtom(profilesAtom)
  const [autoSwitch, setAutoSwitch] = useAtom(autoSwitchAtom)
  const [monitoring] = useAtom(monitoringAtom)

  // Action atoms
  const loadProfiles = useSetAtom(loadProfilesAtom)
  const loadAutoSwitchSettings = useSetAtom(loadAutoSwitchSettingsAtom)
  const updateAutoSwitchSettings = useSetAtom(updateAutoSwitchSettingsAtom)
  const startOAuth = useSetAtom(startOAuthAtom)
  const completeOAuth = useSetAtom(completeOAuthAtom)
  const updateProfile = useSetAtom(updateProfileAtom)
  const deleteProfile = useSetAtom(deleteProfileAtom)
  const setActiveProfile = useSetAtom(setActiveProfileAtom)
  const setDefaultProfile = useSetAtom(setDefaultProfileAtom)
  const pollProfileUsage = useSetAtom(pollProfileUsageAtom)
  const startMonitoring = useSetAtom(startMonitoringAtom)
  const stopMonitoring = useSetAtom(stopMonitoringAtom)
  const checkMonitoring = useSetAtom(checkMonitoringAtom)
  const setupProfileEvents = useSetAtom(setupProfileEventsAtom)

  // Local state
  const [oauthDialog, setOAuthDialog] = useState<OAuthDialogState>({
    isOpen: false,
    step: 'name',
    profileName: '',
    oauthState: null,
    error: null,
  })
  const [authCode, setAuthCode] = useState('')
  const [isPolling, setIsPolling] = useState(false)

  // Load data on mount
  useEffect(() => {
    loadProfiles()
    loadAutoSwitchSettings()
    checkMonitoring()

    // Setup event listeners
    const cleanup = setupProfileEvents()
    return cleanup
  }, [loadProfiles, loadAutoSwitchSettings, checkMonitoring, setupProfileEvents])

  // Handle add profile
  const handleAddProfile = useCallback(() => {
    setOAuthDialog({
      isOpen: true,
      step: 'name',
      profileName: '',
      oauthState: null,
      error: null,
    })
  }, [])

  // Handle OAuth step 1: Start OAuth
  const handleStartOAuth = useCallback(async () => {
    if (!oauthDialog.profileName.trim()) {
      setOAuthDialog((prev) => ({ ...prev, error: 'Please enter a profile name' }))
      return
    }

    try {
      setOAuthDialog((prev) => ({ ...prev, error: null }))
      const result = await startOAuth(oauthDialog.profileName.trim())
      setOAuthDialog((prev) => ({
        ...prev,
        step: 'code',
        oauthState: result.state,
      }))
    } catch (error) {
      setOAuthDialog((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to start OAuth',
      }))
    }
  }, [oauthDialog.profileName, startOAuth])

  // Handle OAuth step 2: Complete with code
  const handleCompleteOAuth = useCallback(async () => {
    if (!authCode.trim() || !oauthDialog.oauthState) {
      setOAuthDialog((prev) => ({ ...prev, error: 'Please enter the authorization code' }))
      return
    }

    try {
      setOAuthDialog((prev) => ({ ...prev, error: null }))
      await completeOAuth({ code: authCode.trim(), state: oauthDialog.oauthState })
      setOAuthDialog({
        isOpen: false,
        step: 'name',
        profileName: '',
        oauthState: null,
        error: null,
      })
      setAuthCode('')
    } catch (error) {
      setOAuthDialog((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to complete OAuth',
      }))
    }
  }, [authCode, oauthDialog.oauthState, completeOAuth])

  // Handle close dialog
  const handleCloseDialog = useCallback(() => {
    setOAuthDialog({
      isOpen: false,
      step: 'name',
      profileName: '',
      oauthState: null,
      error: null,
    })
    setAuthCode('')
  }, [])

  // Handle poll all usage
  const handlePollUsage = useCallback(async () => {
    setIsPolling(true)
    try {
      await Promise.all(profiles.items.map((p) => pollProfileUsage(p.id)))
    } finally {
      setIsPolling(false)
    }
  }, [profiles.items, pollProfileUsage])

  // Handle auto-switch settings update
  const handleUpdateAutoSwitch = useCallback(
    (updates: Partial<ClaudeAutoSwitchSettings>) => {
      updateAutoSwitchSettings(updates)
    },
    [updateAutoSwitchSettings]
  )

  // Handle monitoring toggle
  const handleToggleMonitoring = useCallback(async () => {
    if (monitoring.isActive) {
      await stopMonitoring()
    } else {
      await startMonitoring()
    }
  }, [monitoring.isActive, startMonitoring, stopMonitoring])

  return (
    <div className="space-y-8">
      {/* Profiles Section */}
      <SettingsGroup title="Claude Accounts">
        <SettingsSection
          title="Connected Accounts"
          description="Manage your Claude Pro/Max accounts for automatic switching"
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePollUsage}
                disabled={isPolling || profiles.items.length === 0}
                className="h-8"
              >
                {isPolling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="ml-1.5">Refresh Usage</span>
              </Button>
            </div>
          }
        >
          <ProfileList
            profiles={profiles.items}
            activeId={profiles.activeId}
            isLoading={profiles.isLoading}
            onAddProfile={handleAddProfile}
            onSetActive={setActiveProfile}
            onSetDefault={setDefaultProfile}
            onDelete={deleteProfile}
            onRename={(id, name) => updateProfile({ profileId: id, updates: { name } })}
          />
        </SettingsSection>
      </SettingsGroup>

      {/* Auto-Switch Section */}
      <SettingsGroup
        title="Auto-Switching"
        badge={
          profiles.items.length >= 2 && (
            <div className="flex items-center gap-1.5 text-xs">
              <Activity className={monitoring.isActive ? 'w-3 h-3 text-emerald-500' : 'w-3 h-3 text-muted-foreground'} />
              <span className={monitoring.isActive ? 'text-emerald-500' : 'text-muted-foreground'}>
                {monitoring.isActive ? 'Monitoring' : 'Paused'}
              </span>
            </div>
          )
        }
      >
        {profiles.items.length < 2 ? (
          <SettingsCard>
            <div className="px-4 py-6 text-center text-muted-foreground">
              <p className="text-sm">Add at least 2 Claude accounts to enable auto-switching.</p>
              <p className="text-xs mt-1">This feature automatically switches to another account when usage limits are reached.</p>
            </div>
          </SettingsCard>
        ) : (
          <>
            {/* Monitoring toggle */}
            <SettingsSection title="Usage Monitoring" description="Track usage across all accounts in real-time">
              <SettingsCard>
                <SettingsToggle
                  label="Enable Monitoring"
                  description="Poll usage data every 30 seconds"
                  checked={monitoring.isActive}
                  onCheckedChange={handleToggleMonitoring}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Auto-switch settings */}
            <SettingsSection title="Switching Behavior" description="Configure when to automatically switch accounts">
              <AutoSwitchSettings
                settings={autoSwitch.settings}
                isLoading={autoSwitch.isLoading}
                onUpdate={handleUpdateAutoSwitch}
              />
            </SettingsSection>
          </>
        )}
      </SettingsGroup>

      {/* OAuth Dialog */}
      {oauthDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={handleCloseDialog} />
          <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">
              {oauthDialog.step === 'name' ? 'Add Claude Account' : 'Complete Authorization'}
            </h2>

            {oauthDialog.error && (
              <div className="mb-4 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {oauthDialog.error}
              </div>
            )}

            {oauthDialog.step === 'name' && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Profile Name</label>
                  <input
                    type="text"
                    value={oauthDialog.profileName}
                    onChange={(e) => setOAuthDialog((prev) => ({ ...prev, profileName: e.target.value }))}
                    placeholder="e.g., Work, Personal"
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="ghost" onClick={handleCloseDialog}>
                    Cancel
                  </Button>
                  <Button onClick={handleStartOAuth}>
                    Continue to Claude
                  </Button>
                </div>
              </div>
            )}

            {oauthDialog.step === 'code' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  A browser window should have opened. After authorizing, paste the code below.
                </p>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Authorization Code</label>
                  <input
                    type="text"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="Paste the code from Claude"
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="ghost" onClick={handleCloseDialog}>
                    Cancel
                  </Button>
                  <Button onClick={handleCompleteOAuth}>
                    Complete Setup
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
