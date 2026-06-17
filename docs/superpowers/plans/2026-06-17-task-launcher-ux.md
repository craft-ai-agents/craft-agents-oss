# 任务启动器(Task Launcher)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chat 输入框上方加一排采购工作流按钮;点按钮生成一张表单卡片,填好提交后按模板拼成一句中文消息走现有 `onSubmit` 发出去,触发对应 skill。

**Architecture:** 纯前端、零服务端/agent/协议改动。新增一个声明式注册表 `task-forms.ts`(任务=数据对象,含字段定义 + `toMessage` 模板)和一个 `TaskBar.tsx` 组件(按钮排 + 生成的表单卡片 + 通用字段渲染器),挂在 `ChatInputZone` 里 `InputContainer` 上方。`FreeFormInput` / `InputContainer` / i18n locale 文件全部不动——任务文案本就是中文(模板必须中文才能触发中文 skill),作为注册表数据,不进 locale 文件。

**Tech Stack:** React + TypeScript,`bun:test`(纯逻辑单测,符合现有 `input/__tests__/` 约定),Tailwind,复用 `@/components/ui/button`、`@/components/ui/input`、lucide 图标。

设计依据:`docs/superpowers/specs/2026-06-17-task-launcher-ux-design.md`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `apps/webui/src/renderer/components/app-shell/input/task-forms.ts`(新) | 类型 `TaskField`/`TaskForm` + 注册表 `TASK_FORMS`(5 任务)+ 纯函数 `isFormComplete`、`getTaskForm`。无 React、无副作用,可纯逻辑单测。 |
| `apps/webui/src/renderer/components/app-shell/input/__tests__/task-forms.test.ts`(新) | `toMessage` 模板拼接 + 触发词命中 + `isFormComplete` 校验的单测。 |
| `apps/webui/src/renderer/components/app-shell/input/TaskBar.tsx`(新) | 按钮排(常驻)+ 选中任务时生成的表单卡片 + 通用字段渲染器;提交调用透传的 `onSubmit`。 |
| `apps/webui/src/renderer/components/app-shell/input/ChatInputZone.tsx`(改) | 在 `InputErrorBoundary`/`InputContainer` 上方渲染 `<TaskBar onSubmit={inputProps.onSubmit} />`。 |

约定确认(已核实):
- `@/*` → `apps/webui/src/renderer/*`(`tsconfig.json`)。
- Button variants 可用:`default` `outline` `secondary` `ghost` `link`。
- `inputProps.onSubmit` 在 `ChatInputZone` 可达且必有(类型链 `ComponentProps<InputContainer>` → `FreeFormInputProps.onSubmit`,签名 `(message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void`)。
- `FileAttachment` 类型从 `input/` 目录引用路径:`'../../../../shared/types'`(与 `FreeFormInput.tsx` 一致)。

---

## Task 1: 任务注册表 + 纯逻辑单测(TDD)

**Files:**
- Create: `apps/webui/src/renderer/components/app-shell/input/task-forms.ts`
- Test: `apps/webui/src/renderer/components/app-shell/input/__tests__/task-forms.test.ts`

- [ ] **Step 1: 先写失败的测试**

Create `apps/webui/src/renderer/components/app-shell/input/__tests__/task-forms.test.ts`:

