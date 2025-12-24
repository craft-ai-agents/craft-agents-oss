/**
 * Plan Tools
 *
 * Universal planning tools that the agent can use anytime.
 * These are NOT mode-specific - the agent can create plans at any point.
 *
 * SubmitPlan: Submit a plan file for user review/display
 * - The agent writes a plan to a markdown file
 * - Calls SubmitPlan to notify the UI to display it
 * - Works regardless of Safe Mode status
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { getPlansDir } from '../config/storage.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Plan Callback Registry
// ============================================================

/**
 * Callbacks for plan operations
 */
export interface PlanCallbacks {
  /** Called when a plan is submitted - triggers plan message display in UI */
  onPlanSubmitted?: (planPath: string) => void;
}

/**
 * Registry mapping session IDs to plan callbacks.
 */
const planCallbackRegistry = new Map<string, PlanCallbacks>();

/**
 * Register plan callbacks for a session.
 * Called by CraftAgent when initializing.
 */
export function registerPlanCallbacks(sessionId: string, callbacks: PlanCallbacks): void {
  planCallbackRegistry.set(sessionId, callbacks);
  debug(`[PlanRegistry] Registered callbacks for session ${sessionId}`);
}

/**
 * Unregister plan callbacks for a session.
 * Called by CraftAgent on dispose.
 */
export function unregisterPlanCallbacks(sessionId: string): void {
  planCallbackRegistry.delete(sessionId);
  debug(`[PlanRegistry] Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get plan callbacks for a session.
 */
export function getPlanCallbacks(sessionId: string): PlanCallbacks | undefined {
  return planCallbackRegistry.get(sessionId);
}

// ============================================================
// Plan File State (per session)
// ============================================================

/**
 * Track the last submitted plan file per session
 */
const sessionPlanFiles = new Map<string, string>();

/**
 * Get the last submitted plan file path for a session
 */
export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFiles.get(sessionId) ?? null;
}

/**
 * Set the last submitted plan file path for a session
 */
export function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFiles.set(sessionId, path);
}

/**
 * Clear plan file state for a session
 */
export function clearPlanFileState(sessionId: string): void {
  sessionPlanFiles.delete(sessionId);
}

// ============================================================
// SubmitPlan Tool Factory
// ============================================================

/**
 * Create a session-scoped SubmitPlan tool.
 * The sessionId is captured at creation time.
 *
 * This is a UNIVERSAL tool - the agent can use it anytime to submit
 * a plan for user review, regardless of Safe Mode status.
 */
export function createSubmitPlanTool(sessionId: string) {
  return tool(
    'SubmitPlan',
    `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

This tool can be used anytime - it's not restricted to any particular mode.
Use it whenever you want to present a structured plan to the user.

**Format your plan as markdown:**
\`\`\`markdown
# Plan Title

## Summary
Brief description of what this plan accomplishes.

## Steps
1. **Step description** - Details and approach
2. **Another step** - More details
3. ...
\`\`\`

**IMPORTANT:** After calling this tool, wait for user feedback before proceeding.`,
    {
      planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
    },
    async (args) => {
      debug('[SubmitPlan] Called with planPath:', args.planPath);
      debug('[SubmitPlan] sessionId (from closure):', sessionId);

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

      // Store the plan file path
      setLastPlanFilePath(sessionId, args.planPath);

      // Get callbacks and notify UI
      const callbacks = getPlanCallbacks(sessionId);
      debug('[SubmitPlan] Registry callbacks found:', !!callbacks);

      if (callbacks?.onPlanSubmitted) {
        callbacks.onPlanSubmitted(args.planPath);
        debug('[SubmitPlan] Callback completed');
      } else {
        debug('[SubmitPlan] No callback registered for session');
      }

      return {
        content: [{
          type: 'text' as const,
          text: 'Plan submitted for review. Waiting for user feedback.',
        }],
        isError: false,
      };
    }
  );
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(sessionId: string): string {
  return getPlansDir(sessionId);
}

/**
 * Check if a file path is within the plans directory
 */
export function isPathInPlansDir(filePath: string, sessionId: string): boolean {
  const plansDir = getPlansDir(sessionId);
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPlansDir = plansDir.replace(/\\/g, '/');
  return normalizedPath.startsWith(normalizedPlansDir);
}
