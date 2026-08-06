/**
 * InlineColorPickerRow — inline color picker for tight UI (e.g. Project settings).
 *
 * Layout:  [dashed indicator] │ [presets...] [🌈]  Clear
 *
 * - The dashed indicator on the left is the always-visible "current value" display.
 *   Its checkmark is drawn in the selected color. Empty when no value is set.
 * - Preset swatches do NOT show a per-swatch selection ring — the indicator handles
 *   "what's picked", so the row has a single source of truth.
 * - The rainbow circle is the custom-color trigger. Clicking it opens the
 *   ColorPicker popover; selection auto-saves live during drag (no submit button).
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { ColorPicker } from '@/components/ui/color-picker'

interface InlineColorPickerRowProps {
  value: string
  onChange: (hex: string) => void
  presets: readonly string[]
  onClear?: () => void
  clearLabel?: string
  customAriaLabel?: string
}

const RAINBOW_GRADIENT =
  'linear-gradient(135deg, #ef4444 0%, #f59e0b 20%, #eab308 40%, #22c55e 60%, #3b82f6 80%, #a855f7 100%)'

function CurrentValueIndicator({ value }: { value: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-5 w-5 shrink-0 text-foreground/40"
      role="img"
      aria-label={value ? `Selected color ${value}` : 'No color selected'}
    >
      <circle
        cx="10"
        cy="10"
        r="9"
        fill={value || 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.5 2"
      />
    </svg>
  )
}

function PresetSwatch({ color, onClick }: { color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-5 w-5 rounded-full ring-1 ring-foreground/10 hover:ring-foreground/40 hover:scale-110 transition-all"
      style={{ backgroundColor: color }}
      aria-label={color}
    />
  )
}

export function InlineColorPickerRow({
  value,
  onChange,
  presets,
  onClear,
  clearLabel,
  customAriaLabel,
}: InlineColorPickerRowProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CurrentValueIndicator value={value} />
      <div className="w-px h-5 bg-foreground/10" aria-hidden="true" />
      {presets.map((swatch) => (
        <PresetSwatch key={swatch} color={swatch} onClick={() => onChange(swatch)} />
      ))}
      <ColorPicker
        value={value}
        onChange={onChange}
        ariaLabel={customAriaLabel}
        trigger={
          <button
            type="button"
            aria-label={customAriaLabel}
            className="h-5 w-5 rounded-full ring-1 ring-foreground/15 hover:ring-foreground/40 hover:scale-110 transition-all cursor-pointer"
            style={{ background: RAINBOW_GRADIENT }}
          />
        }
      />
      {value && onClear && clearLabel && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="text-foreground/60 hover:text-foreground"
        >
          {clearLabel}
        </Button>
      )}
    </div>
  )
}
