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
 * Swarm configuration for parallel agent execution
 */
export interface SwarmConfig {
  /** Whether to launch a swarm */
  enabled: boolean;
  /** Number of parallel agents to spawn */
  teammateCount: number;
  /** Callback to spawn a teammate (returns agent ID) */
  onSpawnTeammate?: (taskDescription: string, stepIndex: number) => Promise<string>;
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
  /** Callback to launch swarm agents (set by CraftAgent) */
  onLaunchSwarm?: (config: SwarmConfig, plan: Plan, planFilePath: string) => Promise<void>;
}

// Global state (initialized by CraftAgent)
let planModeState: CraftPlanModeState = {
  isActive: false,
  userInitiatedPlanMode: false,
  sessionId: null,
  plan: null,
  planFilePath: null,
  taskDescription: null,
};

// Pending plan reviews (similar to pendingQuestions in craft-agent.ts)
const pendingPlanReviews = new Map<string, PendingPlanReview>();

// Pending user questions
const pendingAskQuestions = new Map<string, PendingAskQuestion>();

/**
 * Set the plan mode state (called by CraftAgent on init)
 */
export function setPlanModeState(state: CraftPlanModeState): void {
  planModeState = state;
}

/**
 * Get the current plan mode state (used by PreToolUse hook)
 */
export function getPlanModeState(): CraftPlanModeState {
  return planModeState;
}

/**
 * Enter Craft Agents plan mode programmatically (called by TUI for SHIFT+TAB)
 * Note: sessionId should already be set via setPlanModeState
 */
export function enterCraftPlanMode(): void {
  debug('[enterCraftPlanMode] Setting userInitiatedPlanMode=true');
  planModeState.isActive = true;
  planModeState.userInitiatedPlanMode = true;  // User initiated via SHIFT+TAB or /plan
  planModeState.plan = null;
  planModeState.planFilePath = null;
  planModeState.taskDescription = null;
  // sessionId is preserved (set by CraftAgent)
  planModeState.onStateChange?.(planModeState);
  debug(`[enterCraftPlanMode] State after: userInitiatedPlanMode=${planModeState.userInitiatedPlanMode}`);
}

/**
 * Exit Craft Agents plan mode programmatically (called by TUI for SHIFT+TAB)
 */
export function exitCraftPlanMode(): void {
  planModeState.isActive = false;
  planModeState.userInitiatedPlanMode = false;  // Reset
  planModeState.plan = null;
  // Keep planFilePath so it can be referenced after exit
  planModeState.taskDescription = null;
  planModeState.onStateChange?.(planModeState);
}

/**
 * Get the current plan file path (for reference after exit)
 */
export function getCurrentPlanFilePath(): string | null {
  return planModeState.planFilePath;
}

/**
 * Respond to a pending plan review (called by TUI when user makes a choice)
 */
export function respondToPlanReview(requestId: string, result: PlanReviewResult): void {
  const pending = pendingPlanReviews.get(requestId);
  if (pending) {
    pending.resolve(result);
    pendingPlanReviews.delete(requestId);
  }
}

/**
 * Respond to a pending AskUserQuestion request (called by TUI when user answers)
 */
export function respondToAskQuestion(requestId: string, answers: Record<string, string>): void {
  const pending = pendingAskQuestions.get(requestId);
  if (pending) {
    pending.resolve(answers);
    pendingAskQuestions.delete(requestId);
  }
}

/**
 * Request user to answer questions via the AskUserQuestion UI component
 * Returns a promise that resolves when user submits answers
 */
async function requestUserQuestion(questions: PlanQuestion[]): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const requestId = `ask-question-${Date.now()}`;

    pendingAskQuestions.set(requestId, {
      resolve,
      questions,
    });

    // Emit event to TUI
    if (planModeState.onAskUserQuestion) {
      planModeState.onAskUserQuestion({ requestId, questions });
    } else {
      // No handler - return empty answers
      pendingAskQuestions.delete(requestId);
      resolve({});
    }
  });
}

/**
 * Request user to review a plan via the PlanReview UI component
 * Returns a promise that resolves when user approves, refines, or cancels
 */
async function requestPlanReview(plan: Plan, questions: string[]): Promise<PlanReviewResult> {
  return new Promise((resolve) => {
    const requestId = `plan-review-${Date.now()}`;

    pendingPlanReviews.set(requestId, {
      resolve,
      plan,
      questions,
    });

    // Emit event to TUI
    if (planModeState.onPlanReviewRequest) {
      planModeState.onPlanReviewRequest({ requestId, plan, questions });
    } else {
      // No handler - auto-cancel
      pendingPlanReviews.delete(requestId);
      resolve({ action: 'cancel' });
    }
  });
}

// ============================================================
// EnterCraftAgentsPlanMode Tool
// ============================================================

