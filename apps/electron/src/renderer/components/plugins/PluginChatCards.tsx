import type { PluginCapabilityRef } from '@craft-agent/shared/plugins'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONE_STYLES: Record<string, string> = {
  neutral: 'border-border/60 bg-background/70',
  info: 'border-info/25 bg-info/5',
  success: 'border-emerald-500/25 bg-emerald-500/5',
  warning: 'border-amber-500/25 bg-amber-500/5',
  error: 'border-destructive/25 bg-destructive/5',
}

export function PluginChatCards({ capabilities }: { capabilities: PluginCapabilityRef[] }) {
  if (capabilities.length === 0) return null

  return (
    <div className="mt-3 space-y-2">
      {capabilities.map((capability) => (
        <div
          key={`${capability.pluginId}:${capability.id}`}
          className={cn(
            'rounded-xl border px-3 py-2',
            TONE_STYLES[capability.tone ?? 'neutral'] ?? TONE_STYLES.neutral,
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {capability.title ?? capability.id}
            </span>
            <Badge variant="secondary">{capability.pluginId}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {capability.description ?? `Projected by the host through the ${capability.hook ?? 'chat.cards'} hook.`}
          </p>
        </div>
      ))}
    </div>
  )
}