```ts
import { describe, it, expect } from 'bun:test'
import { TASK_FORMS, isFormComplete, getTaskForm } from '../task-forms'

describe('task-forms registry', () => {
  it('恰好 5 个工作流任务且 id 唯一', () => {
    expect(TASK_FORMS.length).toBe(5)
    const ids = TASK_FORMS.map((f) => f.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('找料 → inventory-first 触发语', () => {
    expect(getTaskForm('find')!.toMessage({ mpn: 'TPS92550TZX' })).toBe('帮我找一下 TPS92550TZX')
  })

  it('找替代料 → alternative-search 触发语', () => {
    expect(getTaskForm('alt')!.toMessage({ mpn: 'TLP350' })).toBe('帮我找 TLP350 的替代料')
  })

  it('能不能替 → 含两个型号 + 替代触发词', () => {
    const msg = getTaskForm('compare')!.toMessage({ need: 'A', quote: 'B' })
    expect(msg).toContain('需求型号 A')
    expect(msg).toContain('报价型号 B')
    expect(msg).toContain('能不能替代')
  })

  it('补供应商 → supplier-shortlist 触发语', () => {
    expect(getTaskForm('supplier')!.toMessage({ brand: 'Omron' })).toBe('帮我按 Omron 补几个供应商候选')
  })

  it('生成单据 → doc-export 触发语', () => {
    expect(getTaskForm('doc')!.toMessage({ source: '飞书订单123', template: '美金请款发票 PI' }))
      .toBe('把 飞书订单123 这单按 美金请款发票 PI 生成请款单（PI）')
  })

  it('toMessage 去空白、缺值不产出 undefined', () => {
    expect(getTaskForm('find')!.toMessage({ mpn: '  X  ' })).toBe('帮我找一下 X')
    expect(getTaskForm('find')!.toMessage({})).not.toContain('undefined')
  })

  it('isFormComplete 要求所有必填字段非空', () => {
    const find = getTaskForm('find')!
    expect(isFormComplete(find, {})).toBe(false)
    expect(isFormComplete(find, { mpn: '  ' })).toBe(false)
    expect(isFormComplete(find, { mpn: 'X' })).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/webui && bun test src/renderer/components/app-shell/input/__tests__/task-forms.test.ts`
Expected: FAIL — `Cannot find module '../task-forms'`(文件还没建)。

- [ ] **Step 3: 写最小实现**

Create `apps/webui/src/renderer/components/app-shell/input/task-forms.ts`:

```ts
import type { LucideIcon } from 'lucide-react'
import { Search, Replace, GitCompareArrows, Users, FileText } from 'lucide-react'

export type TaskFieldType = 'text' | 'select'

export interface TaskField {
  /** 模板取值用的键 */
  key: string
  /** 字段标签,如「型号」 */
  label: string
  type: TaskFieldType
  placeholder?: string
  required?: boolean
  /** select 用的选项 */
  options?: string[]
}

export interface TaskForm {
  /** 稳定 id,如 'find' */
  id: string
  /** 按钮文字,如「找料」 */
  label: string
  icon: LucideIcon
  fields: TaskField[]
  /** 把字段值拼成触发消息;缺值时不产出 undefined */
  toMessage: (v: Record<string, string>) => string
}

/** 取字段值并去首尾空白(缺值返回空串,避免 "undefined") */
function val(v: Record<string, string>, key: string): string {
  return (v[key] ?? '').trim()
}

export const TASK_FORMS: TaskForm[] = [
  {
    id: 'find',
    label: '找料',
    icon: Search,
    fields: [{ key: 'mpn', label: '型号', type: 'text', placeholder: '如 TPS92550TZX', required: true }],
    toMessage: (v) => `帮我找一下 ${val(v, 'mpn')}`,
  },
  {
    id: 'alt',
    label: '找替代料',
    icon: Replace,
    fields: [{ key: 'mpn', label: '型号', type: 'text', placeholder: '如 TPS92550TZX', required: true }],
    toMessage: (v) => `帮我找 ${val(v, 'mpn')} 的替代料`,
  },
  {
    id: 'compare',
    label: '能不能替',
    icon: GitCompareArrows,
    fields: [
      { key: 'need', label: '需求型号', type: 'text', required: true },
      { key: 'quote', label: '报价型号', type: 'text', required: true },
    ],
    toMessage: (v) => `需求型号 ${val(v, 'need')}，报价型号 ${val(v, 'quote')}，这俩能不能替代、有没有区别？`,
  },
  {
    id: 'supplier',
    label: '补供应商',
    icon: Users,
    fields: [{ key: 'brand', label: '品牌/品类', type: 'text', placeholder: '如 Omron', required: true }],
    toMessage: (v) => `帮我按 ${val(v, 'brand')} 补几个供应商候选`,
  },
  {
    id: 'doc',
    label: '生成单据',
    icon: FileText,
    fields: [
      { key: 'source', label: '订单来源', type: 'text', placeholder: '如 飞书订单号/表名', required: true },
      { key: 'template', label: '模板', type: 'select', options: ['美金请款发票 PI'], required: true },
    ],
    toMessage: (v) => `把 ${val(v, 'source')} 这单按 ${val(v, 'template')} 生成请款单（PI）`,
  },
]

export function getTaskForm(id: string): TaskForm | undefined {
  return TASK_FORMS.find((f) => f.id === id)
}

/** 所有必填字段都非空才算完整(用于启用/禁用提交按钮) */
export function isFormComplete(form: TaskForm, values: Record<string, string>): boolean {
  return form.fields.every((f) => !f.required || (values[f.key]?.trim() ?? '') !== '')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/webui && bun test src/renderer/components/app-shell/input/__tests__/task-forms.test.ts`
