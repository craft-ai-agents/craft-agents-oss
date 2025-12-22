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
import { randomUUID } from 'crypto';
import {
  loadPlanFromPath,
  formatPlanAsMarkdown,
  getPlansDir,
} from '../config/storage.ts';
import { debug } from '../utils/debug.ts';

// ============================================================
// Types for UI Integration
// ============================================================

/**
 * Question option for AskUserQuestion
 */
export interface QuestionOption {
  label: string;
  description: string;
}

/**
 * Question definition for AskUserQuestion
 */
export interface PlanQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// ============================================================
// Plan Mode State Management
// ============================================================

/**
 * Result of a plan review
 * - approve: Accept the plan (save + execute)
 * - saveOnly: Save the plan but cancel execution
 * - refine: Request changes with feedback
 * - cancel: Abort the plan without saving
 */
export type PlanReviewResult =
  | { action: 'approve'; modifiedPlan?: Plan; savedPath?: string }
  | { action: 'saveOnly'; modifiedPlan?: Plan; savedPath?: string }
  | { action: 'refine'; feedback: string }
  | { action: 'cancel' };

/**
 * Pending plan review request
 */
export interface PendingPlanReview {
  resolve: (result: PlanReviewResult) => void;
  plan: Plan;
  questions: string[];
}

/**
 * Pending AskUserQuestion request
 */
export interface PendingAskQuestion {
  resolve: (answers: Record<string, string>) => void;
  questions: PlanQuestion[];
}

/**
 * State shared between plan tools and CraftAgent
 */
export interface CraftPlanModeState {
  /** Whether plan mode is currently active */
  isActive: boolean;
  /** Whether plan mode was initiated by user (SHIFT+TAB or /plan) vs LLM */
  userInitiatedPlanMode: boolean;
  /** Session ID for plan storage (set by CraftAgent) */
  sessionId: string | null;
  /** The current plan (set when ExitCraftAgentsPlanMode is called) */
  plan: Plan | null;
  /** Path to the plan file on disk */
  planFilePath: string | null;
  /** Task description from EnterCraftAgentsPlanMode */
  taskDescription: string | null;
  /** Callback when state changes (set by CraftAgent) */
  onStateChange?: (state: CraftPlanModeState) => void;
  /** Callback to request plan review via UI (set by CraftAgent) */
  onPlanReviewRequest?: (request: { requestId: string; plan: Plan; questions: string[] }) => void;
  /** Callback to ask user questions via UI (set by CraftAgent) */
  onAskUserQuestion?: (request: { requestId: string; questions: PlanQuestion[] }) => void;
}

/**
 * Manager for per-session plan mode state.
 * Each session has its own state and pending requests.
 */
class PlanModeManager {
  private states: Map<string, CraftPlanModeState> = new Map();
  private pendingPlanReviews: Map<string, PendingPlanReview> = new Map();
  private pendingAskQuestions: Map<string, PendingAskQuestion> = new Map();
  /** Maps requestId -> sessionId for explicit ownership tracking */
  private requestOwnership: Map<string, string> = new Map();
  private currentSessionId: string | null = null;

  /**
   * Get or create state for a session
   */
  getState(sessionId: string): CraftPlanModeState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        isActive: false,
        userInitiatedPlanMode: false,
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
   * Get the current session's state (for tools that don't have explicit session context)
   */
  getCurrentState(): CraftPlanModeState {
    if (this.currentSessionId) {
      return this.getState(this.currentSessionId);
    }
    // Fallback for legacy code - return first active session or empty state
    for (const state of this.states.values()) {
      if (state.isActive) {
        return state;
      }
    }
    return {
      isActive: false,
      userInitiatedPlanMode: false,
      sessionId: null,
      plan: null,
      planFilePath: null,
      taskDescription: null,
    };
  }

  /**
   * Set the current active session (called when agent starts processing)
   */
  setCurrentSession(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  /**
   * Clean up a session's state and pending requests
   */
  cleanupSession(sessionId: string): void {
    this.states.delete(sessionId);
    // Clean up pending requests for this session using explicit ownership tracking
    for (const [requestId, ownerId] of this.requestOwnership) {
      if (ownerId === sessionId) {
        this.pendingPlanReviews.delete(requestId);
        this.pendingAskQuestions.delete(requestId);
        this.requestOwnership.delete(requestId);
      }
    }
  }

  /**
   * Add a pending plan review request
   * @param requestId - Unique request ID
   * @param pending - The pending request data
   * @param sessionId - The owning session ID for cleanup tracking
   */
  addPendingPlanReview(requestId: string, pending: PendingPlanReview, sessionId: string): void {
    this.pendingPlanReviews.set(requestId, pending);
    this.requestOwnership.set(requestId, sessionId);
  }

  /**
   * Get and remove a pending plan review
   */
  resolvePlanReview(requestId: string): PendingPlanReview | undefined {
    const pending = this.pendingPlanReviews.get(requestId);
    if (pending) {
      this.pendingPlanReviews.delete(requestId);
      this.requestOwnership.delete(requestId);
    }
    return pending;
  }

  /**
   * Add a pending ask question request
   * @param requestId - Unique request ID
   * @param pending - The pending request data
   * @param sessionId - The owning session ID for cleanup tracking
   */
  addPendingAskQuestion(requestId: string, pending: PendingAskQuestion, sessionId: string): void {
    this.pendingAskQuestions.set(requestId, pending);
    this.requestOwnership.set(requestId, sessionId);
  }

  /**
   * Get and remove a pending ask question
   */
  resolveAskQuestion(requestId: string): PendingAskQuestion | undefined {
    const pending = this.pendingAskQuestions.get(requestId);
    if (pending) {
      this.pendingAskQuestions.delete(requestId);
      this.requestOwnership.delete(requestId);
    }
    return pending;
  }
}

