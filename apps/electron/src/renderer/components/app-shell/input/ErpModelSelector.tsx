import { maySelectModel, modelEntitlementLabel, type ModelEntitlement } from '@/lib/model-entitlement'

export function ErpModelSelector({ policy, currentModel, onModelChange }: {
  policy: ModelEntitlement
  currentModel: string
  onModelChange: (model: string) => void
}) {
  const models = policy.status === 'managed' ? policy.models : []
  const label = modelEntitlementLabel(policy)
  return <select aria-label="ERP 授权模型" title={label}
    className="h-8 max-w-[min(260px,45vw)] min-w-0 rounded-md border border-foreground/10 bg-background px-2 text-xs disabled:text-muted-foreground"
    disabled={!models.length}
    value={maySelectModel(policy, currentModel) ? currentModel : ''}
    onChange={event => { if (maySelectModel(policy, event.target.value)) onModelChange(event.target.value) }}>
    <option value="" disabled>{label}</option>
    {models.map(model => <option key={model} value={model}>{model}</option>)}
  </select>
}
