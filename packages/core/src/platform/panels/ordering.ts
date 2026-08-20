/**
 * Panel ordering (S-03 §3.2: order = defaultOrder, step 10 leaves room for
 * extension inserts; §6 open question 1: ties break by id for stability).
 */

import type { PanelContribution } from './types.ts';

export function comparePanelContributions(a: PanelContribution, b: PanelContribution): number {
  const orderA = a.defaultOrder ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.defaultOrder ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function orderPanels(panels: readonly PanelContribution[]): PanelContribution[] {
  return [...panels].sort(comparePanelContributions);
}
