import type { LucideIcon } from 'lucide-react'
import { Search, Replace, GitCompareArrows, FileText } from 'lucide-react'

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
    toMessage: (v) =>
      `帮我找一下 ${val(v, 'mpn')}：先查本地库存（自家 + 各级供应商），再查各平台原始分销渠道，给我现货数量、阶梯价、MOQ、供应商和货期，优先原厂 / 授权渠道；查不到也明确告诉我。`,
  },
  {
    id: 'alt',
    label: '找替代料',
    icon: Replace,
    fields: [{ key: 'mpn', label: '型号', type: 'text', placeholder: '如 TPS92550TZX', required: true }],
    toMessage: (v) =>
      `帮我找 ${val(v, 'mpn')} 的替代料：给 pin-to-pin 和功能替代候选，逐项说明关键参数差异（封装 / 电压 / 电流 / 精度 / 温度等）和能否替代的结论，并标注品牌、货源和大致价格。`,
  },
  {
    id: 'compare',
    label: '替代料判断',
    icon: GitCompareArrows,
    fields: [
      { key: 'need', label: '需求型号', type: 'text', required: true },
      { key: 'quote', label: '报价型号', type: 'text', required: true },
    ],
    toMessage: (v) =>
      `需求型号 ${val(v, 'need')}，报价型号 ${val(v, 'quote')}，这俩能不能替代？请逐项对比关键参数（封装 / 电气规格 / 温度范围 / 认证等），指出差异点，给出能否直接替代的明确结论和需要注意的风险。`,
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