// Singleton manager instance
export const planModeManager = new PlanModeManager();

/**
 * Set the plan mode state (called by CraftAgent on init)
 */
export function setPlanModeState(state: CraftPlanModeState): void {
  if (state.sessionId) {
    planModeManager.setCurrentSession(state.sessionId);
    planModeManager.setState(state.sessionId, state);
  }
}

/**
 * Get the current plan mode state (used by PreToolUse hook)
 */
export function getPlanModeState(): CraftPlanModeState {
  return planModeManager.getCurrentState();
}

/**
 * Get plan mode state for a specific session
 */
export function getPlanModeStateForSession(sessionId: string): CraftPlanModeState {
  return planModeManager.getState(sessionId);
}

/**
 * Set the current active session (called when agent starts processing a message)
 * This ensures tools use the correct session's state and callbacks
 */
export function setCurrentPlanModeSession(sessionId: string | null): void {
  planModeManager.setCurrentSession(sessionId);
}

/**
 * Enter Craft Agents plan mode programmatically (called by TUI for SHIFT+TAB)
 * @param sessionId - Optional session ID to target. If not provided, uses current session.
 */
export function enterCraftPlanMode(sessionId?: string): void {
  const currentState = planModeManager.getCurrentState();
  const targetSessionId = sessionId || currentState.sessionId;
  debug(`[enterCraftPlanMode] Setting userInitiatedPlanMode=true for session ${targetSessionId}`);

  if (targetSessionId) {
    const existingState = planModeManager.getState(targetSessionId);
    planModeManager.setState(targetSessionId, {
      isActive: true,
      userInitiatedPlanMode: true,
      plan: null,
      planFilePath: null,
      taskDescription: null,
    });
    // Call the session's onStateChange callback if it exists
    const updatedState = planModeManager.getState(targetSessionId);
    existingState.onStateChange?.(updatedState);
  }

  debug(`[enterCraftPlanMode] State after: userInitiatedPlanMode=true for session ${targetSessionId}`);
}

/**
 * Exit Craft Agents plan mode programmatically (called by TUI for SHIFT+TAB)
 * @param sessionId - Optional session ID to target. If not provided, uses current session.
 */
export function exitCraftPlanMode(sessionId?: string): void {
  const currentState = planModeManager.getCurrentState();
  const targetSessionId = sessionId || currentState.sessionId;
  debug(`[exitCraftPlanMode] Exiting plan mode for session ${targetSessionId}`);

  if (targetSessionId) {
    const existingState = planModeManager.getState(targetSessionId);
    planModeManager.setState(targetSessionId, {
      isActive: false,
      userInitiatedPlanMode: false,
      plan: null,
      taskDescription: null,
    });
    // Call the session's onStateChange callback if it exists
    const updatedState = planModeManager.getState(targetSessionId);
    existingState.onStateChange?.(updatedState);
  }
}

/**
 * Get the current plan file path (for reference after exit)
 */
export function getCurrentPlanFilePath(): string | null {
  const state = getPlanModeState();
  return state.planFilePath;
}

/**
 * Respond to a pending plan review (called by TUI when user makes a choice)
 */
export function respondToPlanReview(requestId: string, result: PlanReviewResult): void {
  // Try the manager first (session-scoped)
  const pending = planModeManager.resolvePlanReview(requestId);
  if (pending) {
    pending.resolve(result);
  }
}

/**
 * Respond to a pending AskUserQuestion request (called by TUI when user answers)
 */
export function respondToAskQuestion(requestId: string, answers: Record<string, string>): void {
  // Try the manager first (session-scoped)
  const pending = planModeManager.resolveAskQuestion(requestId);
  if (pending) {
    pending.resolve(answers);
  }
}

