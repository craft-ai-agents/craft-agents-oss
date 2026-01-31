/**
 * Lab Types
 *
 * Type definitions for Lab — the multi-agent orchestration system.
 * Lab allows users to define projects with persona-based agent teams
 * that collaborate through a War Room pipeline (Think → Build → Judge).
 */

// ============================================================
// Persona Types
// ============================================================

/**
 * A persona represents a distinct mindset/role in the team.
 * Each persona defines HOW an agent thinks, WHAT it knows,
 * and HOW it judges quality.
 */
export interface LabPersona {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., "Product Owner") */
  name: string;
  /** Short role description (e.g., "Defines user value and MVP scope") */
  role: string;
  /** Emoji icon */
  icon: string;
  /**
   * How this persona thinks — their cognitive approach.
   * This shapes the agent's reasoning style and priorities.
   */
  mindset: string;
  /**
   * What this persona knows — their domain expertise.
   * This shapes the agent's knowledge base.
   */
  knowledge: string;
  /**
   * How this persona judges quality — their evaluation criteria.
   * Used during review phases.
   */
  evaluationCriteria: string;
  /**
   * Which model to use for this persona.
   * Cheaper models (haiku) for simpler roles, expensive (opus) for complex ones.
   */
  model?: string;
  /** Timestamp of creation */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Input for creating a new persona (without generated fields)
 */
export interface CreatePersonaInput {
  name: string;
  role: string;
  icon?: string;
  mindset: string;
  knowledge: string;
  evaluationCriteria: string;
  model?: string;
}

// ============================================================
// Project Types
// ============================================================

/**
 * A Lab project groups personas and pipelines around a shared goal.
 */
export interface LabProject {
  /** Unique identifier (human-readable slug) */
  id: string;
  /** Display name */
  name: string;
  /** What this project is about */
  description: string;
  /** High-level goals for the project */
  goals: string[];
  /** Path to git repository (optional) */
  repository?: string;
  /** Working directory for file operations */
  workingDirectory?: string;
  /** Persona IDs used in this project */
  personaIds: string[];
  /** Timestamp of creation */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Input for creating a new project
 */
export interface CreateProjectInput {
  name: string;
  description: string;
  goals?: string[];
  repository?: string;
  workingDirectory?: string;
  personaIds?: string[];
}

// ============================================================
// Pipeline Types (War Room Execution)
// ============================================================

/** Pipeline status */
export type PipelineStatus =
  | 'pending'
  | 'thinking'     // Act 1: Parallel thinking
  | 'synthesizing'  // Manager reading briefs + planning
  | 'building'      // Act 2: Sequential implementation
  | 'reviewing'     // Act 3: Parallel review
  | 'iterating'     // Fix cycle after review
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Phase type in the War Room pipeline */
export type PhaseType = 'think' | 'synthesize' | 'build' | 'review' | 'iterate';

/** Phase status */
export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Agent run status */
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * A single agent's contribution within a phase.
 */
export interface LabAgentRun {
  /** Unique identifier */
  id: string;
  /** Which persona is running */
  personaId: string;
  /** Persona display name (denormalized for UI) */
  personaName: string;
  /** Persona icon (denormalized for UI) */
  personaIcon: string;
  /** Current status */
  status: AgentRunStatus;
  /** Output text (brief, review, etc.) */
  output?: string;
  /** Path to output file */
  outputFile?: string;
  /** Token usage */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  /** When this run started */
  startedAt?: number;
  /** When this run completed */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * A phase in the War Room pipeline (e.g., Think, Build, Review).
 */
export interface LabPhase {
  /** Unique identifier */
  id: string;
  /** Phase type */
  type: PhaseType;
  /** Human-readable label */
  label: string;
  /** Current status */
  status: PhaseStatus;
  /** Agent runs within this phase */
  agents: LabAgentRun[];
  /** When this phase started */
  startedAt?: number;
  /** When this phase completed */
  completedAt?: number;
}

/**
 * A pipeline represents a single execution of the War Room.
 * It tracks the full lifecycle: Think → Synthesize → Build → Review → Iterate.
 */
export interface LabPipeline {
  /** Unique identifier */
  id: string;
  /** Parent project */
  projectId: string;
  /** The original task/problem description */
  prompt: string;
  /** Current status */
  status: PipelineStatus;
  /** Phases in execution order */
  phases: LabPhase[];
  /** Current iteration number (0 = first run) */
  iteration: number;
  /** Maximum iterations before stopping */
  maxIterations: number;
  /** Git branch for this pipeline's work */
  gitBranch?: string;
  /** Aggregated token usage */
  totalTokens?: number;
  /** Aggregated cost */
  totalCostUsd?: number;
  /** When this pipeline was created */
  createdAt: number;
  /** When this pipeline was last updated */
  updatedAt: number;
  /** When this pipeline completed */
  completedAt?: number;
}

// ============================================================
// Pipeline Events (for UI progress tracking)
// ============================================================

/** Events emitted by the pipeline runner and consumed by the UI */
export type PipelineEvent =
  | { type: 'pipeline_started'; pipelineId: string }
  | { type: 'phase_started'; pipelineId: string; phaseId: string; phaseType: string; phaseIndex: number }
  | { type: 'agent_started'; pipelineId: string; phaseIndex: number; agentRunId: string; personaId: string; personaName: string; personaIcon: string }
  | { type: 'agent_progress'; pipelineId: string; phaseIndex: number; personaId: string; text: string }
  | { type: 'agent_completed'; pipelineId: string; phaseIndex: number; agentRunId: string; personaId: string; output: string; tokenUsage?: LabAgentRun['tokenUsage'] }
  | { type: 'agent_failed'; pipelineId: string; phaseIndex: number; agentRunId: string; personaId: string; error: string }
  | { type: 'phase_completed'; pipelineId: string; phaseIndex: number; phaseType: string }
  | { type: 'pipeline_completed'; pipelineId: string; status: PipelineStatus; totalCostUsd?: number; totalTokens?: number }
  | { type: 'pipeline_error'; pipelineId: string; error: string };

// ============================================================
// Loaded Types (with computed fields)
// ============================================================

/**
 * A fully loaded project with its personas resolved.
 */
export interface LoadedLabProject {
  /** Project configuration */
  project: LabProject;
  /** Resolved personas */
  personas: LabPersona[];
  /** Pipeline count */
  pipelineCount: number;
  /** Most recent pipeline status */
  latestPipelineStatus?: PipelineStatus;
  /** Absolute path to project directory */
  path: string;
}
