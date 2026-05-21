import { useMemo } from 'react'
import { AlertCircle, MessageSquareText, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { FeedbackRecord } from '@craft-agent/shared/feedback'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  countFeedbackRatings,
  filterFeedbackRecords,
  finalAssistantMessage,
  firstMessageByRole,
  formatFeedbackTime,
  messageText,
  type FeedbackRatingFilter,
} from './feedback-admin-utils'

function RatingMetric({
  active,
  count,
  filter,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  count: number
  filter: FeedbackRatingFilter
  icon: typeof ThumbsUp
  label: string
  onClick: (filter: FeedbackRatingFilter) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(filter)}
      className={cn(
        'flex min-w-[118px] items-center gap-3 rounded-[8px] border px-4 py-3 text-left transition-colors',
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border bg-background hover:bg-foreground/3'
      )}
    >
      <Icon className={cn('h-4 w-4', active ? 'fill-current' : 'text-foreground/45')} />
      <span className="flex flex-col">
        <strong className="text-lg leading-none">{count}</strong>
        <span className="mt-1 text-xs text-foreground/55">{label}</span>
      </span>
    </button>
  )
}

function TurnSummary({ record }: { record: FeedbackRecord }) {
  const user = firstMessageByRole(record, 'user')
  const final = finalAssistantMessage(record)

  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3">
        <span className="text-foreground/45">用户</span>
        <span className="line-clamp-2 text-foreground/80">{user ? messageText(user) : '-'}</span>
      </div>
      <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3">
        <span className="text-foreground/45">回答</span>
        <span className="line-clamp-2 text-foreground/65">{final ? messageText(final) : '暂无最终回答'}</span>
      </div>
    </div>
  )
}

function FeedbackRow({
  record,
  showComment,
  onOpen,
}: {
  record: FeedbackRecord
  showComment: boolean
  onOpen: (record: FeedbackRecord) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(record)}
      className="grid w-full grid-cols-1 gap-3 border-b border-border/60 px-4 py-4 text-left text-sm transition-colors last:border-b-0 hover:bg-foreground/[0.025] lg:grid-cols-[150px_190px_110px_180px_minmax(280px,1fr)] lg:gap-4"
    >
      <span className="text-foreground/70">
        <span className="mr-2 text-xs text-foreground/40 lg:hidden">时间</span>
        {formatFeedbackTime(record.time)}
      </span>
      <code className="w-fit max-w-full truncate rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
        {record.id || '-'}
      </code>
      <code className="w-fit rounded-md border border-border bg-foreground/5 px-2 py-0.5 text-xs text-foreground/70">
        {record.employee_id || '-'}
      </code>
      <span className="line-clamp-2 text-foreground/70">
        <span className="mr-2 text-xs text-foreground/40 lg:hidden">{showComment ? '用户评价' : '评价状态'}</span>
        {showComment ? (record.comment || '-') : (record.is_like ? '点赞' : '点踩')}
      </span>
      <TurnSummary record={record} />
    </button>
  )
}

export interface FeedbackListPageProps {
  error: string | null
  filter: FeedbackRatingFilter
  loading: boolean
  records: FeedbackRecord[]
  onFilterChange: (filter: FeedbackRatingFilter) => void
  onOpenRecord: (record: FeedbackRecord) => void
  onRefresh: () => void
}

export default function FeedbackListPage({
  error,
  filter,
  loading,
  records,
  onFilterChange,
  onOpenRecord,
  onRefresh,
}: FeedbackListPageProps) {
  const counts = useMemo(() => countFeedbackRatings(records), [records])
  const filteredRecords = useMemo(() => filterFeedbackRecords(records, filter), [records, filter])

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="评价"
        actions={
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={loading} aria-label="刷新评价列表">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        }
      />
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-border bg-card px-5 py-5 shadow-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5 text-foreground/55" />
                <h2 className="text-lg font-semibold">评价回检</h2>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-foreground/55">
                聚合用户点赞和点踩记录，快速回看每一轮对话的输入、回答与执行过程。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <RatingMetric
                active={filter === 'like'}
                count={counts.like}
                filter="like"
                icon={ThumbsUp}
                label="点赞"
                onClick={onFilterChange}
              />
              <RatingMetric
                active={filter === 'dislike'}
                count={counts.dislike}
                filter="dislike"
                icon={ThumbsDown}
                label="点踩"
                onClick={onFilterChange}
              />
            </div>
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-[8px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section className="overflow-hidden rounded-[8px] border border-border bg-card shadow-sm">
            <div className="hidden grid-cols-[150px_190px_110px_180px_minmax(280px,1fr)] gap-4 border-b border-border/70 bg-foreground/[0.025] px-4 py-2.5 text-xs font-medium text-foreground/55 lg:grid">
              <span>时间</span>
              <span>评价 ID</span>
              <span>评价人</span>
              <span>{filter === 'dislike' ? '用户评价' : '评价状态'}</span>
              <span>对话内容</span>
            </div>
            {loading ? (
              <div className="py-16 text-center text-sm text-foreground/40">正在加载评价数据...</div>
            ) : filteredRecords.length === 0 ? (
              <div className="py-16 text-center text-sm text-foreground/40">
                暂无{filter === 'like' ? '点赞' : '点踩'}记录
              </div>
            ) : (
              filteredRecords.map(record => (
                <FeedbackRow
                  key={record.id}
                  record={record}
                  showComment={filter === 'dislike'}
                  onOpen={onOpenRecord}
                />
              ))
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
