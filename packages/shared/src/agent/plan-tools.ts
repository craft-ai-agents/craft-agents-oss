/**
 * Craft Agents Plan Mode Tools
 *
 * Custom in-process MCP tools for planning complex Craft Agent workflows.
 * These tools allow read-only MCP/API operations during planning while
 * blocking write operations until the plan is approved.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Plan } from '../agents/plan-types.ts';
import { existsSync, readFileSync } from 'fs';
import {
  loadPlanFromPath,
  formatPlanAsMarkdown,
  getPlansDir,
} from '../config/storage.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Plan Mode State Management
// ============================================================

/**
 * State shared between plan tools and CraftAgent
 */
export interface CraftPlanModeState {
  /** Whether plan mode is currently active */
  isActive: boolean;
  /** Whether plan mode was initiated by user (SHIFT+TAB or /plan) vs LLM */
  userInitiatedPlanMode: boolean;
  /** Who exited plan mode - used to determine if we should notify the agent */
  exitedBy: 'user' | 'agent' | null;
  /** Session ID for plan storage (set by CraftAgent) */
  sessionId: string | null;
  /** The current plan (set when SubmitPlan is called) */
  plan: Plan | null;
  /** Path to the plan file on disk */
  planFilePath: string | null;
  /** Task description */
  taskDescription: string | null;
  /** Callback when state changes (set by CraftAgent) */
  onStateChange?: (state: CraftPlanModeState) => void;
  /** Callback when a plan is submitted (set by CraftAgent) - triggers plan message display */
  onPlanSubmitted?: (planPath: string) => void;
  /** Callback when plan mode is entered by the LLM (set by CraftAgent) - triggers enter message display */
  onPlanModeEntered?: () => void;
  /** Callback when plan mode is exited by the LLM (set by CraftAgent) - triggers exit message display */
  onPlanModeExited?: () => void;
}

/**
 * Manager for per-session plan mode state.
 * Each session has its own state - NO GLOBAL STATE.
 */
class PlanModeManager {
  private states: Map<string, CraftPlanModeState> = new Map();

  /**
   * Get or create state for a session
   */
  getState(sessionId: string): CraftPlanModeState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        isActive: false,
        userInitiatedPlanMode: false,
        exitedBy: null,
        sessionId,
        plan: null,
        planFilePath: null,
        taskDescription: null,
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /**
   * Set state for a session (merges with existing state)
   */
  setState(sessionId: string, updates: Partial<CraftPlanModeState>): void {
    const existing = this.getState(sessionId);
    const newState = { ...existing, ...updates, sessionId };
    this.states.set(sessionId, newState);
  }

  /**
   * Clean up a session's state
   */
  cleanupSession(sessionId: string): void {
    this.states.delete(sessionId);
  }
}

// Singleton manager instance
export const planModeManager = new PlanModeManager();

// ============================================================
// Agent Callback Registry
// ============================================================

/**
 * Callbacks that can be registered by CraftAgent instances.
 * These are looked up by session ID when plan tools execute.
 */
export interface AgentCallbacks {
  onPlanSubmitted?: (planPath: string) => void;
  onPlanModeEntered?: () => void;
  onPlanModeExited?: () => void;
  onStateChange?: (state: CraftPlanModeState) => void;
}

/**
 * Registry mapping session IDs to agent callbacks.
 * This allows plan tools to call agent callbacks directly,
 * avoiding stale closure issues.
 */
const agentCallbackRegistry = new Map<string, AgentCallbacks>();

/**
 * Register callbacks for a session's agent.
 * Called by CraftAgent when processing messages.
 */
export function registerAgentCallbacks(sessionId: string, callbacks: AgentCallbacks): void {
  agentCallbackRegistry.set(sessionId, callbacks);
  debug(`[AgentRegistry] Registered callbacks for session ${sessionId}`);
}

/**
 * Unregister callbacks for a session.
 * Called by CraftAgent on dispose.
 */