/**
 * Request user to answer questions via the AskUserQuestion UI component
 * Returns a promise that resolves when user submits answers
 */
async function requestUserQuestion(questions: PlanQuestion[]): Promise<Record<string, string>> {
  const state = getPlanModeState();
  return new Promise((resolve) => {
    const sessionId = state.sessionId || 'unknown';
    // Use UUID for collision-free request IDs
    const requestId = `ask-question-${randomUUID()}`;

    // Store in manager with explicit session ownership for cleanup
    planModeManager.addPendingAskQuestion(requestId, {
      resolve,
      questions,
    }, sessionId);

    // Emit event to TUI
    if (state.onAskUserQuestion) {
      state.onAskUserQuestion({ requestId, questions });
    } else {
      // No handler - cancel the request (consistent with plan review behavior)
      planModeManager.resolveAskQuestion(requestId);
      resolve({});
    }
  });
}

/**
 * Request user to review a plan via the PlanReview UI component
 * Returns a promise that resolves when user approves, refines, or cancels
 */
async function requestPlanReview(plan: Plan, questions: string[]): Promise<PlanReviewResult> {
  const state = getPlanModeState();
  return new Promise((resolve) => {
    const sessionId = state.sessionId || 'unknown';
    // Use UUID for collision-free request IDs
    const requestId = `plan-review-${randomUUID()}`;

    // Store in manager with explicit session ownership for cleanup
    planModeManager.addPendingPlanReview(requestId, {
      resolve,
      plan,
      questions,
    }, sessionId);

    // Emit event to TUI
    if (state.onPlanReviewRequest) {
      state.onPlanReviewRequest({ requestId, plan, questions });
    } else {
      // No handler - auto-cancel
      planModeManager.resolvePlanReview(requestId);
      resolve({ action: 'cancel' });
    }
  });
}

// ============================================================
// EnterCraftAgentsPlanMode Tool - REMOVED
// Plan mode is now entered via UI toggle (badge/SHIFT+TAB).
// The agent is informed via user message injection instead.
// ============================================================

// ============================================================
// ExitCraftAgentsPlanMode Tool
// ============================================================

