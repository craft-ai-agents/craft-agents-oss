/**
 * Command Registry (S-04 §3.5). Execution routing is host-side.
 */

export type { CommandContext, CommandContribution, CommandQuery, CommandRegistry } from './types.ts';
export { createCommandRegistry } from './registry.ts';