export function unregisterAgentCallbacks(sessionId: string): void {
  agentCallbackRegistry.delete(sessionId);
  debug(`[AgentRegistry] Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session.
 * Returns undefined if no agent is registered for this session.
 */
export function getAgentCallbacks(sessionId: string): AgentCallbacks | undefined {
  return agentCallbackRegistry.get(sessionId);
}

/**
 * Set the plan mode state for a session (called by CraftAgent on init)
 */
export function setPlanModeState(state: CraftPlanModeState): void {
  if (state.sessionId) {
    planModeManager.setState(state.sessionId, state);
  }
}

/**
 * Get plan mode state for a specific session.
 * This is the ONLY way to get state - no global fallbacks.
 */
export function getPlanModeStateForSession(sessionId: string): CraftPlanModeState {
  return planModeManager.getState(sessionId);
}

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(sessionId: string): string {
  return getPlansDir(sessionId);
}

/**
 * Enter Craft Agents plan mode programmatically (called by TUI for SHIFT+TAB)
 * @param sessionId - Session ID to target. REQUIRED to prevent cross-session contamination.
 */
export function enterCraftPlanMode(sessionId: string): void {
  debug(`[enterCraftPlanMode] Setting userInitiatedPlanMode=true for session ${sessionId}`);

  const existingState = planModeManager.getState(sessionId);
  planModeManager.setState(sessionId, {
    isActive: true,
    userInitiatedPlanMode: true,
    exitedBy: null,  // Reset exit state when entering plan mode
    plan: null,
    planFilePath: null,
    taskDescription: null,
  });
  // Call the session's onStateChange callback if it exists
  const updatedState = planModeManager.getState(sessionId);
  existingState.onStateChange?.(updatedState);

  debug(`[enterCraftPlanMode] State after: userInitiatedPlanMode=true for session ${sessionId}`);
}

/**
 * Exit Craft Agents plan mode programmatically (called by TUI for SHIFT+TAB)
 * @param sessionId - Session ID to target. REQUIRED to prevent cross-session contamination.
 */
export function exitCraftPlanMode(sessionId: string): void {
  debug(`[exitCraftPlanMode] Exiting plan mode for session ${sessionId} (user-initiated)`);

  const existingState = planModeManager.getState(sessionId);
  planModeManager.setState(sessionId, {
    isActive: false,
    userInitiatedPlanMode: false,
    exitedBy: 'user',  // Mark as user-exited so agent gets notified
    plan: null,
    taskDescription: null,
  });
  // Call the session's onStateChange callback if it exists
  const updatedState = planModeManager.getState(sessionId);
  existingState.onStateChange?.(updatedState);
}

/**
 * Get the plan file path for a session (for reference after exit)
 * @param sessionId - Session ID. REQUIRED to prevent cross-session contamination.
 */
export function getPlanFilePath(sessionId: string): string | null {
  const state = getPlanModeStateForSession(sessionId);
  return state.planFilePath;
}

// ============================================================
// SubmitPlan Tool Factory
// ============================================================

/**
 * Create a session-scoped SubmitPlan tool.
 * The sessionId is captured at creation time, ensuring no cross-session contamination.
 */
export function createSubmitPlanTool(sessionId: string) {
  return tool(
    'SubmitPlan',
    `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special plan message format.

**IMPORTANT:** After calling this tool, do NOT add any commentary. Just stop.
The user will respond with approval, feedback, or cancellation.`,
    {
      planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
    },
    async (args) => {
      // sessionId is captured from the factory closure - NOT from global state
      const state = getPlanModeStateForSession(sessionId);

      debug('[SubmitPlan] Called with planPath:', args.planPath);
      debug('[SubmitPlan] sessionId (from closure):', sessionId);
      debug('[SubmitPlan] state.isActive:', state.isActive);

      // Verify the file exists
      if (!existsSync(args.planPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Plan file not found at ${args.planPath}. Please write the plan file first using the Write tool.`,
          }],
        };
      }

      // Read the plan content to verify it's valid
      let planContent: string;
      try {
        planContent = readFileSync(args.planPath, 'utf-8');
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading plan file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }

      // Update state with the plan file path
      planModeManager.setState(sessionId, {
        planFilePath: args.planPath,
      });
      const updatedState = planModeManager.getState(sessionId);

      // Use registry callbacks for this specific session
      const callbacks = getAgentCallbacks(sessionId);
      debug('[SubmitPlan] Registry callbacks found:', !!callbacks);
      callbacks?.onStateChange?.(updatedState);

      // Notify UI to display the plan message
      debug('[SubmitPlan] Calling onPlanSubmitted callback...');
      if (callbacks?.onPlanSubmitted) {
        callbacks.onPlanSubmitted(args.planPath);
        debug('[SubmitPlan] Callback completed');
      } else {
        debug('[SubmitPlan] No callback registered for session');
      }

      // Return a stop signal - the plan has been submitted and the agent should stop
      return {
        content: [{
          type: 'text' as const,
          text: `Plan submitted. Waiting for user review.`,
        }],
        isError: false,
      };
    }
  );
}