export const exitCraftAgentsPlanModeTool = tool(
  'ExitCraftAgentsPlanMode',
  `Exit planning mode and present your plan for user approval via an interactive review UI.

Call this when you have:
1. Explored the relevant Craft documents and API data
2. Designed a clear step-by-step plan
3. Identified any remaining questions

The user will see an interactive review UI where they can:
- **Approve** the plan to start execution
- **Refine** by providing feedback (you'll receive their feedback and can adjust)
- **Cancel** to discard the plan entirely`,
  {
    title: z.string().describe('Short title for the plan'),
    summary: z.string().describe('1-2 sentence summary of what the plan accomplishes'),
    steps: z.array(z.object({
      description: z.string().describe('What this step does'),
      tools: z.array(z.string()).optional().describe('MCP/API tools this step will use'),
    })).describe('Ordered list of steps to execute'),
    questions: z.array(z.string()).optional().describe('Any remaining questions for the user'),
  },
  async (args) => {
    // Get current state from manager (session-scoped)
    const state = getPlanModeState();
    const sessionId = state.sessionId;

    // Build the plan object using our Plan type
    const plan: Plan = {
      id: randomUUID(),
      title: args.title,
      state: 'ready',
      steps: args.steps.map((s, i) => ({
        id: `step-${i + 1}`,
        description: s.description,
        status: 'pending' as const,
        details: s.tools?.join(', '),
      })),
      context: args.summary,
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Helper to update state through manager
    const updateState = (updates: Partial<CraftPlanModeState>) => {
      if (sessionId) {
        planModeManager.setState(sessionId, updates);
        const updatedState = planModeManager.getState(sessionId);
        state.onStateChange?.(updatedState);
      }
    };

    // Store the plan in state (file will be saved when user approves/saves in PlanReview)
    updateState({ plan, planFilePath: null });

    // Request user review via UI
    const result = await requestPlanReview(plan, args.questions || []);

    // Handle the result
    switch (result.action) {
      case 'approve': {
        // User approved - exit plan mode and proceed
        updateState({
          isActive: false,
          planFilePath: result.savedPath || null,
        });

        return {
          content: [{
            type: 'text' as const,
            text: `Plan "${args.title}" has been APPROVED by the user.

**Plan saved to:** ${result.savedPath || '(not saved)'}

You can now proceed with executing the plan:
${args.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}

Begin executing the plan steps in order.`,
          }],
        };
      }

      case 'refine':
        // User wants changes - stay in plan mode, return feedback
        // Plan mode stays active so Claude can make more read-only calls
        updateState({ isActive: true });
        return {
          content: [{
            type: 'text' as const,
            text: `Plan "${args.title}" needs refinement.

**User feedback:**
${result.feedback}

Please adjust your plan based on this feedback. You can:
- Read more Craft documents or API data if needed
- Use AskUserQuestion for further clarification
- Call ExitCraftAgentsPlanMode again with the updated plan`,
          }],
        };

      case 'saveOnly': {
        // User saved plan but cancelled execution - exit plan mode
        updateState({
          isActive: false,
          plan: null,
          planFilePath: result.savedPath || null,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Plan "${args.title}" has been SAVED but execution was cancelled.

**Plan saved to:** ${result.savedPath || '(not saved)'}

The plan has been saved for later reference but will not be executed now.
Use \`/plan list\` to see saved plans and \`/plan load\` to inject them into future sessions.`,
          }],
        };
      }

      case 'cancel':
        // User cancelled - exit plan mode, don't save
        updateState({
          isActive: false,
          plan: null,
          planFilePath: null,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Plan "${args.title}" has been CANCELLED by the user.

The plan was not saved and will not be executed.`,
          }],
        };
    }
  }
);

// ============================================================
// CraftAgentsPlanModeAskQuestion Tool
// ============================================================

export const craftAgentsPlanModeAskQuestionTool = tool(
  'CraftAgentsPlanModeAskQuestion',
  `Ask the user questions during Craft Agents plan mode to clarify requirements.

Use this tool when you need to:
- Clarify user preferences or constraints
- Confirm assumptions before creating your plan
- Get specific details about what the user wants

The tool presents an interactive UI where users can:
- Select from options you provide (single or multi-select)
- Use keyboard navigation to choose answers

**Guidelines:**
- Keep questions focused and clear
- Provide 2-4 meaningful options per question
- Each option should have a helpful description
- Use multiSelect when multiple answers are valid
- Ask up to 4 questions at once`,
  {
    questions: z.array(z.object({
      question: z.string().describe('The question to ask the user'),
      header: z.string().describe('Short label for the question (max 12 chars, e.g., "Budget", "Timeline")'),
      options: z.array(z.object({
        label: z.string().describe('Option label (1-5 words)'),
        description: z.string().describe('Explanation of what this option means'),
      })).min(2).max(4).describe('Available choices (2-4 options)'),
      multiSelect: z.boolean().describe('Allow multiple selections?'),
    })).min(1).max(4).describe('Questions to ask (1-4 questions)'),
  },
  async (args) => {
    // Convert to PlanQuestion format
    const questions: PlanQuestion[] = args.questions.map(q => ({
      question: q.question,
      header: q.header,
      options: q.options.map(o => ({
        label: o.label,
        description: o.description,
      })),
      multiSelect: q.multiSelect,
    }));

    // Request user input via UI
    const answers = await requestUserQuestion(questions);

    // Format answers for response
    const answersFormatted = Object.entries(answers)
      .map(([question, answer]) => `**${question}**\n${answer}`)
      .join('\n\n');

    return {
      content: [{
        type: 'text' as const,
        text: `User's answers:

${answersFormatted}

Use these answers to inform your plan. You can:
- Ask more questions with CraftAgentsPlanModeAskQuestion if needed
- Read relevant data with allowed tools
- Call ExitCraftAgentsPlanMode when your plan is ready`,
      }],
    };
  }
);

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
 */
export const BLOCKED_IN_PLAN_MODE = ['Bash', 'Write', 'Edit'];

/**
 * Generate plan mode context to inject into user messages.
 * This is used instead of system prompt injection to preserve prompt caching.
 *
 * Returns null if not in plan mode.
 */
export function getPlanModeUserMessageContext(sessionId?: string): string | null {
  const state = sessionId
    ? planModeManager.getState(sessionId)
    : planModeManager.getCurrentState();

  if (!state.isActive) {
    return null;
  }

  // Build the plan mode context message
  const parts: string[] = [];

  parts.push(`<plan_mode_active>`);
  parts.push(`You are in **PLAN MODE**. The user activated this via the UI.`);
  parts.push(``);
  parts.push(`**Your task:**`);
  parts.push(`1. Use \`CraftAgentsPlanModeAskQuestion\` to clarify requirements`);
  parts.push(`2. Design a clear step-by-step plan`);
  parts.push(`3. Call \`ExitCraftAgentsPlanMode\` to submit your plan for review`);
  parts.push(``);
  parts.push(`**Restrictions:** Write operations are blocked. Only read/explore to understand context.`);

  // If there's an existing plan file, tell the agent where it is
  if (state.planFilePath) {
    parts.push(``);
    parts.push(`**Current plan file:** \`${state.planFilePath}\``);
    parts.push(`Use the Read tool to view the plan if needed.`);
  }

  parts.push(`</plan_mode_active>`);

  return parts.join('\n');
}
