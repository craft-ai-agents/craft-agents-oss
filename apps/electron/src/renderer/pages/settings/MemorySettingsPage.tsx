import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { MemoryReviewQueuePanel } from '@/components/agents/MemoryReviewQueuePanel'
import { MemoryActivityPanel } from '@/components/agents/MemoryActivityPanel'
import { MemoryRecallPanel } from '@/components/agents/MemoryRecallPanel'
import { useUserProfile } from '@/hooks/useUserProfile'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'memory',
}

export default function MemorySettingsPage() {
  const { t } = useTranslation()
  const { entries, loading, error, warning } = useUserProfile()

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.memory.title')} actions={<HeaderMenu route={routes.view.settings('memory')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-[860px] space-y-6 px-6 pb-8 pt-24">
            <SettingsSection
              title="Review queue"
              description="Approve or reject sidecar suggestions before they become durable memory."
            >
              <MemoryReviewQueuePanel />
            </SettingsSection>

            <SettingsSection
              title="User memory"
              description="Durable USER.md entries injected into agent sessions."
            >
              <SettingsCard divided={false}>
                {loading ? (
                  <div className="p-4 text-sm text-white/42"><Spinner className="mr-2 inline h-3.5 w-3.5" />Loading memory...</div>
                ) : error ? (
                  <div className="p-4 text-sm text-red-300">{error}</div>
                ) : (
                  <div className="grid gap-2 p-3">
                    {warning ? (
                      <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{warning}</div>
                    ) : null}
                    {entries.length === 0 ? (
                      <div className="p-2 text-sm text-white/42">No USER.md memories yet.</div>
                    ) : entries.map((entry) => (
                      <div key={entry.name} className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] p-3">
                        <div className="truncate text-sm font-medium text-white/82">{entry.name}</div>
                        <div className="mt-1 line-clamp-3 text-xs text-white/45">{entry.body}</div>
                        <div className="mt-2 text-[11px] uppercase tracking-wide text-white/32">{entry.type}</div>
                      </div>
                    ))}
                  </div>
                )}
              </SettingsCard>
            </SettingsSection>

            <SettingsSection
              title="Recall"
              description="Search durable memory through the recall path agents can use."
            >
              <MemoryRecallPanel />
            </SettingsSection>

            <SettingsSection
              title="Activity"
              description="Recent USER.md writes, updates, and deletes."
            >
              <MemoryActivityPanel scope="user" />
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
