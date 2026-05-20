/**
 * FeedbackAdminPage
 *
 * Admin page for viewing user feedback.
 */

import { MessageSquareText } from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'

export default function FeedbackAdminPage() {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="评价" />
      <ScrollArea className="h-full">
        <div className="flex flex-col items-center justify-center py-24 text-foreground/40">
          <MessageSquareText className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">评价功能暂未开放</p>
        </div>
      </ScrollArea>
    </div>
  )
}
