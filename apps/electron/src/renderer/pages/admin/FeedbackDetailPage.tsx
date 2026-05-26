import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { ArrowLeft, Bot, Brain, Clock, User, Wrench, type LucideIcon } from 'lucide-react'
import type {
  FeedbackRecord,
  FeedbackTurnMessage,
} from '@craft-agent/shared/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  buildFeedbackDetailSummary,
  formatFeedbackTime,
  formatMessageValue,
  hasToolMetadata,
  messageText,
} from './feedback-admin-utils'

const elevatedCardClassName =
  'border border-violet-200/70 bg-gradient-to-br from-white via-white to-violet-50/60 shadow-[0_18px_45px_rgba(124,58,237,0.12),0_2px_8px_rgba(15,23,42,0.05)] dark:border-violet-400/20 dark:from-card dark:via-card dark:to-violet-950/20'

function roleLabel(role: string): string {
  if (role === 'user') return '用户'
  if (role === 'assistant') return 'MDP'
  if (role === 'system') return '系统'
  if (role === 'tool') return '工具调用'
  if (role === 'error') return '错误'
  return role || '未知'
}

function messageKindLabel(message: FeedbackTurnMessage): string {
  if (message.role === 'tool') return message.toolStatus ? `${message.toolStatus}` : '状态'
  if (message.role === 'error' || message.isError) return '错误'
  if (message.role === 'assistant' && message.isIntermediate) return '过程消息'
  if (message.role === 'assistant') return '回答'
  return '消息'
}

function toolName(message: FeedbackTurnMessage): string {
  const displayName = message.toolDisplayMeta?.displayName
  return message.toolDisplayName || message.toolName || (typeof displayName === 'string' ? displayName : '')
}

function messageKindClassName(message: FeedbackTurnMessage): string {
  if (message.role !== 'tool') {
    return 'border-border bg-foreground/5 text-foreground/65'
  }

  if (message.toolStatus === 'completed') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (message.toolStatus === 'error') {
    return 'border-destructive/25 bg-destructive/10 text-destructive'
  }

  return 'border-border bg-foreground/5 text-foreground/65'
}

function tagClassForRole(role: string): string {
  if (role === 'user') return 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300'
  if (role === 'assistant' || role === 'system') return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (role === 'tool') return 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
  if (role === 'error') return 'border-destructive/20 bg-destructive/10 text-destructive'
  return 'border-border bg-foreground/5 text-foreground/70'
}

