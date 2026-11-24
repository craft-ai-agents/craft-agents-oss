/**
 * Crafty (spike) — the on/off switch and the macOS permissions it needs, in App settings.
 *
 * The setting is per device (preferences.json over direct IPC, like the default zoom), so it only
 * appears in the desktop app on macOS. (The Crafty window itself is English only for the spike.)
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { getFileManagerName, isMac, isWebUI } from '@/lib/platform'
import { SettingsCard, SettingsRow, SettingsSection, SettingsSegmentedControl, SettingsToggle } from '@/components/settings'
import type { CraftyDoubleTap, CraftyFollowStrategy, CraftyOpenWith, CraftyPermissionKind, CraftyStatus } from '../../../shared/crafty'

/** How often the section re-reads the status while Crafty waits on Accessibility. */
const WAITING_REFRESH_MS = 2000

function PermissionState({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? 'text-label-sm text-success' : 'text-label-sm text-secondary'}>{label}</span>
}

export function CraftySettingsSection() {
  const { t } = useTranslation()
  const crafty = window.electronAPI.crafty
  const [status, setStatus] = useState<CraftyStatus | null>(null)

  const refresh = useCallback(async () => {
    if (!crafty) return
    try {
      setStatus(await crafty.getStatus())
    } catch (error) {
      console.error('[crafty] status failed', error)
    }
  }, [crafty])

  // Permissions are granted in System Settings: re-read when the user comes back
  useEffect(() => {
    void refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  // Also while waiting on Accessibility: a grant made with this page still open, and the double-tap
  // starting a few seconds later, show without leaving the window first
  const waiting = !!status?.running && (!status.accessibility || status.doubleTapProblem === 'accessibility')
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void refresh(), WAITING_REFRESH_MS)
    return () => clearInterval(timer)
  }, [waiting, refresh])

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!crafty) return
    setStatus(current => current && { ...current, enabled })
    const next = await crafty.setEnabled(enabled)
    setStatus(next)
    // macOS's own prompt, which also adds Craft Agents to the Accessibility list with its switch
    if (enabled && next.running && !next.accessibility) await crafty.requestAccessibility()
  }, [crafty])

  const setFollow = useCallback(async (follow: CraftyFollowStrategy) => {
    if (!crafty) return
    setStatus(current => current && { ...current, follow })
    await crafty.setFollow(follow)
    await refresh()
  }, [crafty, refresh])

  const setDoubleTap = useCallback(async (doubleTap: CraftyDoubleTap) => {
    if (!crafty) return
    setStatus(current => current && { ...current, doubleTap })
    setStatus(await crafty.setDoubleTap(doubleTap))
  }, [crafty])

  const setOpenWith = useCallback(async (openWith: CraftyOpenWith) => {
    if (!crafty) return
    setStatus(current => current && { ...current, openWith })
    setStatus(await crafty.setOpenWith(openWith))
  }, [crafty])

  const openSettings = useCallback(async (kind: CraftyPermissionKind) => {
    if (!crafty) return
    // The first request adds Craft Agents to the Accessibility list, so there's a switch to turn on
    if (kind === 'accessibility') await crafty.requestAccessibility()
    await crafty.openPermissionSettings(kind)
  }, [crafty])

  if (!crafty || !isMac || isWebUI || !status) return null

  const blocked = !status.supported || !!status.unavailableReason
  const followOptions: { value: CraftyFollowStrategy; label: string }[] = [
    { value: 'off', label: t('settings.app.crafty.followOff') },
    { value: 'poll', label: t('settings.app.crafty.followPoll') },
    { value: 'mousemove', label: t('settings.app.crafty.followMouse') },
  ]
  const doubleTapOptions: { value: CraftyDoubleTap; label: string }[] = [
    { value: 'command', label: t('settings.app.crafty.leftKey', { key: '⌘' }) },
    { value: 'option', label: t('settings.app.crafty.leftKey', { key: '⌥' }) },
    { value: 'control', label: t('settings.app.crafty.leftKey', { key: '⌃' }) },
    { value: 'off', label: t('settings.app.crafty.doubleTapOff') },
  ]
  const openWithOptions: { value: CraftyOpenWith; label: string }[] = [
    { value: 'pie', label: t('settings.app.crafty.opensPie') },
    { value: 'panel', label: t('settings.app.crafty.opensPanel') },
  ]
  // Only once it's on: the tap waits for Accessibility (or, just allowed, for its helper to restart),
  // or the addon is missing from this build
  const doubleTapNote = status.doubleTap === 'off' ? undefined
    : status.doubleTapProblem === 'accessibility'
      ? t(status.accessibility ? 'settings.app.crafty.doubleTapStarting' : 'settings.app.crafty.doubleTapNeedsAccessibility')
      : status.doubleTapProblem === 'unavailable' ? t('settings.app.crafty.doubleTapUnavailable')
        : undefined
  const screenStatus: Record<string, string> = {
    granted: t('settings.app.crafty.allowed'),
    denied: t('settings.app.crafty.notAllowed'),
    restricted: t('settings.app.crafty.restricted'),
    'not-determined': t('settings.app.crafty.notDetermined'),
  }
  const openSystemSettings = t('settings.app.crafty.openSystemSettings')
  // A switch left on for a build signed by someone else stays on in System Settings but doesn't
  // apply, and apps can't see that (it's in the TCC database). Dev builds use the terminal's switch.
  const accessibilityDescription = status.accessibility || !status.packaged
    ? t('settings.app.crafty.accessibilityDescription')
    : `${t('settings.app.crafty.accessibilityDescription')} ${t('settings.app.crafty.accessibilityStaleSwitch', { button: openSystemSettings })}`

  return (
    <SettingsSection title={t('settings.app.crafty.title')} description={t('settings.app.crafty.description')}>
      <SettingsCard>
        <SettingsToggle
          label="Crafty"
          description={status.unavailableReason ?? t('settings.app.crafty.toggleDescription')}
          checked={status.enabled && !blocked}
          disabled={blocked}
          onCheckedChange={(enabled) => void setEnabled(enabled)}
        />
        {status.enabled && !blocked && (
          <>
            <SettingsRow
              label={t('settings.app.crafty.shortcut')}
              description={status.shortcutRegistered ? undefined : t('settings.app.crafty.shortcutTaken')}
              inCard
            >
              <KbdGroup>
                <Kbd>⌃</Kbd>
                <Kbd>⌥</Kbd>
                <Kbd>Space</Kbd>
              </KbdGroup>
            </SettingsRow>
            <SettingsRow
              label={t('settings.app.crafty.doubleTap')}
              description={doubleTapNote ?? t('settings.app.crafty.doubleTapDescription')}
              inCard
            >
              <SettingsSegmentedControl
                value={status.doubleTap}
                onValueChange={(value) => void setDoubleTap(value)}
                options={doubleTapOptions}
                aria-label={t('settings.app.crafty.doubleTap')}
              />
            </SettingsRow>
            <SettingsRow label={t('settings.app.crafty.opens')} description={t('settings.app.crafty.opensDescription')} inCard>
              <SettingsSegmentedControl
                value={status.openWith}
                onValueChange={(value) => void setOpenWith(value)}
                options={openWithOptions}
                aria-label={t('settings.app.crafty.opens')}
              />
            </SettingsRow>
            {!status.packaged && (
              <SettingsRow
                label={t('settings.app.crafty.devBuild')}
                description={t('settings.app.crafty.devBuildDescription')}
                inCard
              />
            )}
            <SettingsRow
              label={t('settings.app.crafty.accessibility')}
              description={accessibilityDescription}
              action={!status.accessibility && (
                <Button variant="secondary" size="sm" onClick={() => void openSettings('accessibility')}>{openSystemSettings}</Button>
              )}
              inCard
            >
              <PermissionState ok={status.accessibility} label={status.accessibility ? screenStatus.granted : screenStatus.denied} />
            </SettingsRow>
            <SettingsRow
              label={t('settings.app.crafty.screenRecording')}
              description={t('settings.app.crafty.screenRecordingDescription')}
              action={status.screenRecording !== 'granted' && (
                <Button variant="secondary" size="sm" onClick={() => void openSettings('screen')}>{openSystemSettings}</Button>
              )}
              inCard
            >
              <PermissionState ok={status.screenRecording === 'granted'} label={screenStatus[status.screenRecording] ?? status.screenRecording} />
            </SettingsRow>
            <SettingsRow
              label={t('settings.app.crafty.browsers')}
              description={t('settings.app.crafty.browsersDescription')}
              action={<Button variant="ghost" size="sm" onClick={() => void openSettings('automation')}>{openSystemSettings}</Button>}
              inCard
            />
            <SettingsRow
              label={t('settings.app.crafty.followPointerExperiment')}
              description={t('settings.app.crafty.followDescription')}
              inCard
            >
              <SettingsSegmentedControl
                value={status.follow}
                onValueChange={(follow) => void setFollow(follow)}
                options={followOptions}
                aria-label={t('settings.app.crafty.followPointer')}
              />
            </SettingsRow>
            {status.metricsPath && (
              <SettingsRow label={t('settings.app.crafty.measurements')} description={status.metricsPath} inCard
                action={(
                  <Button variant="ghost" size="sm" onClick={() => void window.electronAPI.showInFolder(status.metricsPath!)}>
                    {t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}
                  </Button>
                )}
              />
            )}
          </>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
