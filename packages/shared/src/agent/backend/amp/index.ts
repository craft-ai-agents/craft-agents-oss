/**
 * Amp Backend Module
 *
 * Exports for the Amp CLI agent backend implementation.
 */

// Re-export AmpAgent from its location
export { AmpAgent, AmpBackend, resolveAmpBinary, isAmpInstalled, getAmpVersion } from '../../amp-agent.ts';
export { AmpEventAdapter } from './event-adapter.ts';