import type { SkillSource, SkillSummary } from '../skills/types.ts';

export const LABEL_SKILL_BINDINGS_VERSION = 1 as const;
export const LABEL_SKILL_BINDINGS_FILE = 'label-skill-bindings.json';

export type LabelSkillBindingApplyScope =
  | {
      mode: 'source-fingerprint';
      source: SkillSource;
      /** Metadata-only skill hash captured when the binding was saved/generated. */
      metadataHash: string;
      /** Scope fingerprint from SkillSummary; hashes any local path rather than exposing it. */
      scopeFingerprint: string;
    }
  | {
      mode: 'workspace-slug';
      /** Workspace id/slug/name chosen by the UI; not an absolute path. */
      workspaceSlug: string;
    };

export interface RequiredSourceSnapshotEntry {
  slug: string;
  name?: string;
  type?: string;
  /** Optional hash of display-safe source metadata. */
  metadataHash?: string;
}

export interface LabelSkillBindingGeneratedFrom {
  skillSlug: string;
  skillName: string;
  skillDescription: string;
  skillSource: SkillSource;
  metadataHash: string;
  contentHash?: string;
  requiredSources?: string[];
  /** Display-only hint such as a project folder name. Never an absolute path. */
  workingDirectoryHint?: string;
  generatedAt: string;
}

export interface LabelSkillBinding {
  id: string;
  enabled: boolean;
  labelId: string;
  skillSlug: string;
  /** Compact instruction injected at runtime when the label is active. */
  compactInstruction: string;
  applyScope: LabelSkillBindingApplyScope;
  requiredSourcesSnapshot?: RequiredSourceSnapshotEntry[];
  generatedFrom?: LabelSkillBindingGeneratedFrom;
  createdAt: string;
  updatedAt: string;
}

export interface LabelSkillBindingsConfig {
  version: typeof LABEL_SKILL_BINDINGS_VERSION;
  bindings: LabelSkillBinding[];
}

export type LabelSkillBindingSeverity = 'error' | 'warning';

export interface LabelSkillBindingDiagnostic {
  severity: LabelSkillBindingSeverity;
  code: string;
  message: string;
  bindingId?: string;
}

export interface LabelSkillBindingsValidationResult {
  valid: boolean;
  config: LabelSkillBindingsConfig;
  diagnostics: LabelSkillBindingDiagnostic[];
  errors: LabelSkillBindingDiagnostic[];
  warnings: LabelSkillBindingDiagnostic[];
}

export interface LabelSkillBindingsContext {
  labels?: Array<{ id: string }>;
  skills?: SkillSummary[];
  workspaceSlug?: string;
  now?: Date;
}

export type LabelSkillBootstrapStatus = 'pending' | 'attempted' | 'completed';

export interface LabelSkillBootstrapStateEntry {
  bindingId: string;
  labelId?: string;
  skillSlug: string;
  status: LabelSkillBootstrapStatus;
  attemptedAt?: string;
  completedAt?: string;
  lastFailureReason?: string;
}

export interface LabelSkillBootstrapState {
  configHash?: string;
  /** Session context epoch this bootstrap state belongs to. Missing legacy values are treated as epoch 0. */
  contextEpoch?: number;
  entries?: LabelSkillBootstrapStateEntry[];
  bootstrappedSkillSlugs?: string[];
  updatedAt?: string;
  lastFailureReason?: string;
}

export interface LabelSkillAnchorState {
  /** Increments after chat compaction so label-bound skills can be re-bootstrapped into the new context. */
  contextEpoch?: number;
  lastConfigHash?: string;
  lastActiveBindingIds?: string[];
  lastBlockKind?: 'active' | 'revocation' | 'none';
  lastInjectedAt?: string;
  bootstrap?: LabelSkillBootstrapState;
}

export interface LabelSkillAnchorSkillRef {
  slug: string;
  name?: string;
  source?: SkillSource;
  metadataHash?: string;
  contentHash?: string;
  requiredSources?: string[];
}

export interface ResolvedLabelSkillAnchor {
  bindingId: string;
  labelId: string;
  skillSlug: string;
  skillName?: string;
  skillDescription?: string;
  /** Display-safe pointer to the bound skill. Never includes local paths or full SKILL.md content. */
  skillRef: LabelSkillAnchorSkillRef;
  compactInstruction: string;
  requiredSourceSlugs: string[];
}

export interface ResolveActiveLabelSkillAnchorsOptions {
  sessionLabels: string[];
  /** Current workspace labels. When provided, stale/deleted session labels are ignored for matching. */
  labels?: Array<{ id: string }>;
  skills?: SkillSummary[];
  workspaceSlug?: string;
  previousState?: LabelSkillAnchorState;
  /** Current session context epoch. Defaults to previousState.contextEpoch or 0. */
  contextEpoch?: number;
  maxActiveAnchors?: number;
  maxSerializedBytes?: number;
  now?: Date;
}

export interface LabelSkillBootstrapEligibilityResult {
  eligible: boolean;
  reason?: 'queued-replay' | 'prior-final-assistant' | 'no-active-anchors' | 'no-candidates';
}

export interface SelectLabelSkillBootstrapCandidatesOptions {
  activeAnchors: ResolvedLabelSkillAnchor[];
  configHash: string;
  previousState?: LabelSkillAnchorState;
  /** Current session context epoch. Defaults to previousState.contextEpoch or 0. */
  contextEpoch?: number;
  messagesBeforeModelCall: Array<{ role: string; isIntermediate?: boolean }>;
  explicitSkillSlugs?: string[];
  isQueuedReplay?: boolean;
  maxBootstrapSkills?: number;
}

export interface LabelSkillBootstrapCandidateSelection {
  eligible: boolean;
  reason?: LabelSkillBootstrapEligibilityResult['reason'];
  anchors: ResolvedLabelSkillAnchor[];
  overflowAnchors: ResolvedLabelSkillAnchor[];
  explicitSkillSlugs: string[];
  maxBootstrapSkills: number;
}

export interface LabelSkillAnchorResolution {
  activeAnchors: ResolvedLabelSkillAnchor[];
  block?: string;
  blockKind: 'active' | 'revocation' | 'none';
  configHash: string;
  warnings: LabelSkillBindingDiagnostic[];
  requiredSourceSlugs: string[];
  nextState: LabelSkillAnchorState;
}
