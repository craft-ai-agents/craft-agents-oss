import * as React from 'react'
import * as Icons from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface MobileMenuPageProps {
  title: string
  /**
   * When true, the leading control is a back chevron that calls `onBack`.
   * When false, no leading control is shown (root page).
   */
  showBack?: boolean
  onBack?: () => void
  /** Trailing close X button. Always available. */
  onClose: () => void
  children: React.ReactNode
  className?: string
}

/**
 * Generic full-screen page shell used for the root menu and every sub-page.
 *
 * Layout: a sticky header (back/title/close) followed by a scrollable body.
 * Padding respects iOS safe areas (`env(safe-area-inset-*)`).
 */
export function MobileMenuPage({
  title,
  showBack,
  onBack,
  onClose,
  children,
  className,
}: MobileMenuPageProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col bg-background',
        className,
      )}
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="shrink-0 h-12 border-b border-border flex items-center px-2">
        <div className="w-10 shrink-0">
          {showBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t('common.back')}
              className="h-10 w-10 flex items-center justify-center rounded-full active:bg-foreground/10"
            >
              <Icons.ChevronLeft className="h-5 w-5 text-foreground/80" strokeWidth={1.75} />
            </button>
          )}
        </div>
        <h2 className="flex-1 text-center text-[15px] font-medium text-foreground truncate px-2">
          {title}
        </h2>
        <div className="w-10 shrink-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="h-10 w-10 flex items-center justify-center rounded-full active:bg-foreground/10"
          >
            <Icons.X className="h-5 w-5 text-foreground/80" strokeWidth={1.75} />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  )
}
