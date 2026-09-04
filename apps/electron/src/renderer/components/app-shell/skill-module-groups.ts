import type { LoadedSkill } from '../../../shared/types'

export const SKILL_MODULE_ORDER = [
  'insight-proposal',
  'form-workbench',
  'design-lab',
  'design-diagnostics',
  'general',
] as const

export type SkillModuleId = typeof SKILL_MODULE_ORDER[number]

const KNOWN_MODULES = new Set<string>(SKILL_MODULE_ORDER)

export function getSkillModuleId(skill: LoadedSkill): SkillModuleId {
  const moduleId = skill.metadata.module
  return moduleId && KNOWN_MODULES.has(moduleId)
    ? moduleId as SkillModuleId
    : 'general'
}

export function groupSkillsByModule(skills: LoadedSkill[]): Array<{
  key: SkillModuleId
  items: LoadedSkill[]
}> {
  const buckets = new Map<SkillModuleId, LoadedSkill[]>()
  for (const skill of skills) {
    const moduleId = getSkillModuleId(skill)
    const bucket = buckets.get(moduleId) ?? []
    bucket.push(skill)
    buckets.set(moduleId, bucket)
  }

  return SKILL_MODULE_ORDER.flatMap(key => {
    const items = buckets.get(key)
    return items?.length ? [{ key, items }] : []
  })
}
