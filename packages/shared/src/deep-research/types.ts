export type DeepResearchPlanPolicy = 'approve' | 'auto';

export type DeepResearchRunState =
  | 'created'
  | 'awaiting_plan_approval'
  | 'running'
  | 'interrupted'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type DeepResearchStepKind = 'research' | 'analysis' | 'synthesis';

export type DeepResearchStepState = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type DeepResearchDepth = 'quick' | 'standard' | 'deep';

export type DeepResearchReportFormat = 'brief' | 'standard' | 'full';

export type DeepResearchSourceCapability = 'search' | 'browser' | 'mcp' | 'api' | 'local' | 'knowledge';

export interface DeepResearchLoopBudget {
  depth: DeepResearchDepth;
  maxSearchRounds: number;
  maxPagesToOpen: number;
  minFollowUpRounds: number;
}

export interface DeepResearchSourceProfile {
  slug: string;
  name: string;
  provider: string;
  type: string;
  capabilities: DeepResearchSourceCapability[];
  tagline?: string;
}

export interface DeepResearchSourceReadiness {
  requested: string[];
  usable: string[];
  missing: string[];
  unusable: string[];
}

export interface DeepResearchPlanStep {
  id: string;
  kind: DeepResearchStepKind;
  title: string;
  instructions: string;
  requiredSourceSlugs: string[];
}

export interface DeepResearchPlan {
  id: string;
  title: string;
  objective: string;
  policy: DeepResearchPlanPolicy;
  depth: DeepResearchDepth;
  reportFormat: DeepResearchReportFormat;
  loopBudget: DeepResearchLoopBudget;
  sourceProfiles: DeepResearchSourceProfile[];
  steps: DeepResearchPlanStep[];
  requiredSourceSlugs: string[];
  assumptions: string[];
  riskNotes: string[];
  createdAt: string;
  approvedAt?: string;
  revisionNotes?: string[];
}

export interface DeepResearchStepRun {
  id: string;
  kind: DeepResearchStepKind;
  title: string;
  state: DeepResearchStepState;
  sessionId?: string;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DeepResearchRunEvent {
  ts: string;
  type:
    | 'created'
    | 'plan.created'
    | 'plan.revised'
    | 'plan.approved'
    | 'step.started'
    | 'step.completed'
    | 'step.failed'
    | 'report.created'
    | 'cancelled'
    | 'failed';
  message: string;
}

export interface DeepResearchRunSnapshot {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  topic: string;
  state: DeepResearchRunState;
  planPolicy: DeepResearchPlanPolicy;
  sourceReadiness: DeepResearchSourceReadiness;
  plan: DeepResearchPlan;
  steps: DeepResearchStepRun[];
  events: DeepResearchRunEvent[];
  outputId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StartDeepResearchRunInput {
  topic: string;
  title?: string;
  planPolicy?: DeepResearchPlanPolicy;
  sourceSlugs?: string[];
  depth?: DeepResearchDepth;
  reportFormat?: DeepResearchReportFormat;
}

export interface ReviseDeepResearchPlanInput {
  feedback: string;
}

export interface DeepResearchRunEventEnvelope {
  workspaceId: string;
  run: DeepResearchRunSnapshot;
  eventType: 'created' | 'updated' | 'completed';
}
