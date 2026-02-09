/**
 * HelpDialog
 *
 * A reusable dialog that shows inline help content for Sources and Skills features.
 * Reads the helpDialogAtom to determine which feature to show, looks up content
 * by locale, and renders it in a scrollable dialog with optional tabs (for MCP).
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useRegisterModal } from '@/context/ModalContext'
import { useLocale } from '@/context/LocaleContext'
import { useAtom } from 'jotai'
import { helpDialogAtom } from '@/atoms/help'
import { getHelpContent } from '@/help/content'
import { isTabbedHelpPage } from '@/help/types'
import type { HelpPage, HelpSection } from '@/help/types'

function HelpSectionView({ section }: { section: HelpSection }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
      {section.paragraphs?.map((p, i) => (
        <p key={i} className="text-sm text-foreground/80 leading-relaxed">{p}</p>
      ))}
      {section.items && (
        <ul className="space-y-1.5 ml-4">
          {section.items.map((item, i) => (
            <li key={i} className="text-sm text-foreground/80 leading-relaxed list-disc">{item}</li>
          ))}
        </ul>
      )}
      {section.code && (
        <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto">
          <code>{section.code}</code>
        </pre>
      )}
    </div>
  )
}

function HelpPageView({ page }: { page: HelpPage }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/60">{page.summary}</p>
      {page.sections.map((section, i) => (
        <HelpSectionView key={i} section={section} />
      ))}
    </div>
  )
}

export function HelpDialog() {
  const [state, setState] = useAtom(helpDialogAtom)
  const { locale } = useLocale()

  const handleOpenChange = (open: boolean) => {
    setState(prev => ({ ...prev, open }))
  }

  useRegisterModal(state.open, () => handleOpenChange(false))

  const content = getHelpContent(locale, state.feature)

  // If no inline content, don't render dialog
  if (!content) return null

  return (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isTabbedHelpPage(content) ? content.title : content.title}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          {isTabbedHelpPage(content) ? (
            <Tabs defaultValue={content.tabs[0].id}>
              <TabsList className="w-full">
                {content.tabs.map(tab => (
                  <TabsTrigger key={tab.id} value={tab.id} className="flex-1">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {content.tabs.map(tab => (
                <TabsContent key={tab.id} value={tab.id}>
                  <HelpPageView page={tab.page} />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <HelpPageView page={content} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
