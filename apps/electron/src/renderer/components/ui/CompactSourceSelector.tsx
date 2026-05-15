import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, DatabaseZap, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { SourceAvatar } from '@/components/ui/source-avatar'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import type { LoadedSource } from '../../../shared/types'

export interface CompactSourceSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: LoadedSource[]
  selectedSlugs: string[]
  onToggleSlug: (slug: string) => void
}

/**
 * CompactSourceSelector — bottom-sheet source picker for compact/touch mode.
 *
 * Mirrors the desktop SourceSelectorPopover semantics (multi-select with toggle)
 * but renders inside a Drawer so it doesn't depend on anchor positioning and
 * gives every row a 44+px tap target. The trigger button stays in FreeFormInput;
 * this component is open-state-driven.
 */
export function CompactSourceSelector({
  open,
  onOpenChange,
  sources,
  selectedSlugs,
  onToggleSlug,
}: CompactSourceSelectorProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = React.useState('')

  // Reset filter whenever the drawer closes so the next open starts fresh.
  React.useEffect(() => {
    if (!open) setFilter('')
  }, [open])

  const filteredSources = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sources
    return sources.filter((source) => source.config.name.toLowerCase().includes(q))
  }, [sources, filter])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('chat.sourcesTooltip')}</DrawerTitle>
        </DrawerHeader>

        {sources.length > 0 && (
          <div className="px-4 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40 pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('common.search')}
                className="w-full h-11 pl-10 pr-3 rounded-[10px] bg-foreground/5 text-base outline-none focus:bg-foreground/[0.07] transition-colors"
              />
            </div>
          </div>
        )}

        <div className="px-2 pb-4 flex flex-col gap-0.5 max-h-[55vh] overflow-y-auto">
          {sources.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-foreground/50">
              {t('sourcesList.noSourcesConfigured')}
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-foreground/50">
              {t('chat.noResults')}
            </div>
          ) : (
            filteredSources.map((source) => {
              const isSelected = selectedSlugs.includes(source.config.slug)
              return (
                <button
                  key={source.config.slug}
                  type="button"
                  onClick={() => onToggleSlug(source.config.slug)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-[10px] text-left transition-colors',
                    isSelected ? 'bg-foreground/5' : 'hover:bg-foreground/5',
                  )}
                >
                  <div className="shrink-0 flex items-center">
                    {source.config.slug
                      ? <SourceAvatar source={source} size="md" />
                      : <DatabaseZap className="h-5 w-5 text-foreground/60" />}
                  </div>
                  <div className="flex-1 min-w-0 text-sm font-medium truncate">
                    {source.config.name}
                  </div>
                  <div
                    className={cn(
                      'shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors',
                      isSelected
                        ? 'border-foreground bg-foreground'
                        : 'border-foreground/20',
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
