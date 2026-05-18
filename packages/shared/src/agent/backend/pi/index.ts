/**
 * Pi Agent Module
 *
 * Exports the PiAgent subprocess client and related adapters/constants.
 * The PiAgent communicates with a pi-agent-server subprocess via JSONL.
 *
 * Note: The main PiAgent class is at ../pi-agent.ts. This index re-exports
 * it alongside the event adapter / constants for convenience.
 */

export { PiAgent } from '../../pi-agent.ts';
export { PiEventAdapter } from './event-adapter.ts';
export { PI_TOOL_NAME_MAP, THINKING_TO_PI } from './constants.ts';