export const enterCraftAgentsPlanModeTool = tool(
  'EnterCraftAgentsPlanMode',
  `Enter planning mode for complex Craft Agent workflows. Use this when the task involves:
- Multiple MCP operations (reading/creating Craft documents)
- API integrations (fetching external data)
- Multi-step workflows that need user approval before execution

**CRITICAL: Plan mode is for PLANNING only - describe what you WILL do, don't execute it.**

**FLOW:**
1. Enter plan mode with this tool
2. Use CraftAskUserQuestion to clarify requirements (MANDATORY - no plain text questions)
3. Design your plan - describe WHAT you will do (don't call APIs, don't search)
4. Call ExitCraftAgentsPlanMode with your plan

**BLOCKED in plan mode:**
- API calls (describe what you'll call in the plan)
- Web search/fetch (describe what you'll search)
- Write operations (wait for approval)

**ALLOWED:**
- CraftAskUserQuestion (required for questions)
- Reading existing Craft documents
- Local file exploration (Read, Glob, Grep)`,
  {
    task: z.string().describe('Brief description of the task being planned'),
    context: z.string().optional().describe('Additional context about the workflow'),
  },
  async (args) => {
    // Set plan mode active and store task description
    planModeState.isActive = true;
    planModeState.plan = null; // Clear any previous plan
    planModeState.planFilePath = null; // Will be set when plan is saved
    planModeState.taskDescription = args.task;
    planModeState.onStateChange?.(planModeState);

    // Get session-scoped plans directory
    const plansDir = planModeState.sessionId ? getPlansDir(planModeState.sessionId) : '(session not initialized)';

    return {
      content: [{
        type: 'text' as const,
        text: `Entered Craft Agents plan mode for: "${args.task}"

**Plan files are stored in:** ${plansDir}

**CRITICAL: Plan mode is for PLANNING only - describe what you WILL do, don't execute it.**

**NEXT STEP: Use CraftAskUserQuestion tool to clarify requirements.**
Do NOT ask questions in plain text - use the interactive tool.

**What to do:**
1. Use CraftAskUserQuestion to understand what the user wants
2. Design a plan describing WHAT you will do (steps, tools, etc.)
3. Call ExitCraftAgentsPlanMode with your plan

**BLOCKED (do NOT call these - just describe them in your plan):**
- API calls
- Creating/updating Craft documents
- Bash commands, file writes

**ALLOWED:**
- CraftAskUserQuestion for clarification
- Reading existing Craft documents
- Local file exploration (Read, Glob, Grep)
- Web search/fetch (use sparingly - quick lookups only)

When your plan is ready, call ExitCraftAgentsPlanMode. The user will see a PlanReview UI to approve/refine/cancel.
You can optionally set launchSwarm=true to execute steps in parallel with multiple agents.`,
      }],
    };
  }
);

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
- **Cancel** to discard the plan entirely

**Swarm Mode (optional):**
Set launchSwarm=true to execute plan steps in parallel using multiple agents.
- Each step becomes a separate task assigned to a teammate agent
- Steps execute concurrently for faster completion
- Use teammateCount to control parallelism (default: 3, max: 5)
- Best for steps that are independent and don't depend on each other`,
  {
    title: z.string().describe('Short title for the plan'),
    summary: z.string().describe('1-2 sentence summary of what the plan accomplishes'),
    steps: z.array(z.object({
      description: z.string().describe('What this step does'),
      tools: z.array(z.string()).optional().describe('MCP/API tools this step will use'),
    })).describe('Ordered list of steps to execute'),
    questions: z.array(z.string()).optional().describe('Any remaining questions for the user'),
    launchSwarm: z.boolean().optional().describe('If true, execute steps in parallel using multiple agents'),
    teammateCount: z.number().min(1).max(5).optional().describe('Number of parallel agents (default: 3, max: 5)'),
  },
  async (args) => {
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

    // Store the plan in state (file will be saved when user approves/saves in PlanReview)
    planModeState.plan = plan;
    planModeState.planFilePath = null;  // Will be set by PlanReview on save

    // Request user review via UI
    const result = await requestPlanReview(plan, args.questions || []);

    // Handle the result
    switch (result.action) {
      case 'approve': {
        // User approved - exit plan mode and proceed
        planModeState.isActive = false;
        planModeState.planFilePath = result.savedPath || null;
        planModeState.onStateChange?.(planModeState);

        // Check if swarm mode is requested
        const launchSwarm = args.launchSwarm ?? false;
        const teammateCount = Math.min(args.teammateCount ?? 3, 5);

        if (launchSwarm && planModeState.onLaunchSwarm && result.savedPath) {
          // Launch swarm for parallel execution
          const swarmConfig: SwarmConfig = {
            enabled: true,
            teammateCount,
          };

          // Trigger swarm launch (non-blocking)
          planModeState.onLaunchSwarm(swarmConfig, plan, result.savedPath).catch(() => {
            // Swarm launch failed, continue with sequential execution
          });

          return {
            content: [{
              type: 'text' as const,
              text: `Plan "${args.title}" has been APPROVED with SWARM MODE.

**Plan saved to:** ${result.savedPath}

Launching ${teammateCount} parallel agents to execute:
${args.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}

Each step will be assigned to a teammate agent for concurrent execution.
You can monitor progress and coordinate the team.`,
            }],
          };
        }

        // Regular sequential execution
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
        planModeState.isActive = true;
        planModeState.onStateChange?.(planModeState);
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
        planModeState.isActive = false;
        planModeState.plan = null;
        planModeState.planFilePath = result.savedPath || null;
        planModeState.onStateChange?.(planModeState);
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
        planModeState.isActive = false;
        planModeState.plan = null;
        planModeState.planFilePath = null;
        planModeState.onStateChange?.(planModeState);
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
// CraftAskUserQuestion Tool
// ============================================================

export const craftAskUserQuestionTool = tool(
  'CraftAskUserQuestion',
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
- Ask more questions with CraftAskUserQuestion if needed
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
  /blocks_get/,
  /blocks_read/,
  /blocks_list/,
  /document_get/,
  /document_read/,
  /document_search/,
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
