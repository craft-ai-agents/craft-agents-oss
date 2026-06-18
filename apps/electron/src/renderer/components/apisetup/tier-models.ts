export interface PiModelInfo {
  id: string
  name: string
  costInput: number
  costOutput: number
  contextWindow: number
  reasoning: boolean
}

/** Pick smart defaults for 3 tiers from a cost-sorted model list (expensive-first). */
export function pickTierDefaults(models: PiModelInfo[]): { best: string; default_: string; cheap: string } {
  if (models.length === 0) return { best: '', default_: '', cheap: '' }
  if (models.length === 1) return { best: models[0].id, default_: models[0].id, cheap: models[0].id }
  const best = models[0].id
  const cheap = models[models.length - 1].id
  // ~40% from the top gives a mid-expensive model (list is top-10 + bottom-10)
  const defaultIdx = Math.min(Math.floor(models.length * 0.4), models.length - 2)
  const default_ = models[defaultIdx].id
  return { best, default_, cheap }
}

export function resolveTierModels(models: PiModelInfo[], savedModels?: string[]): { best: string; default_: string; cheap: string } {
  const defaults = pickTierDefaults(models)
  const saved = (savedModels ?? []).filter(Boolean)
  if (saved.length === 0) return defaults

  const valid = new Set(models.map(m => m.id))
  const best = saved[0] && valid.has(saved[0]) ? saved[0] : defaults.best
  const default_ = saved[1] && valid.has(saved[1]) ? saved[1] : defaults.default_
  const cheap = saved[2] && valid.has(saved[2]) ? saved[2] : defaults.cheap

  return { best, default_, cheap }
}
