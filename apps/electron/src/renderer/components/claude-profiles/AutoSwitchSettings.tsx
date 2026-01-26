/**
 * AutoSwitchSettings Component
 *
 * Settings for automatic profile switching thresholds.
 */

import * as React from 'react'
import {
  SettingsCard,
  SettingsToggle,
} from '@/components/settings'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { ClaudeAutoSwitchSettings } from '../../../shared/types'

interface AutoSwitchSettingsProps {
  settings: ClaudeAutoSwitchSettings | null
  isLoading: boolean
  onUpdate: (updates: Partial<ClaudeAutoSwitchSettings>) => void
}

/** Slider component for thresholds */
function ThresholdSlider({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string
  description: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
}) {
  const percentage = Math.round(value * 100)

  return (
    <div className={cn('px-4 py-3.5', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <span className="text-sm font-medium text-foreground">{percentage}%</span>
      </div>
      <input
        type="range"
        min="50"
        max="99"
        value={percentage}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        disabled={disabled}
        className="w-full h-1.5 rounded-full appearance-none bg-foreground/10 cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-accent
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-110
          disabled:cursor-not-allowed
          disabled:[&::-webkit-slider-thumb]:opacity-50"
      />
    </div>
  )
}

export function AutoSwitchSettings({
  settings,
  isLoading,
  onUpdate,
}: AutoSwitchSettingsProps) {
  if (!settings) {
    return null
  }

  const isDisabled = !settings.enabled || isLoading

  return (
    <div className="space-y-3">
      {/* Master toggle */}
      <SettingsCard>
        <SettingsToggle
          label="Enable Auto-Switching"
          description="Automatically switch profiles when usage limits are reached"
          checked={settings.enabled}
          onCheckedChange={(enabled) => onUpdate({ enabled })}
          disabled={isLoading}
        />
      </SettingsCard>

      {/* Proactive switching */}
      <SettingsCard>
        <div className="px-4 py-3.5">
          <h4 className="text-sm font-medium">Proactive Switching</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Switch before hitting hard limits</p>
        </div>

        <div className="border-t border-border/50">
          <ThresholdSlider
            label="5-Hour Threshold"
            description="Switch when hourly usage exceeds this level"
            value={settings.proactiveThresholdSession}
            onChange={(value) => onUpdate({ proactiveThresholdSession: value })}
            disabled={isDisabled}
          />
        </div>

        <div className="border-t border-border/50">
          <ThresholdSlider
            label="7-Day Threshold"
            description="Switch when weekly usage exceeds this level"
            value={settings.proactiveThresholdWeekly}
            onChange={(value) => onUpdate({ proactiveThresholdWeekly: value })}
            disabled={isDisabled}
          />
        </div>
      </SettingsCard>

      {/* Reactive switching */}
      <SettingsCard>
        <SettingsToggle
          label="Reactive Switching"
          description="Automatically switch when rate limited (429 errors)"
          checked={settings.reactiveEnabled}
          onCheckedChange={(reactiveEnabled) => onUpdate({ reactiveEnabled })}
          disabled={isDisabled}
        />
      </SettingsCard>

      {/* Max swaps per session */}
      <SettingsCard>
        <div className={cn('px-4 py-3.5', isDisabled && 'opacity-50')}>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Max Swaps Per Session</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Limit switches per conversation to prevent loops
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdate({ maxSwapsPerSession: Math.max(1, settings.maxSwapsPerSession - 1) })}
                disabled={isDisabled || settings.maxSwapsPerSession <= 1}
                className="w-7 h-7 flex items-center justify-center rounded border border-border text-sm hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                -
              </button>
              <span className="w-8 text-center text-sm font-medium">
                {settings.maxSwapsPerSession}
              </span>
              <button
                type="button"
                onClick={() => onUpdate({ maxSwapsPerSession: Math.min(10, settings.maxSwapsPerSession + 1) })}
                disabled={isDisabled || settings.maxSwapsPerSession >= 10}
                className="w-7 h-7 flex items-center justify-center rounded border border-border text-sm hover:bg-foreground/5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}
