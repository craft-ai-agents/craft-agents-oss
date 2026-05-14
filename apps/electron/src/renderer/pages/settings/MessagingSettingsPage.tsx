import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'messaging',
}

export default function MessagingSettingsPage() {
  const { t } = useTranslation()
  return (
    <>
      <PanelHeader title={t('settings.messaging.title')} />
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-foreground/40">
          <MessageSquare className="h-8 w-8" />
          <p className="text-sm">{t('settings.messaging.noChannels', 'No messaging channels configured')}</p>
        </div>
      </ScrollArea>
    </>
  )
}