// ============================================================
// EnterPlanMode Tool Factory
// ============================================================

/**
 * Create a session-scoped EnterPlanMode tool.
 * The sessionId is captured at creation time, ensuring no cross-session contamination.
 */
export function createEnterPlanModeTool(sessionId: string) {
  return tool(
    'EnterPlanMode',
    `Enter plan mode when the user explicitly requests planning.

**IMPORTANT:** Only call this when the user EXPLICITLY asks for plan mode.
Look for clear signals like:
- "create a plan first"
- "let's plan this out"
- "use plan mode"
- "I want to see a plan before you start"
- "plan before executing"

Do NOT enter plan mode for:
- Simple tasks that don't need planning
- When the user just wants you to do something directly
- Ambiguous requests where planning wasn't mentioned

After entering plan mode, ask clarifying questions and then create a plan.`,
    {},
    async () => {
      // sessionId is captured from the factory closure - NOT from global state
      const state = getPlanModeStateForSession(sessionId);

      if (state.isActive) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Plan mode is already active.',
          }],
        };
      }

      // Enter plan mode
      planModeManager.setState(sessionId, {
        isActive: true,
        userInitiatedPlanMode: false,  // LLM-initiated, not user toggle
        exitedBy: null,  // Reset exit state when entering plan mode
        plan: null,
        planFilePath: null,
        taskDescription: null,
      });

      // Use registry callbacks for this specific session
      const callbacks = getAgentCallbacks(sessionId);
      const updatedState = planModeManager.getState(sessionId);

      callbacks?.onStateChange?.(updatedState);
      callbacks?.onPlanModeEntered?.();

      return {
        content: [{
          type: 'text' as const,
          text: 'PLAN_MODE_ENTERED',
        }],
      };
    }
  );
}

// ============================================================
// ExitPlanMode Tool Factory
// ============================================================

/**
 * Create a session-scoped ExitPlanMode tool.
 * The sessionId is captured at creation time, ensuring no cross-session contamination.
 */
export function createExitPlanModeTool(sessionId: string) {
  return tool(
    'ExitPlanMode',
    `Exit plan mode after the user has approved the plan.

**IMPORTANT:** Only call this when the user has EXPLICITLY approved the plan.
Look for clear approval signals like:
- "go ahead"
- "approved"
- "looks good, proceed"
- "execute the plan"
- "let's do it"

If the user's response is ambiguous or they're asking questions, do NOT exit plan mode.
Instead, ask for clarification or address their concerns.

After calling this tool, you can proceed with executing the plan.`,
    {},
    async () => {
      // sessionId is captured from the factory closure - NOT from global state
      const state = getPlanModeStateForSession(sessionId);

      if (!state.isActive) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Plan mode is not currently active.',
          }],
        };
      }

      // Exit plan mode
      planModeManager.setState(sessionId, {
        isActive: false,
        userInitiatedPlanMode: false,
        exitedBy: 'agent',  // Mark as agent-exited so we don't send redundant notification
      });

      // Use registry callbacks for this specific session
      const callbacks = getAgentCallbacks(sessionId);
      const updatedState = planModeManager.getState(sessionId);

      callbacks?.onStateChange?.(updatedState);
      callbacks?.onPlanModeExited?.();

      // Include the plan file path in the response so the agent knows where to read from
      const currentState = planModeManager.getState(sessionId);
      const planPath = currentState.planFilePath;

      const instructions = [
        'Plan mode exited. The user has approved your plan.',
        '',
        planPath ? `**Your plan is at:** \`${planPath}\`` : '',
        '',
        '**CRITICAL: You must now execute the plan completely.**',
        '- Read the plan file to refresh your memory of all steps',
        '- Execute each step in order, using the appropriate tools',
        '- Do NOT stop until ALL steps are completed',
        '- Report progress as you complete each step',
        '- If a step fails, try to resolve it before moving on',
        '',
        'BEGIN EXECUTION NOW. Start by reading the plan file.',
      ].filter(Boolean).join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: instructions,
        }],
      };
    }
  );
}

