export type ModelEntitlement =
  | { status: 'unmanaged' }
  | { status: 'loading' | 'error' }
  | { status: 'managed'; models: string[] }

/** Fail closed: missing, inactive or malformed ERP policy is never a default model grant. */
export function parseModelEntitlement(value: unknown): ModelEntitlement {
  const p = value as Record<string, unknown> | null
  if (!p || p.configured !== true || p.enforcement !== 'server' || p.active !== true
    || p.schema_version !== 2 || p.execution_mode !== 'server_only'
    || !Array.isArray(p.models) || !p.models.every(m => typeof m === 'string' && m.trim().length > 0)) {
    return { status: 'error' }
  }
  return { status: 'managed', models: [...new Set(p.models as string[])] }
}

export function maySelectModel(policy: ModelEntitlement, model: string): boolean {
  return policy.status === 'unmanaged' || (policy.status === 'managed' && policy.models.includes(model))
}

export function modelEntitlementLabel(policy: ModelEntitlement): string {
  if (policy.status === 'loading') return '正在读取 ERP 模型授权'
  if (policy.status === 'error') return '模型授权不可用，请重试'
  if (policy.status === 'managed' && !policy.models.length) return '暂无模型授权，请联系企业管理员'
  return '请选择已授权模型'
}
