/**
 * Plan Mode Types
 *
 * Defines the structure for planning mode, which allows Claude to create
 * and refine plans before execution, ensuring alignment on complex tasks.
 */

import { randomUUID } from 'crypto';

/**
 * The current state of a plan
 */
export type PlanState =
  | 'creating'    // Claude is generating the plan
  | 'refining'    // User is providing feedback, Claude is refining
  | 'ready'       // Plan is approved and ready to execute
  | 'executing'   // Plan is being executed
  | 'completed'   // Plan execution finished
  | 'cancelled';  // User cancelled the plan

/**
 * A single step in a plan
 */
export interface PlanStep {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable description of what this step does */
  description: string;
  /** Current status of this step */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  /** Optional detailed implementation notes */
  details?: string;
  /** Files that will be modified in this step */
  files?: string[];
  /** Estimated complexity (for UI display) */
  complexity?: 'low' | 'medium' | 'high';
}

/**
 * A complete plan for a task
 */
export interface Plan {
  /** Unique identifier */
  id: string;
  /** Short title describing the plan */
  title: string;
  /** Current state of the plan */
  state: PlanState;
  /** Ordered list of steps to execute */
  steps: PlanStep[];
  /** Original user request that triggered this plan */
  context: string;
  /** Current refinement iteration (0 = initial, 1+ = after feedback) */
  refinementRound: number;
  /** Timestamp when plan was created */
  createdAt: number;
  /** Timestamp when plan was last modified */
  updatedAt: number;
  /** History of refinements for reference */
  refinementHistory?: PlanRefinementEntry[];
}

/**
 * A single refinement round entry
 */
export interface PlanRefinementEntry {
  /** Round number */
  round: number;
  /** Questions Claude asked */
  questions: string[];
  /** User's feedback/answers */
  feedback: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Request for user to review and potentially refine a plan
 */
export interface PlanRefinementRequest {
  /** The current plan */
  plan: Plan;
  /** Questions from Claude that need user input */
  questions: string[];
  /** Optional suggestions for improvement */
  suggestions?: string[];
}

/**
 * Events emitted during plan mode
 */
export type PlanEvent =
  | { type: 'plan_creating'; message: string }
  | { type: 'plan_ready'; plan: Plan; questions?: string[] }
  | { type: 'plan_refining'; plan: Plan; feedback: string }
  | { type: 'plan_approved'; plan: Plan }
  | { type: 'plan_cancelled' }
  | { type: 'plan_step_start'; stepId: string; description: string }
  | { type: 'plan_step_complete'; stepId: string }
  | { type: 'plan_complete'; plan: Plan };

/**
 * Options for starting plan mode
 */
export interface PlanModeOptions {
  /** The task to plan for */
  task: string;
  /** Skip refinement and auto-approve (for simple tasks) */
  autoApprove?: boolean;
  /** Maximum refinement rounds before forcing a decision */
  maxRefinementRounds?: number;
}

/**
 * Result of checking if a task should trigger plan mode
 */
export interface PlanSuggestion {
  /** Whether planning is suggested */
  shouldPlan: boolean;
  /** Reason for the suggestion */
  reason?: string;
  /** Complexity assessment */
  complexity?: 'simple' | 'moderate' | 'complex';
}

/**
 * Helper to create a new plan
 */
export function createPlan(title: string, context: string): Plan {
  return {
    id: randomUUID(),
    title,
    state: 'creating',
    steps: [],
    context,
    refinementRound: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Helper to create a plan step
 */
export function createPlanStep(description: string, details?: string): PlanStep {
  return {
    id: randomUUID(),
    description,
    status: 'pending',
    details,
  };
}

/**
 * Helper to update plan state
 */
export function updatePlanState(plan: Plan, state: PlanState): Plan {
  return {
    ...plan,
    state,
    updatedAt: Date.now(),
  };
}

/**
 * Helper to add refinement entry to plan
 */
export function addRefinementEntry(
  plan: Plan,
  questions: string[],
  feedback: string
): Plan {
  const entry: PlanRefinementEntry = {
    round: plan.refinementRound + 1,
    questions,
    feedback,
    timestamp: Date.now(),
  };

  return {
    ...plan,
    refinementRound: plan.refinementRound + 1,
    refinementHistory: [...(plan.refinementHistory || []), entry],
    updatedAt: Date.now(),
  };
}

// NOTE: Plan mode uses Craft-specific tools (not SDK's EnterPlanMode/ExitPlanMode):
// 1. User enters plan mode via SHIFT+TAB or /plan start
// 2. Claude uses CraftAskUserQuestion to clarify requirements
// 3. Claude calls ExitCraftAgentsPlanMode with a structured plan
// 4. User reviews via PlanReview UI (approve/refine/cancel)
// This provides better UX with interactive question/answer and structured plan review.

// ============================================
// Plan Mode UI Messages (single source of truth)
// ============================================

/** Message shown to user when entering plan mode */
export const PLAN_MODE_ENTER_MESSAGE = 'Plan mode active. Describe what you want to accomplish.';

/** Message shown to user when exiting plan mode */
export const PLAN_MODE_EXIT_MESSAGE = 'Exited plan mode.';

/** System prompt sent to Claude when entering plan mode via Shift+Tab */
export const PLAN_MODE_ENTER_PROMPT = 'The user wants to enter planning mode. Call the EnterCraftAgentsPlanMode tool to enter plan mode, then wait for the user to describe their task.';

/** System prompt sent to Claude when exiting plan mode via Shift+Tab */
export const PLAN_MODE_EXIT_PROMPT = 'The user wants to exit planning mode. Ask how can you help.';
