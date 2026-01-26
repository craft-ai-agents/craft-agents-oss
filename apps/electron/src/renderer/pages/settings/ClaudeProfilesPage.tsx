/**
 * ClaudeProfilesPage
 *
 * Settings page for managing Claude multi-account profiles.
 */

import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ClaudeProfilesSettingsSection } from '@/components/claude-profiles'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'claude-profiles',
}

export default function ClaudeProfilesPage() {
  return (
    <>
      <PanelHeader title="Claude Accounts" />
      <ScrollArea className="flex-1">
        <div className="px-6 py-6">
          <div className="max-w-2xl mx-auto">
            <ClaudeProfilesSettingsSection />
          </div>
        </div>
      </ScrollArea>
    </>
  )
}