// ============================================================
// Read-Only Tool Patterns (for PreToolUse hook)
// ============================================================

/**
 * Patterns matching read-only MCP tools that are allowed in plan mode
 */
export const READ_ONLY_MCP_PATTERNS = [
  // Craft MCP - read operations
  /blocks_read/,
  /blocks_list/,
  /document_get/,
  /spaces_list/,
  /folders_list/,
  /search/,
  // Docs MCP - all operations are read-only
  /^mcp__docs__/,
];

/**
 * Check if an MCP tool is read-only (allowed in plan mode)
 */
export function isReadOnlyMcpTool(toolName: string): boolean {
  return READ_ONLY_MCP_PATTERNS.some(pattern => pattern.test(toolName));
}

/**
 * Check if an API request method is read-only
 */
export function isReadOnlyApiMethod(method: string): boolean {
  return method.toUpperCase() === 'GET';
}

/**
 * Tools that are always blocked in plan mode
 * Note: Write and Edit are allowed but only to the plans directory (checked separately)
 */
export const BLOCKED_IN_PLAN_MODE = ['Bash'];

/**
 * Generate plan mode context to inject into user messages.
 * This is used instead of system prompt injection to preserve prompt caching.
 *
 * @param sessionId - Session ID. REQUIRED to prevent cross-session contamination.
 * Returns null if not in plan mode.
 */
export function getPlanModeUserMessageContext(sessionId: string): string | null {
  const state = planModeManager.getState(sessionId);

  if (!state.isActive) {
    return null;
  }

  // Get the plans directory for this session
  const plansDir = state.sessionId ? getPlansDir(state.sessionId) : null;

  // Build the plan mode context message
  const parts: string[] = [];

  parts.push(`<plan_mode_active>`);
  parts.push(`You are in **PLAN MODE**. The user activated this via the UI.`);
  parts.push(``);
  parts.push(`**Your workflow:**`);
  parts.push(`1. Ask clarifying questions in plain text (normal conversation)`);
  parts.push(`2. When ready, write your plan to a markdown file`);
  parts.push(`3. Call \`SubmitPlan\` with the file path to present it for review`);
  parts.push(`4. After calling SubmitPlan, do NOT add any commentary - just stop`);
  parts.push(``);

  if (plansDir) {
    parts.push(`**Plans directory:** \`${plansDir}\``);
    parts.push(`This is the ONLY place you can write files. Use Write and Edit tools with absolute paths here.`);
    parts.push(`Example: \`${plansDir}/my-plan.md\``);
    parts.push(``);
  }

  parts.push(`**Restrictions:** Most write operations are blocked. You can ONLY use Write/Edit tools to the plans directory above.`);

  // If there's an existing plan file, tell the agent where it is
  if (state.planFilePath) {
    parts.push(``);
    parts.push(`**Current plan file:** \`${state.planFilePath}\``);
    parts.push(`Use Read to view it, or Edit to refine based on user feedback.`);
  }

  parts.push(`</plan_mode_active>`);

  return parts.join('\n');
}

/**
 * Generate plan mode exit context to inject into user messages.
 * This notifies the agent that plan mode was exited by the user (not the agent).
 *
 * @param sessionId - Session ID. REQUIRED to prevent cross-session contamination.
 * Returns null if:
 * - Plan mode is still active
 * - Plan mode was exited by the agent (agent already knows)
 * - Plan mode was never active (exitedBy is null)
 *
 * After returning the context once, clears the exitedBy flag to prevent repeated notifications.
 */
export function getPlanModeExitContext(sessionId: string): string | null {
  const state = planModeManager.getState(sessionId);

  // Only notify if:
  // 1. Plan mode is not active
  // 2. It was exited by the user (not the agent)
  if (state.isActive || state.exitedBy !== 'user') {
    return null;
  }

  // Clear the exitedBy flag so we don't send this again
  if (state.sessionId) {
    planModeManager.setState(state.sessionId, {
      exitedBy: null,
    });
  }

  // Build the exit notification
  const parts: string[] = [];
  parts.push(`<plan_mode_exited>`);
  parts.push(`Plan mode was exited via the UI. You can now execute actions directly.`);
  if (state.planFilePath) {
    parts.push(`Your plan is at: \`${state.planFilePath}\``);
    parts.push(`Proceed with executing the plan steps.`);
  }
  parts.push(`</plan_mode_exited>`);

  return parts.join('\n');
}
