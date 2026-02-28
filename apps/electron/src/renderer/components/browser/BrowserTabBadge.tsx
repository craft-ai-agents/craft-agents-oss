/**
 * BrowserTabBadge
 *
 * Compact badge used in the top bar browser strip.
 * Render-only surface that acts as a dropdown trigger in BrowserTabStrip.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import * as Icons from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import type { BrowserInstanceInfo } from '../../../shared/types'
import { getHostname, getThemeLuminance } from './utils'

interface BrowserTabBadgeProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  instance: BrowserInstanceInfo
  isActive: boolean
}

export const BrowserTabBadge = forwardRef<HTMLButtonElement, BrowserTabBadgeProps>(function BrowserTabBadge(
  { instance, isActive: _isActive, className, style, ...buttonProps },
  ref
) {
  const hostname = getHostname(instance.url)
  const themedBackground = instance.themeColor || undefined

  const themeLuminance = instance.themeColor ? getThemeLuminance(instance.themeColor) : null
  const isDarkThemeColor = themeLuminance !== null && themeLuminance < 0.42

  const foregroundClass = instance.themeColor
    ? (isDarkThemeColor
      ? 'text-white/90 hover:bg-white/10'
      : 'text-foreground/90 hover:bg-black/5')
    : 'text-foreground/60 hover:bg-foreground/[0.03] hover:text-foreground/85'

  return (
    <button
      ref={ref}
      type="button"
      className={`
        group flex items-center gap-1 h-[26px] pl-2.5 pr-1.5 rounded-lg cursor-pointer select-none
        text-[11px] leading-tight transition-colors max-w-[160px] shadow-minimal
        bg-background
        ${foregroundClass}
        ${instance.agentControlActive ? 'border border-accent' : ''}
        ${instance.isVisible ? '' : 'opacity-70'}
        ${className ?? ''}
      `}
      style={{
        backgroundColor: themedBackground,
        transition: 'background-color 200ms ease, border-color 200ms ease',
        ...style,
      }}
      aria-label={`${instance.title || hostname} actions`}
      {...buttonProps}
    >
      <span className="shrink-0 h-3 w-3 flex items-center justify-center">
        {instance.isLoading ? (
          <Spinner className="text-[9px] leading-none" />
        ) : instance.favicon ? (
          <img src={instance.favicon} alt="" className="h-3 w-3 rounded-sm block" />
        ) : (
          <Icons.Globe className="h-3 w-3" />
        )}
      </span>

      <span className="truncate ml-0.5 leading-[12px]">{hostname}</span>

      <span className="shrink-0 h-3 w-3 flex items-center justify-center opacity-55 group-hover:opacity-90 transition-opacity">
        <Icons.ChevronDown className="h-2.5 w-2.5" />
      </span>
    </button>
  )
})

BrowserTabBadge.displayName = 'BrowserTabBadge'
