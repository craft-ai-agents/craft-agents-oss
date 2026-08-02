/**
 * SettingsPanel
 *
 * The shell's Settings view. This used to be a second, parallel settings
 * system: a flat list of hardcoded English toggles that duplicated eleven rows
 * already present in the registry-driven settings pages, and diverged from them
 * over time. It is now a thin two-pane host over that same registry — the
 * navigator on the left, the selected page on the right — so the shell and the
 * chat surface show one set of settings rather than two.
 *
 * The two rows that lived only here moved into the pages they belong to:
 *   - "Allow remote evaluate" -> AppSettingsPage (Tools)
 *   - Export / Import settings -> AppSettingsPage (Backup)
 *
 * A third, "Compact UI", was dropped: it toggled a `compact-ui` class on
 * <html> that no stylesheet has ever consumed, so the control did nothing.
 */

import { useState } from 'react'
import SettingsNavigator from '@/pages/settings/SettingsNavigator'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import './SettingsPanel.css'

/** Opening Settings with nothing selected should still show something useful. */
const DEFAULT_SUBPAGE: SettingsSubpage = 'app'

export function SettingsPanel() {
  const [subpage, setSubpage] = useState<SettingsSubpage>(DEFAULT_SUBPAGE)
  const SettingsPage = getSettingsPageComponent(subpage)

  return (
    <div className="settings-panel">
      <div className="settings-panel__nav">
        <SettingsNavigator selectedSubpage={subpage} onSelectSubpage={setSubpage} />
      </div>
      <div className="settings-panel__detail">
        {/* Remount on subpage change so each page runs its own load effect
            instead of showing the previous page's state during the swap. */}
        <SettingsPage key={subpage} />
      </div>
    </div>
  )
}
