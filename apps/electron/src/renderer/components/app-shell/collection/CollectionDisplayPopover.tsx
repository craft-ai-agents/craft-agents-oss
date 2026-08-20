import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, SlidersHorizontal } from 'lucide-react'
import { COLLECTION_GROUP_BY_VALUES,
COLLECTION_ORDER_BY_VALUES,
COLLECTION_PROPERTY_VALUES,
type CollectionDisplay,
type CollectionGroupBy,
type CollectionOrderBy,
type CollectionOrderDir,
type CollectionProperty, } from '@craft-agent/shared/sessions/collection'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export interface CollectionDisplayPopoverProps {
  display: CollectionDisplay
  onDisplayChange: (next: CollectionDisplay) => void
  className?: string
}

const GROUP_I18N: Record<CollectionGroupBy, string> = {
  none: 'collection.display.groupBy.none',
  status: 'collection.display.groupBy.status',
  priority: 'collection.display.groupBy.priority',
  project: 'collection.display.groupBy.project',
  dueDate: 'collection.display.groupBy.dueDate',
  label: 'collection.display.groupBy.label',
}

const ORDER_I18N: Record<CollectionOrderBy, string> = {
  rank: 'collection.display.orderBy.rank',
  priority: 'collection.display.orderBy.priority',
  dueDate: 'collection.display.orderBy.dueDate',
  lastMessageAt: 'collection.display.orderBy.lastMessageAt',
  createdAt: 'collection.display.orderBy.createdAt',
  name: 'collection.display.orderBy.name',
}

const PROPERTY_I18N: Record<CollectionProperty, string> = {
  status: 'collection.display.property.status',
  priority: 'collection.display.property.priority',
  project: 'collection.display.property.project',
  labels: 'collection.display.property.labels',
  dueDate: 'collection.display.property.dueDate',
  model: 'collection.display.property.model',
  updated: 'collection.display.property.updated',
  created: 'collection.display.property.created',
  flag: 'collection.display.property.flag',
}

export function CollectionDisplayPopover({
  display,
  onDisplayChange,
  className,
}: CollectionDisplayPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const patch = React.useCallback(
    (partial: Partial<CollectionDisplay>) => {
      onDisplayChange({
        ...display,
        ...partial,
        version: 1,
        visibleProperties: partial.visibleProperties
          ? [...partial.visibleProperties]
          : [...display.visibleProperties],
      })
    },
    [display, onDisplayChange],
  )

  const toggleProperty = (prop: CollectionProperty) => {
    const set = new Set(display.visibleProperties)
    if (set.has(prop)) set.delete(prop)
    else set.add(prop)
    // Preserve canonical order from COLLECTION_PROPERTY_VALUES
    const next = COLLECTION_PROPERTY_VALUES.filter((p) => set.has(p))
    patch({ visibleProperties: [...next] })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-foreground/[0.02] px-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
            className,
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          {t('collection.display.trigger')}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-3">
        <section className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('collection.display.groupByLabel')}
          </div>
          <div className="flex flex-wrap gap-1">
            {COLLECTION_GROUP_BY_VALUES.map((value) => (
              <ChoiceChip
                key={value}
                active={display.groupBy === value}
                label={t(GROUP_I18N[value])}
                onClick={() => patch({ groupBy: value })}
              />
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('collection.display.orderByLabel')}
          </div>
          <div className="flex flex-wrap gap-1">
            {COLLECTION_ORDER_BY_VALUES.map((value) => (
              <ChoiceChip
                key={value}
                active={display.orderBy === value}
                label={t(ORDER_I18N[value])}
                onClick={() => patch({ orderBy: value })}
              />
            ))}
          </div>
          <div className="flex gap-1 pt-0.5">
            {(['asc', 'desc'] as CollectionOrderDir[]).map((dir) => (
              <ChoiceChip
                key={dir}
                active={display.orderDir === dir}
                label={t(dir === 'asc' ? 'collection.display.orderDir.asc' : 'collection.display.orderDir.desc')}
                onClick={() => patch({ orderDir: dir })}
              />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <ToggleRow
            label={t('collection.display.showCompleted')}
            checked={display.showCompleted}
            onCheckedChange={(checked) => patch({ showCompleted: checked })}
          />
          <ToggleRow
            label={t('collection.display.showEmptyGroups')}
            checked={display.showEmptyGroups}
            onCheckedChange={(checked) => patch({ showEmptyGroups: checked })}
          />
        </section>

        <section className="space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('collection.display.propertiesLabel')}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {COLLECTION_PROPERTY_VALUES.map((prop) => {
              const active = display.visibleProperties.includes(prop)
              return (
                <button
                  key={prop}
                  type="button"
                  onClick={() => toggleProperty(prop)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
                    active
                      ? 'bg-foreground/[0.08] font-medium text-foreground'
                      : 'text-foreground/55 hover:bg-foreground/[0.04] hover:text-foreground/80',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center rounded border',
                      active ? 'border-foreground/40 bg-foreground text-background' : 'border-border',
                    )}
                  >
                    {active ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                  </span>
                  {t(PROPERTY_I18N[prop])}
                </button>
              )
            })}
          </div>
        </section>

        <p className="text-[11px] leading-snug text-muted-foreground">
          {t('collection.display.boardHint')}
        </p>
      </PopoverContent>
    </Popover>
  )
}

function ChoiceChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-xs transition-colors',
        active
          ? 'bg-foreground/[0.1] font-medium text-foreground'
          : 'bg-foreground/[0.03] text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground/80',
      )}
    >
      {label}
    </button>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-foreground/80">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}
