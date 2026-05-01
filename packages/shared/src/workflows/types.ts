/**
 * Workflows — types
 *
 * A "Workflow" is a saved, reusable pipeline: a sequence of agent invocations
 * triggered manually (Phase 1) or automatically (later phases). The pipeline
 * is declared in WORKFLOW.md frontmatter; the body is free-form notes.
 *
 * Workflows live in a single GLOBAL library (`~/.workflows/<slug>/`) and are
 * activated per-workspace via an activation manifest — same shape as agent
 * definitions. A great workflow is reusable everywhere; per-workspace storage
 * would force re-creation.
 *
 * Phase 1 includes a `manual` trigger and the minimal step shape
 * (`id`, `agent`, `input`). Phase 2 adds pragmatic reliability fields:
 * `outputSchema`, `timeout`, and `retries`. Later fields (`when`,
 * `humanCheckpoint`, `parallelGroup`) ship in later phases — keep this file in
 * sync with `docs/workflows/01-spec.md`.
 */

import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';

/** Where a workflow definition was loaded from. Phase 1: only `global`. */
export type WorkflowDefinitionSource = 'global';

/**
 * Trigger kind. Phase 1 supports only `manual`; the union is left open
 * so adding `schedule` / `automation` / `webhook` in Phase 4 is purely
 * additive.
 */
export type WorkflowTriggerType = 'manual';

/**
 * Declaration of a single input on a manual trigger. Drives the run-input
 * form in the UI and validates templating references at parse time.
 */
export interface WorkflowTriggerInput {
  /** Field name. Referenced as `{{trigger.<name>}}` in step inputs. */
  name: string;
  type: 'string' | 'number' | 'boolean';
  /** Defaults to false when omitted. */
  required?: boolean;
  /** Default value for the form. Untyped here — UI coerces to `type`. */
  default?: unknown;
  /** Optional one-line description shown next to the field. */
  description?: string;
}

export interface WorkflowTrigger {
  type: 'manual';
  /** Optional input schema for the run form. */
  inputs?: WorkflowTriggerInput[];
}

export type JsonSchema = Record<string, unknown>;

/**
 * One step in the pipeline. Later phase fields are only added here once the
 * runner actually honors them.
 */
export interface WorkflowStep {
  /** Unique slug within this workflow; referenced as `{{steps.<id>.output}}`. */
  id: string;
  /** Agent slug to run. Existence is checked at run time, not parse time. */
  agent: string;
  /** User-message template for the step's session. Supports `{{...}}`. */
  input: string;
  /** Optional human-readable note describing the step. UI hint only. */
  description?: string;
  /** JSON Schema for the final assistant reply. When set, output is parsed JSON. */
  outputSchema?: JsonSchema;
  /** Per-step timeout in seconds. Omitted means no runner-enforced timeout. */
  timeout?: number;
  /** Number of retries after a failed attempt. Defaults to 0. */
  retries?: number;
}

export interface WorkflowMetadata {
  name: string;
  description: string;
  /** Single emoji shown in pickers. */
  avatar?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}

export type WorkflowParseWarningCode =
  | 'invalid-trigger'
  | 'invalid-trigger-inputs'
  | 'invalid-avatar'
  | 'invalid-step-description'
  | 'invalid-step-output-schema'
  | 'invalid-step-timeout'
  | 'invalid-step-retries';

export interface WorkflowParseWarning {
  field: keyof WorkflowMetadata | 'step';
  code: WorkflowParseWarningCode;
  message: string;
}

export interface LoadedWorkflow {
  /** Filesystem slug — also the @-mention identifier. */
  slug: string;
  metadata: WorkflowMetadata;
  /** Markdown body (everything below the frontmatter, trimmed). */
  body: string;
  /** Absolute path to the workflow's directory. */
  path: string;
  /** Where this workflow was loaded from. */
  source: WorkflowDefinitionSource;
  parseWarnings?: WorkflowParseWarning[];
}

/** Same slug shape as agents/skills — keeps @-mentions uniform. */
export const WORKFLOW_SLUG_REGEX = AGENT_SLUG_REGEX;

/** Filename used inside each workflow's directory. */
export const WORKFLOW_FILE = 'WORKFLOW.md';

/**
 * Per-workspace activation manifest. Workflows live globally; each workspace
 * activates a subset. Mirrors `ActivatedAgentsManifest` exactly.
 */
export interface ActivatedWorkflowsManifest {
  version: 1;
  active: string[];
  updatedAt: string;
}
