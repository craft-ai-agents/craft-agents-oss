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

function roleLabel(role: string): string {
  if (role === 'user') return '用户'
  if (role === 'assistant') return 'Craft Agent'
  if (role === 'system') return '系统'
  if (role === 'tool') return '工具'
  if (role === 'error') return '错误'
  return role || '未知'
}

function messageKindLabel(message: FeedbackTurnMessage): string {
  if (message.role === 'tool') return message.toolStatus ? `工具调用 · ${message.toolStatus}` : '工具调用'
  if (message.role === 'error' || message.isError) return '错误'
  if (message.role === 'assistant' && message.isIntermediate) return '过程消息'
  if (message.role === 'assistant') return '回答'
  return '消息'
}

function toolName(message: FeedbackTurnMessage): string {
  const displayName = message.toolDisplayMeta?.displayName
  return message.toolDisplayName || message.toolName || (typeof displayName === 'string' ? displayName : '')
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
    <section className="min-h-[136px] rounded-[8px] border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-foreground/55">
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
      <div className="mb-1 text-xs text-foreground/45">{label}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[6px] bg-background px-3 py-2 text-xs leading-5 text-foreground/75">
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
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {index + 1}
        </div>
        <div className="mt-2 h-full w-px bg-border" />
      </div>
      <article className="mb-4 rounded-[8px] border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', tagClassForRole(message.role))}>
              {roleLabel(message.role)}
            </span>
            <span className="rounded-md border border-border bg-foreground/5 px-2 py-0.5 text-xs font-medium text-foreground/65">
              {messageKindLabel(message)}
            </span>
            {displayToolName && (
              <Badge variant="secondary" className="font-mono">
                {displayToolName}
              </Badge>
            )}
          </div>
          <span className="max-w-[360px] truncate font-mono text-xs text-foreground/35">{message.id}</span>
        </div>

        <div className="space-y-3">
          {content && (
            <p className={cn(
              'whitespace-pre-wrap text-sm leading-6',
              message.role === 'error' ? 'text-destructive' : 'text-foreground/78',
            )}>
              {content}
            </p>
          )}

          {hasToolMetadata(message) && (
            <div className="space-y-3 rounded-[6px] border border-border bg-foreground/[0.025] p-3">
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
    ? 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300'
    : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300'

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="评价详情" />
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4">
          <div>
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
              返回评价列表
            </Button>
          </div>

          <section className="rounded-[8px] border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-foreground/45">
                  <Clock className="h-3.5 w-3.5" />
                  {formatFeedbackTime(record.time)}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <h2 className="text-lg font-semibold">对话回放</h2>
                  <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', ratingClassName)}>
                    {ratingLabel}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground/55">
                  <span>评价人</span>
                  <code className="rounded-md border border-border bg-foreground/5 px-2 py-0.5 text-xs text-foreground/70">
                    {record.employee_id || '-'}
                  </code>
                  <span className="text-foreground/30">/</span>
                  <span>会话</span>
                  <code className="rounded-md border border-border bg-foreground/5 px-2 py-0.5 text-xs text-foreground/70">
                    {record.session_id || '-'}
                  </code>
                </div>
              </div>

              {!record.is_like && (
                <div className="w-full max-w-md rounded-[8px] border border-border bg-foreground/[0.025] p-3">
                  <div className="mb-1 text-xs font-medium text-foreground/45">用户评论</div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/75">{record.comment || '-'}</p>
                </div>
              )}
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-3">
            <OverviewCard icon={User} title="用户问题">
              <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
                {summary.userQuestion || '-'}
              </p>
            </OverviewCard>
            <OverviewCard icon={Bot} title="最终回答">
              <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
                {summary.finalAnswer || '暂无最终回答'}
              </p>
            </OverviewCard>
            <OverviewCard icon={Brain} title="过程概览">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{summary.displayableCount} 个过程步骤</Badge>
                <Badge variant="secondary"><Wrench className="mr-1 h-3 w-3" />{summary.toolCallCount} 次工具调用</Badge>
                <Badge variant="secondary"><Brain className="mr-1 h-3 w-3" />{summary.reasoningCount} 次过程消息</Badge>
              </div>
            </OverviewCard>
          </div>

          <section className="rounded-[8px] border border-border bg-background p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold">详细过程</h3>
              <span className="text-xs text-foreground/45">按接口返回顺序展示</span>
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
