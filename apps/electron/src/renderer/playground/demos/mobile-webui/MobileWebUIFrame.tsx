import * as React from 'react'
import { cn } from '@/lib/utils'

export type MobileDevice = 'iphone-15' | 'iphone-se' | 'pixel-8' | 'custom'

export interface MobileWebUIFrameProps {
  /** Preset phone width × height. iPhone 15 is the default. */
  device?: MobileDevice
  /** Override width/height when device='custom'. */
  width?: number
  height?: number
  /** Adds a thin bezel + status-bar strip for visual context. */
  showBezel?: boolean
  className?: string
  children: React.ReactNode
}

const DEVICE_SIZES: Record<Exclude<MobileDevice, 'custom'>, { width: number; height: number; label: string }> = {
  'iphone-15': { width: 390, height: 844, label: 'iPhone 15' },
  'iphone-se': { width: 375, height: 667, label: 'iPhone SE' },
  'pixel-8': { width: 412, height: 915, label: 'Pixel 8' },
}

/**
 * Constrains its child to a phone-shaped viewport. Default 390×844 (iPhone 15).
 *
 * The inner content div names the `shell` and `panel` containers used by
 * AppShell / PanelSlot, so internal compact-mode container queries fire
 * naturally when their layout reads `@container/shell` or `@container/panel`.
 */
export function MobileWebUIFrame({
  device = 'iphone-15',
  width,
  height,
  showBezel = true,
  className,
  children,
}: MobileWebUIFrameProps) {
  const size = device === 'custom'
    ? { width: width ?? 390, height: height ?? 844, label: `${width ?? 390}×${height ?? 844}` }
    : DEVICE_SIZES[device]

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        className={cn(
          'relative bg-background overflow-hidden flex flex-col',
          showBezel
            ? 'rounded-[36px] border-[10px] border-foreground/80 shadow-2xl'
            : 'rounded-lg border border-border',
        )}
        style={{ width: size.width, height: size.height }}
      >
        {showBezel && (
          <div className="h-7 shrink-0 flex items-center justify-center bg-foreground/95 text-background text-[11px] font-medium tabular-nums">
            <span>9:41</span>
          </div>
        )}
        <div
          data-mobile-menu-root="true"
          className="@container/shell @container/panel relative flex-1 min-h-0 overflow-hidden bg-background"
        >
          {children}
        </div>
      </div>
      <span className="text-[11px] font-mono text-muted-foreground">
        {size.label} — {size.width}×{size.height}
      </span>
    </div>
  )
}