Expected: PASS — 8 个测试全绿。

- [ ] **Step 5: 提交**

```bash
git add apps/webui/src/renderer/components/app-shell/input/task-forms.ts \
        apps/webui/src/renderer/components/app-shell/input/__tests__/task-forms.test.ts
git commit -m "feat(webui): task-forms registry — 5 procurement workflow tasks + toMessage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: TaskBar 组件(按钮排 + 生成的表单卡片)

**Files:**
- Create: `apps/webui/src/renderer/components/app-shell/input/TaskBar.tsx`

- [ ] **Step 1: 写组件**

Create `apps/webui/src/renderer/components/app-shell/input/TaskBar.tsx`:

```tsx
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
    onSubmit(activeForm.toMessage(values))
    closeForm()
  }, [activeForm, values, onSubmit, closeForm])

  return (
    <div className="mb-1.5">
      {/* 生成的表单卡片 —— 浮在按钮排上方 */}
      {activeForm && (
        <div className="mb-1.5 border border-info/30 rounded-[8px] shadow-middle bg-info/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <activeForm.icon className="h-3.5 w-3.5 text-info" />
              <span>{activeForm.label}</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={closeForm} aria-label="关闭">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="space-y-2">
            {activeForm.fields.map((field, idx) => (
              <label key={field.key} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{field.label}</span>
                {field.type === 'select' ? (
                  <select
                    className="flex-1 rounded-[6px] border border-border bg-background px-2 py-1 text-foreground"
                    value={values[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                  >
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="flex-1 h-7 text-xs"
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
            <Button size="sm" disabled={!complete} onClick={handleSubmit}>提交</Button>
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
```

- [ ] **Step 2: 确认 `Input` 组件路径与 props**

Run: `cd apps/webui && head -20 src/renderer/components/ui/input.tsx`
Expected: 看到 `export ... Input`,接受标准 `<input>` props(`className`/`value`/`onChange`/`onKeyDown`/`placeholder`/`autoFocus`)。若导出名或 props 不符,按实际调整 import 与用法。

- [ ] **Step 3: typecheck 新文件无类型错误**

Run: `cd apps/webui && bun run typecheck 2>&1 | grep -E 'TaskBar|task-forms' || echo 'NO NEW TYPE ERRORS'`
Expected: 打印 `NO NEW TYPE ERRORS`(`bun run typecheck` 跑全量,只关心是否有引用到本任务两个新文件的报错)。

- [ ] **Step 4: 提交**

```bash
git add apps/webui/src/renderer/components/app-shell/input/TaskBar.tsx
git commit -m "feat(webui): TaskBar — workflow buttons + generated form card above input

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 挂载到 ChatInputZone(输入框上方)

**Files:**
- Modify: `apps/webui/src/renderer/components/app-shell/input/ChatInputZone.tsx`

- [ ] **Step 1: 加 import**

在 `ChatInputZone.tsx` 顶部 import 区(紧挨 `import { InputContainer } from './InputContainer'` 之后)加:

```tsx
import { TaskBar } from './TaskBar'
```

- [ ] **Step 2: 在 InputContainer 上方渲染 TaskBar**

在 `ChatInputZone.tsx` 的 return 里,找到 `<InputErrorBoundary>`(包着 `<InputContainer>`)那一段,在它**之前**插入 `<TaskBar>`。改前:

```tsx
      <InputErrorBoundary
        sessionId={sessionId}
        resetKey={inputResetKey}
        onClearDraft={handleClearDraft}
      >
```

改后:

```tsx
      <TaskBar onSubmit={inputProps.onSubmit} />

      <InputErrorBoundary
        sessionId={sessionId}
        resetKey={inputResetKey}
        onClearDraft={handleClearDraft}
      >
```

- [ ] **Step 3: typecheck 通过**

Run: `cd apps/webui && bun run typecheck 2>&1 | grep -E 'ChatInputZone|TaskBar|task-forms' || echo 'NO NEW TYPE ERRORS'`
Expected: `NO NEW TYPE ERRORS`。若报 `inputProps.onSubmit` 类型不符,核对 `inputProps` 类型链确认 `onSubmit` 存在(已核实存在)。

- [ ] **Step 4: 构建确认不破坏打包**

Run: `cd apps/webui && bun run build 2>&1 | tail -5`
Expected: 构建成功(`built in ...`),无报错。

- [ ] **Step 5: 提交**

```bash
git add apps/webui/src/renderer/components/app-shell/input/ChatInputZone.tsx
git commit -m "feat(webui): mount TaskBar above chat input in ChatInputZone

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 人工冒烟验证(本地 dev)

**Files:** 无(纯验证)

- [ ] **Step 1: 起本地 dev 看 UI**

Run: `cd apps/webui && bun run dev`(或项目既有的 webui 启动方式),浏览器打开。
Expected 逐项核对:
1. 输入框上方出现一排按钮:`找料` `找替代料` `能不能替` `补供应商` `生成单据`,各带图标。
2. 点「找料」→ 上方生成卡片,含「型号」输入框 + 「提交」(初始禁用)+「✕」。
3. 型号留空 → 提交禁用;填入 `TPS92550TZX` → 提交变可点。
4. 点「提交」(或型号框里回车)→ 卡片消失,对话区出现用户消息 `帮我找一下 TPS92550TZX`,agent 开始处理。
5. 点「生成单据」→ 卡片含「订单来源」输入 + 「模板」下拉(预选「美金请款发票 PI」)。
6. 点「✕」或再点同按钮 → 卡片收起。点另一按钮 → 卡片换成那个任务。
7. 全程下方自由文本框仍可正常打字发送(未受影响)。

- [ ] **Step 2: 若有问题修复后回到对应 Task;全部通过则结束**

无新增提交则本任务无操作。

---

## Self-Review(已核对 spec)

- **Spec §2 前端拼字符串走 onSubmit、零服务端改动** → Task 1 `toMessage` + Task 3 `onSubmit={inputProps.onSubmit}`,无任何服务端/协议文件。✅
- **Spec §3 声明式注册表、通用渲染器、加任务=加一行** → Task 1 `TASK_FORMS` + Task 2 `fields.map` 通用渲染。✅
- **Spec §4 五个工作流按钮 + 极简字段 + 触发模板** → Task 1 五个对象 + 单测校验触发词。✅
- **Spec §5 卡片浮在输入框上方、不进对话历史、复用结构化卡片观感、按钮常驻、单选开合、文本框零改动** → Task 2 卡片样式 `border-info/30 rounded-[8px] shadow-middle bg-info/5`、`activeId` 单选、按钮排常驻;Task 3 挂在 InputContainer 之上不改 InputContainer。✅
- **Spec §6 只改 TaskBar + ChatInputZone,不改 InputContainer/FreeFormInput/InputMode/locale** → Task 2/3 仅这两文件 + 新注册表;不碰 locale(文案为中文域数据)。✅
- **Spec §7 必填空禁用提交、不产 undefined、隔离不影响文本框** → Task 1 `isFormComplete` + `val()` 去空白;Task 2 `disabled={!complete}`;文本框为独立组件天然隔离。✅
- **Spec §8 toMessage 单测 + 触发命中 + 字段渲染 + 开合** → Task 1 单测覆盖前两项;字段渲染与开合在 Task 4 人工核对(符合本仓「input 组件不做 React 渲染单测」约定)。✅
- **Spec §9 范围:5 按钮、单型号无批量、不做填表入口/富字段** → 计划严格限定此范围,无越界。✅

**Placeholder 扫描:** 无 TBD/TODO/"适当处理";每个改代码步骤都给了完整代码与确切命令。✅
**类型一致性:** `toMessage`/`isFormComplete`/`getTaskForm`/`TaskForm`/`TaskField`/`TASK_FORMS` 在 Task 1 定义,Task 2 按同名引用;`onSubmit` 签名三处一致。✅
