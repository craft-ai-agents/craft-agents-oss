/**
 * Task slug helpers.
 *
 * NOTE: the kanban TaskEditor keeps its own `slugify` copy in
 * `apps/electron/.../kanban/task-spec-form.ts` — the renderer deliberately does
 * not import `@craft-agent/shared/tasks` because this barrel re-exports Node
 * (fs) code from storage.ts. Keep the two implementations byte-identical.
 */

/** Kebab-case a title into a task/node slug (max 48 chars). */
export const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/**
 * First free slug derived from a title: `base`, `base-2`, `base-3`, …
 * Used by agent-driven task creation, which must never overwrite an existing
 * task (unlike the TaskEditor, where re-saving the same slug IS the edit flow).
 */
export function uniqueTaskSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title) || 'task';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 48 - `-${n}`.length)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
