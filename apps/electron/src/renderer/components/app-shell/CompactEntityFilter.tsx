import type { ReactNode } from 'react'
import { CalendarDays, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { RecencyDays } from './session-recency'

interface CompactEntityFilterProps {
  keyword: string
  onKeywordChange: (value: string) => void
  recencyDays?: RecencyDays
  onRecencyDaysChange?: (value: RecencyDays) => void
  additionalActive?: boolean
  children?: ReactNode
  className?: string
}

export function CompactEntityFilter({
  keyword,
  onKeywordChange,
  recencyDays,
  onRecencyDaysChange,
  additionalActive = false,
  children,
  className,
}: CompactEntityFilterProps) {
  const { t } = useTranslation()
  const hasDateFilter = Boolean(onRecencyDaysChange)
  const isActive = Boolean(keyword.trim()) || (hasDateFilter && recencyDays !== null) || additionalActive

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 hover:bg-foreground/[0.05] hover:text-foreground',
            isActive && 'bg-accent/5 text-accent',
            className,
          )}
          aria-label={t('filters.title')}
          title={t('filters.title')}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" onKeyDown={event => event.stopPropagation()}>
        <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-background px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-foreground/35" />
          <input
            value={keyword}
            onChange={event => onKeywordChange(event.target.value)}
            placeholder={t('filters.keywordPlaceholder')}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/30"
          />
          {keyword && (
            <button type="button" onClick={() => onKeywordChange('')} className="rounded p-0.5 text-foreground/35 hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {hasDateFilter && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground/45">
              <CalendarDays className="h-3.5 w-3.5" />{t('filters.date')}
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-foreground/[0.025] p-1">
              {([7, 30, null] as RecencyDays[]).map(value => (
                <button
                  key={value ?? 'all'}
                  type="button"
                  onClick={() => onRecencyDaysChange?.(value)}
                  className={cn(
                    'h-7 rounded-md px-1 text-[11px] text-foreground/50 hover:bg-background hover:text-foreground',
                    recencyDays === value && 'bg-background font-medium text-foreground shadow-minimal',
                  )}
                >
                  {value === null ? t('filters.allTime') : t('filters.days', { count: value })}
                </button>
              ))}
            </div>
          </div>
        )}

        {children && (
          <div className="mt-3 flex items-center gap-1 border-t border-foreground/[0.06] pt-3">
            {children}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
