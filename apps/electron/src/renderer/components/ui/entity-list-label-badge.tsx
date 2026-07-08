import { useState } from "react"
import { parseLabelEntry, formatLabelEntry, formatDisplayValue } from "@craft-agent/shared/labels"
import { resolveEntityColor } from "@craft-agent/shared/colors"
import { useTheme } from "@/context/ThemeContext"
import { cn } from "@/lib/utils"
import { openLabelLink } from "@/lib/open-label-link"
import { LabelValuePopover } from "./label-value-popover"
import { LabelValueTypeIcon } from "./label-icon"
import type { LabelConfig } from "@craft-agent/shared/labels"

interface EntityListLabelBadgeProps {
  label: LabelConfig
  rawValue?: string
  sessionLabels: string[]
  onLabelsChange?: (updatedLabels: string[]) => void
}

export function EntityListLabelBadge({ label, rawValue, sessionLabels, onLabelsChange }: EntityListLabelBadgeProps) {
  const [open, setOpen] = useState(false)
  const { isDark } = useTheme()
  const color = label.color ? resolveEntityColor(label.color, isDark) : null
  const displayValue = rawValue ? formatDisplayValue(rawValue, label.valueType) : undefined
  const isLink = label.valueType === 'link' && !!rawValue

  return (
    <LabelValuePopover
      label={label}
      value={rawValue}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(newValue) => {
        const updated = sessionLabels.map(entry => {
          const parsed = parseLabelEntry(entry)
          if (parsed.id === label.id) return formatLabelEntry(label.id, newValue)
          return entry
        })
        onLabelsChange?.(updated)
      }}
      onRemove={() => {
        const updated = sessionLabels.filter(entry => {
          const parsed = parseLabelEntry(entry)
          return parsed.id !== label.id
        })
        onLabelsChange?.(updated)
      }}
    >
      <div
        role="button"
        tabIndex={0}
        title={displayValue ? `${label.name} · ${displayValue}` : label.name}
        className="shrink-0 h-[18px] max-w-[120px] px-1.5 text-[10px] font-medium rounded flex items-center whitespace-nowrap gap-0.5 cursor-pointer overflow-hidden"
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
        style={color ? {
          backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)`,
          color: `color-mix(in srgb, ${color} 75%, var(--foreground))`,
        } : {
          backgroundColor: 'rgba(var(--foreground-rgb), 0.05)',
          color: 'rgba(var(--foreground-rgb), 0.8)',
        }}
      >
        <span className="truncate min-w-0">{label.name}</span>
        {displayValue ? (
          <>
            <span className="shrink-0" style={{ opacity: 0.4 }}>·</span>
            <span
              className={cn('font-normal truncate min-w-0', isLink && 'cursor-pointer hover:underline underline-offset-2')}
              style={{ opacity: isLink ? 0.9 : 0.75 }}
              title={isLink ? rawValue : undefined}
              onClick={isLink ? (e) => { e.stopPropagation(); openLabelLink(rawValue!) } : undefined}
            >{displayValue}</span>
          </>
        ) : (
          label.valueType && (
            <>
              <span className="shrink-0" style={{ opacity: 0.4 }}>·</span>
              <LabelValueTypeIcon valueType={label.valueType} size={10} />
            </>
          )
        )}
      </div>
    </LabelValuePopover>
  )
}