function OverviewCard({
  children,
  icon: Icon,
  title,
}: {
  children: ReactNode
  icon: LucideIcon
  title: string
}) {
  return (
    <section className={cn('min-h-[136px] rounded-[8px] p-4', elevatedCardClassName)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground/55">
        <Icon className="h-4 w-4" />
        <span>{title}</span>
      </div>
      {children}
    </section>
  )
}

function ToolPayload({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  const text = formatMessageValue(value).trim()
  if (!text) return null

  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-foreground/50">{label}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[6px] border border-slate-700/80 bg-[#1F2937] px-3 py-2.5 font-mono text-sm leading-5 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(15,23,42,0.16)]">
        {text}
      </pre>
    </div>
  )
}

function MessageCard({ index, message }: { index: number; message: FeedbackTurnMessage }) {
  const content = messageText(message)
  const displayToolName = toolName(message)

  return (
    <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center">
        <div className="flex aspect-square h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/75 text-sm font-semibold leading-none text-white shadow-[0_8px_18px_rgba(124,58,237,0.18)]">
          {index + 1}
        </div>
        <div className="mt-2 h-full w-px bg-gradient-to-b from-violet-300 via-violet-200 to-transparent dark:from-violet-500/40 dark:via-violet-500/20" />
      </div>
      <article className="mb-4 rounded-[8px] border border-violet-100/80 bg-gradient-to-br from-white via-white to-violet-50/45 p-4 shadow-[0_14px_36px_rgba(124,58,237,0.10),0_1px_4px_rgba(15,23,42,0.04)] dark:border-violet-400/20 dark:from-card dark:via-card dark:to-violet-950/20">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-md border px-2 py-0.5 text-sm font-medium', tagClassForRole(message.role))}>
              {roleLabel(message.role)}
            </span>
            <span className={cn('rounded-md border px-2 py-0.5 text-sm font-medium', messageKindClassName(message))}>
              {messageKindLabel(message)}
            </span>
            {displayToolName && (
              <Badge variant="secondary" className="font-mono">
                {displayToolName}
              </Badge>
            )}
          </div>
          <span className="max-w-[360px] truncate font-mono text-sm text-foreground/35">{message.id}</span>
        </div>

        <div className="space-y-3">
          {content && (
            <p className={cn(
              'whitespace-pre-wrap text-sm leading-6',
              message.role === 'error' ? 'text-destructive' : 'text-foreground/78',
            )}>
              {content}
            </p >
          )}

          {hasToolMetadata(message) && (
            <div className="space-y-3 rounded-[6px] border border-violet-100/80 bg-violet-50/45 p-3 dark:border-violet-400/20 dark:bg-violet-500/5">
              <ToolPayload label="工具意图" value={message.toolIntent} />
              <ToolPayload label="输入参数" value={message.toolInput} />
              <ToolPayload label="执行结果" value={message.toolResult} />
              <ToolPayload label="调用 ID" value={message.toolUseId} />
            </div>
          )}
        </div>
      </article>
    </div>
  )
}

export interface FeedbackDetailPageProps {
  record: FeedbackRecord
  onBack: () => void
}

export default function FeedbackDetailPage({ record, onBack }: FeedbackDetailPageProps) {
  const summary = useMemo(() => buildFeedbackDetailSummary(record), [record])
  const ratingLabel = record.is_like ? '点赞' : '点踩'
  const ratingClassName = record.is_like
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300'

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-violet-50/35 via-background to-background dark:from-violet-950/10">
      <PanelHeader title="评价详情" />
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
          <div>
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              返回评价列表
            </Button>
          </div>

          <section className={cn('rounded-[8px] p-5', elevatedCardClassName)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-foreground/45">
                  <Clock className="h-3.5 w-3.5" />
                  {formatFeedbackTime(record.time)}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <h2 className="text-lg font-semibold">对话回放</h2>
                  <span className={cn('rounded-md border px-2 py-0.5 text-sm font-medium', ratingClassName)}>
                    {ratingLabel}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground/55">
                  <span>评价人</span>
                  <code className="rounded-md border border-violet-200/70 bg-violet-50 px-2 py-0.5 text-sm text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200">
                    {record.employee_id || '-'}
                  </code>
                  <span className="text-foreground/30">/</span>
                  <span>会话</span>
                  <code className="rounded-md border border-violet-200/70 bg-violet-50 px-2 py-0.5 text-sm text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200">
                    {record.session_id || '-'}
                  </code>
                </div>
              </div>

              {!record.is_like && (
                <div className="min-h-[72px] w-full max-w-md rounded-[8px] border border-violet-200/80 bg-violet-50/80 p-3 shadow-inner dark:border-violet-400/20 dark:bg-violet-500/10">
                  <div className="mb-1 text-sm font-medium text-foreground/45">用户评论</div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/75">{record.comment || '-'}</p >
                </div>
              )}
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-3">
            <OverviewCard icon={User} title="用户问题">
              <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
                {summary.userQuestion || '-'}
              </p >
            </OverviewCard>
            <OverviewCard icon={Bot} title="最终回答">
              <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
                {summary.finalAnswer || '暂无最终回答'}
              </p >
            </OverviewCard>
            <OverviewCard icon={Brain} title="过程概览">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="border border-blue-200/80 bg-blue-50 text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200">{summary.displayableCount} 个过程步骤</Badge>
                <Badge variant="secondary" className="border border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">{summary.toolCallCount} 次工具调用</Badge>
              </div>
            </OverviewCard>
          </div>

          <section className={cn('rounded-[8px] p-4', elevatedCardClassName)}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold">详细过程</h3>
              <span className="text-sm text-foreground/45">按接口返回顺序展示</span>
            </div>
            {summary.displayMessages.length === 0 ? (
              <div className="py-12 text-center text-sm text-foreground/40">暂无详细过程</div>
            ) : (
              <div>
                {summary.displayMessages.map((message, index) => (
                  <MessageCard key={message.id || index} message={message} index={index} />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
