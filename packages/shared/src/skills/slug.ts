/**
 * Derive the directory slug used for a skill from its display name.
 */
export function deriveSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
