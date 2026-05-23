import * as React from 'react'
import { Box, FileText, Image, Link2, ReceiptText, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EntityRow } from '@/components/ui/entity-row'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { OutputKind, OutputSummaryDTO } from '@/hooks/useOutputs'

type TFn = (key: string, options?: Record<string, unknown>) => string

interface Props {
  outputs: OutputSummaryDTO[]
  loading: boolean
  error: string | null
  selectedOutputId?: string | null
  onOutputClick: (outputId: string) => void
}

export function OutputsListPanel({
  outputs,
  loading,
  error,
  selectedOutputId,
  onOutputClick,
}: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return outputs
    return outputs.filter((output) => {
      const haystack = [
        output.title,
        output.summary,
        output.kind,
        output.status,
        output.origin?.workflowName,
        output.origin?.agentName,
        output.origin?.source,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [outputs, query])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2 border-b border-border/30">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('outputsList.searchPlaceholder')}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('outputsList.loading')}</div>
        ) : error ? (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center px-5 text-center text-sm text-muted-foreground">
            {query ? t('outputsList.emptySearch') : t('outputsList.empty')}
          </div>
        ) : (
          filtered.map((output, index) => (
            <EntityRow
              key={output.id}
              icon={<OutputKindIcon kind={output.kind} />}
              title={output.title}
              subtitle={output.summary || producerLabel(output, t)}
              badges={
                <div className="flex min-w-0 items-center gap-1.5">
                  <StatusPill status={output.status} />
                  <span className="truncate text-muted-foreground">
                    {formatKind(output.kind)} · {producerLabel(output, t)}
                  </span>
                </div>
              }
              titleTrailing={<span className="text-[11px] text-muted-foreground">{formatRelativeTime(output.createdAt, t)}</span>}
              isSelected={selectedOutputId === output.id}
              onClick={() => onOutputClick(output.id)}
              showSeparator={index > 0}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium capitalize',
        status === 'published' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        status === 'draft' && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        status === 'failed' && 'bg-destructive/10 text-destructive',
        status === 'cancelled' && 'bg-foreground/10 text-muted-foreground',
      )}
    >
      {status}
    </span>
  )
}

function OutputKindIcon({ kind }: { kind: OutputKind }) {
  const className = 'h-3.5 w-3.5 text-muted-foreground'
  if (kind === 'image' || kind === 'video' || kind === 'audio') return <Image className={className} />
  if (kind === 'model') return <Box className={className} />
  if (kind === 'receipt' || kind === 'external-action') return <ReceiptText className={className} />
  if (kind === 'other' || kind === 'collection') return <Link2 className={className} />
  return <FileText className={className} />
}

function formatKind(kind: string): string {
  return kind.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function producerLabel(output: OutputSummaryDTO, t: TFn): string {
  const origin = output.origin
  if (!origin) return t('outputsList.producerManual')
  if (origin.workflowName) return origin.workflowName
  if (origin.agentName) return origin.agentName
  if (origin.workflowSlug) return origin.workflowSlug
  if (origin.agentSlug) return origin.agentSlug
  return formatKind(origin.source)
}

function formatRelativeTime(value: string | undefined, t: TFn): string {
  if (!value) return ''
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  const diff = Date.now() - ms
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return t('common.justNow')
  if (minutes < 60) return t('time.compact.minutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.compact.hours', { count: hours })
  const days = Math.round(hours / 24)
  if (days < 7) return t('time.compact.days', { count: days })
  return new Date(ms).toLocaleDateString()
}
