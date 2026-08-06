/**
 * Shared palette + treatment types for project accent colors.
 *
 * Projects optionally carry a `color` (hex string). Sessions bound to a project
 * are highlighted in the SessionList using this color. The user picks how the
 * highlight is drawn via Settings → Appearance ("Stripe only" / "Stripe + tint").
 */

export const PROJECT_COLOR_PALETTE: readonly string[] = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
  '#a855f7', // purple
  '#64748b', // slate
] as const

export type ProjectColorTreatment = 'stripe' | 'stripe-tint'

export const DEFAULT_PROJECT_COLOR_TREATMENT: ProjectColorTreatment = 'stripe'
