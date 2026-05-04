export const CREATOR_SYSTEM_SKILL_SLUGS = [
  'agent-creator',
  'automation-creator',
  'workflow-creator',
  'source-recipe',
] as const;

export const CONCIERGE_SYSTEM_SKILL_SLUGS = [
  ...CREATOR_SYSTEM_SKILL_SLUGS,
  'runneros-self-edit',
] as const;

export const SYSTEM_GLOBAL_SKILL_SLUGS = [
  ...CONCIERGE_SYSTEM_SKILL_SLUGS,
] as const;

export function isSystemGlobalSkillSlug(slug: string): boolean {
  return (SYSTEM_GLOBAL_SKILL_SLUGS as readonly string[]).includes(slug);
}
