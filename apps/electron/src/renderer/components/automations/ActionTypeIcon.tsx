import { FileCode, MessageSquare, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AutomationAction } from './types'

const ICONS = { prompt: MessageSquare, webhook: Webhook, script: FileCode } as const

export function ActionTypeIcon({ type, className }: { type: AutomationAction['type']; className?: string }) {
  const Icon = ICONS[type]
  return <Icon className={cn('text-tertiary', className)} aria-hidden />
}
