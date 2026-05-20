/**
 * AdminNavigator
 *
 * Left-panel navigator for the admin section.
 * Shows Permission Management and Feedback items.
 */

import { ShieldCheck, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import type { AdminSubpage } from '../../../shared/types'

interface AdminNavItem {
  id: AdminSubpage
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const ADMIN_ITEMS: AdminNavItem[] = [
  {
    id: 'permission',
    label: '权限管理',
    description: '管理用户权限类型',
    icon: ShieldCheck,
  },
  {
    id: 'feedback',
    label: '评价',
    description: '查看用户评价反馈',
    icon: MessageSquareText,
  },
]

interface AdminItemRowProps {
  item: AdminNavItem
  isSelected: boolean
  isFirst: boolean
  onSelect: () => void
}

function AdminItemRow({ item, isSelected, isFirst, onSelect }: AdminItemRowProps) {
  const Icon = item.icon

  return (
    <div className="admin-item" data-selected={isSelected || undefined}>
      {!isFirst && (
        <div className="pl-12 pr-4">
          <Separator />
        </div>
      )}
      <div className="relative group select-none pl-2 mr-2">
        <div className="absolute left-[20px] top-[14px] z-10">
          <Icon
            className={cn(
              'w-4 h-4 shrink-0',
              isSelected ? 'text-foreground' : 'text-muted-foreground'
            )}
          />
        </div>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]',
            'transition-[background-color] duration-75',
            isSelected
              ? 'bg-foreground/5 hover:bg-foreground/7'
              : 'hover:bg-foreground/2'
          )}
        >
          <div className="w-6 h-5 shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className={cn(
                'font-medium',
                isSelected ? 'text-foreground' : 'text-foreground/80'
              )}
            >
              {item.label}
            </span>
            <span className="text-xs text-foreground/60 line-clamp-1">
              {item.description}
            </span>
          </div>
        </button>
      </div>
    </div>
  )
}

interface AdminNavigatorProps {
  selectedSubpage: AdminSubpage | null
  onSelectSubpage: (subpage: AdminSubpage) => void
}

export default function AdminNavigator({ selectedSubpage, onSelectSubpage }: AdminNavigatorProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="pt-2">
          {ADMIN_ITEMS.map((item, index) => (
            <AdminItemRow
              key={item.id}
              item={item}
              isSelected={selectedSubpage === item.id}
              isFirst={index === 0}
              onSelect={() => onSelectSubpage(item.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
