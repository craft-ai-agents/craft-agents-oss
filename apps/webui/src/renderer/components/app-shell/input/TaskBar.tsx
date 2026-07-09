import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilesPopoverButton } from '../ActiveOptionBadges'
import type { FileAttachment } from '../../../../shared/types'
import {
  WORKFLOW_TASK_FORMS,
  DOC_TASK_FORMS,
  TASK_FORMS,
  isFormComplete,
  resolveFields,
  type TaskForm,
} from './task-forms'

interface TaskBarProps {
  /** 复用现有发送入口:提交即当成普通用户消息发出 */
  onSubmit: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void
  /** 会话信息("信息"按钮)——渲染在按钮排右端,与任务按钮同排对齐 */
  sessionId?: string
  sessionFolderPath?: string
}

/**
 * TaskBar — 输入框上方的采购工作流快捷入口。
 *
 * 上行：找料等主流程。下行：每个单据模板独立按钮。
 * 点按钮 → 表单卡片 → toMessage() → onSubmit()。
 */
export function TaskBar({ onSubmit, sessionId, sessionFolderPath }: TaskBarProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})

  const activeForm = React.useMemo<TaskForm | null>(
    () => TASK_FORMS.find((f) => f.id === activeId) ?? null,
    [activeId],
  )

  const openForm = React.useCallback((form: TaskForm) => {
    setActiveId((prev) => {
      if (prev === form.id) return null
      return form.id
    })
    const init: Record<string, string> = {}
    const fields = form.getFields?.(init) ?? form.fields
    for (const field of fields) {
      if (field.type === 'select' && field.options?.length) {
        init[field.key] = field.options[0]
      }
    }
    setValues(init)
  }, [])

  const closeForm = React.useCallback(() => {
    setActiveId(null)
    setValues({})
  }, [])

  const setField = React.useCallback((key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
  }, [])

  const visibleFields = activeForm ? resolveFields(activeForm, values) : []
  const complete = activeForm ? isFormComplete(activeForm, values) : false

  const handleSubmit = React.useCallback(() => {
    if (!activeForm || !isFormComplete(activeForm, values)) return
    try {
      // 单据按钮强制挂上 skill，避免 agent 漏选 procurement-doc-export
      const skillSlugs =
        activeForm.group === 'doc' ? ['procurement-doc-export'] : undefined
      onSubmit(activeForm.toMessage(values), undefined, skillSlugs)
      closeForm()
    } catch (err) {
      console.error('[TaskBar] submit failed', err)
      closeForm()
    }
  }, [activeForm, values, onSubmit, closeForm])

  const renderButton = (form: TaskForm) => (
    <Button
      key={form.id}
      type="button"
      variant={activeId === form.id ? 'secondary' : 'outline'}
      size="sm"
      className="h-[30px] gap-1.5 px-3 text-[13px] font-medium"
      onClick={() => openForm(form)}
    >
      <form.icon className="h-3.5 w-3.5 shrink-0" />
      {form.label}
    </Button>
  )

  return (
    <div className="mb-1.5">
      {activeForm && (
        <div
          key={activeId}
          className="mb-1.5 rounded-[12px] border border-border/50 bg-background shadow-middle px-3 py-2.5 space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <activeForm.icon className="h-4 w-4 text-foreground/60" />
              <span>{activeForm.label}</span>
            </div>
            <button
              type="button"
              onClick={closeForm}
              aria-label="关闭"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            {visibleFields.map((field, idx) => (
              <label
                key={field.key}
                className={`flex gap-2.5 text-[13px] ${field.type === 'textarea' ? 'items-start' : 'items-center'}`}
              >
                <span
                  className={`w-[5.5rem] shrink-0 text-muted-foreground leading-tight ${field.type === 'textarea' ? 'pt-1.5' : ''}`}
                >
                  {field.label}
                </span>
                {field.type === 'select' ? (
                  <select
                    className="flex-1 h-8 rounded-[8px] border border-border bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                  >
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    className="flex-1 min-h-[64px] max-h-44 rounded-[8px] border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ''}
                    autoFocus={idx === 0}
                    onChange={(e) => setField(field.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                  />
                ) : (
                  <Input
                    className="flex-1 h-8 rounded-[8px] text-[13px]"
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ''}
                    autoFocus={idx === 0}
                    onChange={(e) => setField(field.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                  />
                )}
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <Button size="sm" className="h-7 px-4" disabled={!complete} onClick={handleSubmit}>
              提交
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2">
        <div className="flex flex-1 min-w-0 flex-col gap-1.5">
          {/* 主流程 */}
          <div className="flex flex-wrap gap-1.5">{WORKFLOW_TASK_FORMS.map(renderButton)}</div>
          {/* 单据：每模板一按钮 */}
          <div className="flex flex-wrap gap-1.5">{DOC_TASK_FORMS.map(renderButton)}</div>
        </div>
        {sessionId && (
          <div className="shrink-0 pt-0.5">
            <FilesPopoverButton sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
          </div>
        )}
      </div>
    </div>
  )
}
