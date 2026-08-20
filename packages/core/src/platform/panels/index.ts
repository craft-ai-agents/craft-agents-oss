/**
 * PanelRegistry + layout model (S-03). React hosts live in the renderer.
 */

export type { PanelContribution, PanelRenderer, PanelRegistry, PanelSlot } from './types.ts';
export { comparePanelContributions, orderPanels } from './ordering.ts';
export { createPanelRegistry } from './registry.ts';
export type { LayoutProfile, PanelOverride, PanelRegistryState } from './layout-profile.ts';
