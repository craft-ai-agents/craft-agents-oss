import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FileAttachment } from '../../../../shared/types'
import { TASK_FORMS, isFormComplete, type TaskForm } from './task-forms'

interface TaskBarProps {
  /** 复用现有发送入口:提交即当成普通用户消息发出 */
  onSubmit: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void
}

/**
 * TaskBar — 输入框上方的采购工作流快捷入口。
 *
 * 常驻一排任务按钮;点某按钮在其上方【生成一张表单卡片】(复用权限/凭证卡片观感)。
 * 填好提交 → toMessage() 拼成中文触发消息 → onSubmit() 发出 → 卡片消失。
 * 卡片是输入区控件,不进对话历史。下方自由文本框完全不受影响。
 */
export function TaskBar({ onSubmit }: TaskBarProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})

  const activeForm = React.useMemo<TaskForm | null>(
    () => TASK_FORMS.find((f) => f.id === activeId) ?? null,
    [activeId],
  )

  const openForm = React.useCallback((form: TaskForm) => {
    setActiveId((prev) => {
      if (prev === form.id) return null // 再点同按钮 = 收起
      return form.id
    })
    // 切到该任务:select 字段预选第一项,使必填 select 初始即有效
    const init: Record<string, string> = {}
    for (const field of form.fields) {
      if (field.type === 'select' && field.options?.length) init[field.key] = field.options[0]
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

  const complete = activeForm ? isFormComplete(activeForm, values) : false

  const handleSubmit = React.useCallback(() => {
    if (!activeForm || !isFormComplete(activeForm, values)) return
    try {
      onSubmit(activeForm.toMessage(values))
      closeForm()
    } catch (err) {
      console.error('[TaskBar] submit failed', err)
      closeForm()
    }
  }, [activeForm, values, onSubmit, closeForm])

  return (
    <div className="mb-1.5">
      {/* 生成的表单卡片 —— 浮在按钮排上方,样式对齐主输入框(中性、非 info 色) */}
      {activeForm && (
        <div
          key={activeId}
          className="mb-1.5 rounded-[12px] border border-border/50 bg-background shadow-middle px-3 py-2.5 space-y-2.5"
        >
          {/* 标题行 */}
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

          {/* 字段 */}
          <div className="space-y-1.5">
            {activeForm.fields.map((field, idx) => (
              <label key={field.key} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-14 shrink-0 text-muted-foreground">{field.label}</span>
                {field.type === 'select' ? (
                  <select
                    className="flex-1 h-8 rounded-[8px] border border-border bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                  >
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
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

          {/* 提交 */}
          <div className="flex justify-end">
            <Button size="sm" className="h-7 px-4" disabled={!complete} onClick={handleSubmit}>提交</Button>
          </div>
        </div>
      )}

      {/* 任务按钮排 —— 常驻 */}
      <div className="flex flex-wrap gap-1.5">
        {TASK_FORMS.map((form) => (
          <Button
            key={form.id}
            type="button"
            variant={activeId === form.id ? 'secondary' : 'outline'}
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => openForm(form)}
          >
            <form.icon className="h-3.5 w-3.5" />
            {form.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
