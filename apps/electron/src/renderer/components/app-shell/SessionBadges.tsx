import { useMemo } from "react"
import {
  findTaskItemLabelId,
  findTaskLabel,
  formatDisplayValue,
  parseLabelEntry,
} from "@craft-agent/shared/labels"
import { EntityListLabelBadge } from "@/components/ui/entity-list-label-badge"
import { EntityListBadge } from "@/components/ui/entity-list-badge"
import { useSessionListContext } from "@/context/SessionListContext"
import type { SessionMeta } from "@/atoms/sessions"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { compactSessionLabels } from "./session-badge-density"

interface SessionBadgesProps {
  item: SessionMeta
}

export function SessionBadges({ item }: SessionBadgesProps) {
  const ctx = useSessionListContext()

  const resolvedLabels = useMemo(() => {
    if (!item.labels || item.labels.length === 0 || ctx.flatLabels.length === 0) return []
    const taskRootId = findTaskLabel(ctx.labels)?.id
    const taskItemId = findTaskItemLabelId(item.labels, ctx.labels)
    return item.labels
      .map(entry => {
        const parsed = parseLabelEntry(entry)
        const config = ctx.flatLabels.find(l => l.id === parsed.id)
        if (!config) return null
        // Task scope labels are internal navigation metadata. Showing them as
        // ordinary business tags creates noise and exposes implementation detail.
        if (config.id === taskRootId || config.id === taskItemId) return null
        return { config, rawValue: parsed.rawValue }
      })
      .filter((l): l is { config: LabelConfig; rawValue: string | undefined } => l != null)
  }, [item.labels, ctx.flatLabels, ctx.labels])

  if (resolvedLabels.length === 0) return null

  const { visible, hidden } = compactSessionLabels(resolvedLabels)
  const hiddenTooltip = hidden.map(({ config, rawValue }) => {
    const value = rawValue ? formatDisplayValue(rawValue, config.valueType) : undefined
    return value ? `${config.name} · ${value}` : config.name
  }).join(' • ')

  return (
    <>
      {visible.map(({ config, rawValue }, idx) => (
        <EntityListLabelBadge
          key={`${config.id}-${idx}`}
          label={config}
          rawValue={rawValue}
          sessionLabels={item.labels || []}
          onLabelsChange={(updated) => ctx.onLabelsChange?.(item.id, updated)}
        />
      ))}
      {hidden.length > 0 && (
        <EntityListBadge
          colorClass="bg-foreground/[0.04] text-foreground/45"
          tooltip={hiddenTooltip}
          className="cursor-default tabular-nums"
        >
          +{hidden.length}
        </EntityListBadge>
      )}
    </>
  )
}
