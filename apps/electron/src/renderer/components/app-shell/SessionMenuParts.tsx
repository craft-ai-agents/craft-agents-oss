import * as React from 'react'
import { Check } from 'lucide-react'
import type { MenuComponents } from '@/components/ui/menu-context'
import type { SessionStatusId } from '@/config/session-status-config'
import type { SessionStatus } from '@/config/session-status-config'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { LabelIcon } from '@/components/ui/label-icon'

export interface StatusMenuItemsProps {
  sessionStatuses: SessionStatus[]
  activeStateId?: SessionStatusId | null
  onSelect: (stateId: SessionStatusId) => void
  menu: Pick<MenuComponents, 'MenuItem'>
}

export function StatusMenuItems({
  sessionStatuses,
  activeStateId,
  onSelect,
  menu,
}: StatusMenuItemsProps) {
  const { MenuItem } = menu

  return (
    <>
      {sessionStatuses.map((state) => {
        const applyColor = state.iconColorable
        const bareIcon = React.isValidElement(state.icon)
          ? React.cloneElement(state.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : state.icon
        return (
          <MenuItem
            key={state.id}
            onClick={() => onSelect(state.id)}
            className={activeStateId === state.id ? 'bg-foreground/5' : ''}
          >
            <span style={applyColor ? { color: state.resolvedColor } : undefined}>
              {bareIcon}
            </span>
            <span className="flex-1">{state.label}</span>
          </MenuItem>
        )
      })}
    </>
  )
}

export interface LabelMenuItemsProps {
  labels: LabelConfig[]
  appliedLabelIds: Set<string>
  onToggle: (labelId: string) => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent'>
}

/**
 * Count how many labels in a subtree (including the root) are currently applied.
 * Used to show selection counts on parent SubTriggers so users can see
 * where in the tree their selections are.
 */
function countAppliedInSubtree(label: LabelConfig, appliedIds: Set<string>): number {
  let count = appliedIds.has(label.id) ? 1 : 0
  if (label.children) {
    for (const child of label.children) {
      count += countAppliedInSubtree(child, appliedIds)
    }
  }
  return count
}

/**
 * LabelMenuItems - Recursive component for rendering label tree as nested sub-menus.
 *
 * Labels with children render as nested Sub/SubTrigger/SubContent menus (the parent
 * itself appears as the first toggleable item inside its submenu, followed by children).
 * Leaf labels render as simple toggleable menu items with checkmarks.
 * Parent triggers show a count of applied descendants so users can see where selections are.
 */
export function LabelMenuItems({
  labels,
  appliedLabelIds,
  onToggle,
  menu,
}: LabelMenuItemsProps) {
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = menu

  return (
    <>
      {labels.map(label => {
        const hasChildren = label.children && label.children.length > 0
        const isApplied = appliedLabelIds.has(label.id)

        if (hasChildren) {
          const subtreeCount = countAppliedInSubtree(label, appliedLabelIds)

          return (
            <Sub key={label.id}>
              <SubTrigger className="pr-2">
                <LabelIcon label={label} size="sm" hasChildren />
                <span className="flex-1">{label.name}</span>
                {subtreeCount > 0 && (
                  <span className="text-[10px] text-foreground/50 tabular-nums -mr-2.5">
                    {subtreeCount}
                  </span>
                )}
              </SubTrigger>
              <SubContent>
                <MenuItem
                  onSelect={(e: Event) => {
                    e.preventDefault()
                    onToggle(label.id)
                  }}
                >
                  <LabelIcon label={label} size="sm" hasChildren />
                  <span className="flex-1">{label.name}</span>
                  <span className="w-3.5 ml-4">
                    {isApplied && <Check className="h-3.5 w-3.5 text-foreground" />}
                  </span>
                </MenuItem>
                <Separator />
                <LabelMenuItems
                  labels={label.children!}
                  appliedLabelIds={appliedLabelIds}
                  onToggle={onToggle}
                  menu={menu}
                />
              </SubContent>
            </Sub>
          )
        }

        return (
          <MenuItem
            key={label.id}
            onSelect={(e: Event) => {
              e.preventDefault()
              onToggle(label.id)
            }}
          >
            <LabelIcon label={label} size="sm" />
            <span className="flex-1">{label.name}</span>
            <span className="w-3.5 ml-4">
              {isApplied && <Check className="h-3.5 w-3.5 text-foreground" />}
            </span>
          </MenuItem>
        )
      })}
    </>
  )
}
