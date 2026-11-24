/**
 * Layout rules for the chat header's label chips (design spec §7.3): whole chips only, at most
 * {@link CHAT_HEADER_MAX_LABELS} (one in Coding mode), then a "+N" counter. Never an overlapping stack.
 */

import { fitLabelCount } from '../fit-labels'

/** The header shows at most this many chips before "+N". */
export const CHAT_HEADER_MAX_LABELS = 3
/** Coding mode keeps the title row for the PR chip: one label chip, then "+N". */
export const CHAT_HEADER_CODING_MAX_LABELS = 1

/** Share of the header's title row the chips may take, and its cap. */
const BUDGET_SHARE = 0.45
const BUDGET_MAX = 360
/** Room kept for the status glyph and a readable title. */
const TITLE_RESERVE = 160

/**
 * Width the label strip may use in a title row of `rowWidth` px. `reserved` is taken by other items
 * in the row (the Coding-mode PR chip) before the share is computed, so they never squeeze the title.
 */
export function labelStripBudget(rowWidth: number, reserved = 0): number {
  const available = Math.max(0, rowWidth - reserved)
  return Math.max(0, Math.min(available * BUDGET_SHARE, BUDGET_MAX, available - TITLE_RESERVE))
}

/**
 * How many leading chips to show: the session row's rule (all of them if they fit, else whole
 * chips plus room for "+N"), capped at `maxLabels`.
 */
export function headerLabelFitCount(
  widths: readonly number[],
  budget: number,
  counterWidth: number,
  gap = 4,
  maxLabels = CHAT_HEADER_MAX_LABELS,
): number {
  if (widths.length <= maxLabels) return fitLabelCount(widths, budget, counterWidth, gap)
  // Past the cap "+N" always shows. An unfittable sentinel after the capped chips makes fitLabelCount
  // reserve the counter even when those chips alone would fit.
  return fitLabelCount([...widths.slice(0, maxLabels), Number.POSITIVE_INFINITY], budget, counterWidth, gap)
}

/**
 * Indexes of the chips to render, in order. `pinned` (a chip whose value editor is open) always
 * shows: when it would be hidden behind "+N" it takes the last visible slot, so its popover has an
 * anchor.
 */
export function visibleLabelIndexes(total: number, fitCount: number, pinned?: number): number[] {
  const count = Math.max(0, Math.min(total, fitCount))
  const shown = Array.from({ length: count }, (_, index) => index)
  if (pinned === undefined || pinned < count || pinned >= total) return shown
  return count === 0 ? [pinned] : [...shown.slice(0, count - 1), pinned]
}
