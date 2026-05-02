/**
 * @craft-agent/shared/pulses
 *
 * Type contracts and storage primitives for the Pulse runtime.
 */

export type {
  PulseAction,
  PulseAnsweredQuestion,
  PulseDecisionAction,
  PulseOpenQuestion,
  PulseSilenceState,
  PulseSnapshot,
  PulseSnapshotAutomationItem,
  PulseSnapshotDeps,
  PulseSnapshotGoal,
  PulseSnapshotInputs,
  PulseSnapshotOutputItem,
  PulseSnapshotSessionItem,
  PulseTickDiffSummary,
  PulseTickEntry,
} from './types.ts';

export {
  PULSE_ANTI_SPAM_THRESHOLD,
  PULSE_DECISION_OUTPUT_SCHEMA,
  PULSE_ID_REGEX,
  PULSE_INSTRUCTION_FOOTER,
  PULSE_MIN_INTERVAL_MS,
  PULSE_SILENCE_DURATION_MS,
  PULSE_SNAPSHOT_TOKEN_BUDGET,
} from './types.ts';

export {
  appendPulseTick,
  detectNotifyStreakGoal,
  getPulseDir,
  getPulseTicksFile,
  getPulsesDir,
  getSilencedUntil,
  isValidPulseId,
  pulseIdFromAutomationMatcher,
  readPulseSilence,
  readPulseTicks,
  silenceGoal,
  type ReadPulseTicksOptions,
} from './storage.ts';

export { assemblePulseSnapshot } from './snapshot.ts';
