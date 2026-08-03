import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { Spinner } from '@archstudio/ui'

/**
 * SessionSearchHeader - Presentational component for session list search UI.
 *
 * Renders:
 * - Search input with static search icon
 * - Status row showing "Loading…" or "{count} results" when query is active
 *
 * This component is shared between the main app (SessionList) and the playground.
 */

export interface SessionSearchHeaderProps {
  /** Current search query value */
  searchQuery: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed (X button) */
  onSearchClose?: () => void
  /** Called on keydown in the search input */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  /** Called when input gains focus */
  onFocus?: () => void
  /** Called when input loses focus */
  onBlur?: () => void
  /** Whether content search is in progress */
  isSearching?: boolean
  /** Whether the search service is unavailable (e.g. ripgrep not found) */
  isUnavailable?: boolean
  /** Number of results to display (when not searching) */
  resultCount?: number
  /** Whether the result count exceeded the display limit (shows "100+" instead of exact count) */
  exceededLimit?: boolean
  /** Ref for the input element (for focus management) */
  inputRef?: React.RefObject<HTMLInputElement>
  /** Placeholder text */
  placeholder?: string
  /** Whether the input is read-only (for playground demos) */
  readOnly?: boolean
}

export function SessionSearchHeader({
  searchQuery,
  onSearchChange,
  onSearchClose,
  onKeyDown,
  onFocus,
  onBlur,
  isSearching = false,
  isUnavailable = false,
  resultCount,
  exceededLimit = false,
  inputRef,
  placeholder = 'Search titles and content...',
  readOnly = false,
}: SessionSearchHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="shrink-0 px-3 pt-3 pb-2 border-b border-border/45 bg-background/80 backdrop-blur-sm">
      {/* Search input */}
      <div className="relative rounded-[9px] border border-border/55 bg-foreground/[0.022] shadow-minimal transition-[background-color,border-color,box-shadow] has-[:focus-visible]:border-ring/45 has-[:focus-visible]:bg-background has-[:focus-visible]:shadow-sm">
        {/* Search icon - always static, never changes to spinner */}
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/38" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          readOnly={readOnly}
          placeholder={placeholder}
          className="w-full h-8 pl-8 pr-8 text-[12px] bg-transparent border-0 rounded-[9px] outline-none focus-visible:ring-0 focus-visible:outline-none placeholder:text-foreground/35"
        />
        {onSearchClose && (
          <button
            onClick={onSearchClose}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-foreground/[0.07] rounded-[6px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={t("session.closeSearch")}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Search status row - shown when search mode is active (2+ characters) */}
      {searchQuery.length >= 2 && (
        <div className="px-1 pt-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-foreground/42 tabular-nums">
          {isSearching ? (
            <>
              <Spinner className="text-[9px] text-foreground/50" />
              <span>{t('common.loading')}</span>
            </>
          ) : isUnavailable ? (
            <span className="text-destructive/70">{t('session.searchUnavailable')}</span>
          ) : (
            <span>{t('session.results', { count: exceededLimit ? '100+' : (resultCount ?? 0) })}</span>
          )}
        </div>
      )}
    </div>
  )
}
