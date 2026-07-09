import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import type { SkillSource, SkillSummary } from '../skills/types.ts';
import {
  LABEL_SKILL_BINDINGS_FILE,
  LABEL_SKILL_BINDINGS_VERSION,
  type LabelSkillBinding,
  type LabelSkillBindingApplyScope,
  type LabelSkillBindingDiagnostic,
  type LabelSkillBindingGeneratedFrom,
  type LabelSkillBindingsConfig,
  type LabelSkillBindingsContext,
  type LabelSkillBindingsValidationResult,
  type RequiredSourceSnapshotEntry,
} from './types.ts';

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_COMPACT_INSTRUCTION_CHARS = 12_000;
const WARN_COMPACT_INSTRUCTION_CHARS = 1_200;
const MAX_DISPLAY_STRING_CHARS = 2_000;
const MAX_NAME_CHARS = 300;
const MAX_REQUIRED_SOURCES = 50;
const SKILL_SOURCES = new Set<SkillSource>(['global', 'workspace', 'project']);
const SOURCE_TYPES = new Set(['mcp', 'api', 'local']);

export function getDefaultLabelSkillBindingsConfig(): LabelSkillBindingsConfig {
  return { version: LABEL_SKILL_BINDINGS_VERSION, bindings: [] };
}

export function getLabelSkillBindingsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, LABEL_SKILL_BINDINGS_FILE);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(key => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

export function hashLabelSkillBindingsConfig(config: LabelSkillBindingsConfig): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

export function generateLabelSkillBindingId(existingIds: Iterable<string> = []): string {
  const existing = new Set(existingIds);
  for (let i = 0; i < 20; i++) {
    const candidate = `binding-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error('Unable to generate unique label-skill binding id');
}

export function loadLabelSkillBindingsConfig(workspaceRootPath: string): LabelSkillBindingsConfig {
  const filePath = getLabelSkillBindingsPath(workspaceRootPath);
  if (!existsSync(filePath)) return getDefaultLabelSkillBindingsConfig();
  return readJsonFileSync<LabelSkillBindingsConfig>(filePath);
}

export function loadAndValidateLabelSkillBindingsConfig(
  workspaceRootPath: string,
  context: LabelSkillBindingsContext = {},
): LabelSkillBindingsValidationResult {
  try {
    return validateLabelSkillBindingsConfig(loadLabelSkillBindingsConfig(workspaceRootPath), context);
  } catch (error) {
    const config = getDefaultLabelSkillBindingsConfig();
    const diagnostic: LabelSkillBindingDiagnostic = {
      severity: 'error',
      code: 'invalid-json',
      message: error instanceof Error ? error.message : String(error),
    };
    return {
      valid: false,
      config,
      diagnostics: [diagnostic],
      errors: [diagnostic],
      warnings: [],
    };
  }
}

export function saveLabelSkillBindingsConfig(
  workspaceRootPath: string,
  config: LabelSkillBindingsConfig,
  context: LabelSkillBindingsContext = {},
): LabelSkillBindingsValidationResult {
  const validation = validateLabelSkillBindingsConfig(config, context);
  if (!validation.valid) {
    const message = validation.errors.map(d => d.message).join('; ') || 'Invalid label-skill bindings config';
    throw new Error(message);
  }

  const filePath = getLabelSkillBindingsPath(workspaceRootPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(filePath, `${JSON.stringify(validation.config, null, 2)}\n`);
  return validation;
}

export function validateLabelSkillBindingsConfig(
  input: unknown,
  context: LabelSkillBindingsContext = {},
): LabelSkillBindingsValidationResult {
  const diagnostics: LabelSkillBindingDiagnostic[] = [];
  const push = (diagnostic: LabelSkillBindingDiagnostic) => diagnostics.push(diagnostic);
  const config = normalizeRoot(input, push);
  const hasLabelContext = Array.isArray(context.labels);
  const labels = new Set((context.labels ?? []).map(label => label.id));
  const skillsBySlug = new Map((context.skills ?? []).map(skill => [skill.slug, skill] as const));
  const seenIds = new Set<string>();
  const seenEnabledTuples = new Set<string>();

  for (const binding of config.bindings) {
    if (binding.id && seenIds.has(binding.id)) {
      push({ severity: 'error', code: 'duplicate-id', message: `Duplicate binding id: ${binding.id}`, bindingId: binding.id });
    }
    if (binding.id) seenIds.add(binding.id);

    if (binding.enabled && binding.labelId && binding.skillSlug) {
      const tuple = `${binding.labelId}\u0000${binding.skillSlug}\u0000${applyScopeKey(binding.applyScope)}`;
      if (seenEnabledTuples.has(tuple)) {
        push({ severity: 'error', code: 'duplicate-enabled-binding', message: `Duplicate enabled label/skill/scope binding for ${binding.labelId} → ${binding.skillSlug}`, bindingId: binding.id });
      }
      seenEnabledTuples.add(tuple);
    }

    if (hasLabelContext && binding.labelId && !labels.has(binding.labelId)) {
      push({ severity: 'warning', code: 'missing-label', message: `Label "${binding.labelId}" does not exist`, bindingId: binding.id });
    }

    const skill = binding.skillSlug ? skillsBySlug.get(binding.skillSlug) : undefined;
    if (skillsBySlug.size > 0 && binding.skillSlug && !skill) {
      push({ severity: 'warning', code: 'missing-skill', message: `Skill "${binding.skillSlug}" does not exist in the current scope`, bindingId: binding.id });
    }
    if (skill) validateScopeAgainstSkill(binding, skill, context, push);
  }

  config.bindings.sort((a, b) => a.labelId.localeCompare(b.labelId) || a.skillSlug.localeCompare(b.skillSlug) || a.id.localeCompare(b.id));
  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity === 'warning');
  return { valid: errors.length === 0, config, diagnostics, errors, warnings };
}

function normalizeRoot(input: unknown, push: (diagnostic: LabelSkillBindingDiagnostic) => void): LabelSkillBindingsConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    push({ severity: 'error', code: 'invalid-root', message: 'Config must be an object' });
    return getDefaultLabelSkillBindingsConfig();
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== LABEL_SKILL_BINDINGS_VERSION) {
    push({ severity: 'error', code: 'unsupported-version', message: 'label-skill-bindings.json must use version 1' });
  }
  if (!Array.isArray(raw.bindings)) {
    push({ severity: 'error', code: 'invalid-bindings', message: 'bindings must be an array' });
    return getDefaultLabelSkillBindingsConfig();
  }

  const bindings: LabelSkillBinding[] = [];
  raw.bindings.forEach((entry, index) => {
    const binding = normalizeBinding(entry, index, push);
    if (binding) bindings.push(binding);
  });

  // Return a canonical config object only. Unknown root/binding/nested fields are
  // intentionally stripped so GET/SAVE cannot round-trip local paths, raw skill
  // content, or other accidental data added by a malformed client.
  return { version: LABEL_SKILL_BINDINGS_VERSION, bindings };
}

function normalizeBinding(
  input: unknown,
  index: number,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): LabelSkillBinding | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    push({ severity: 'error', code: 'invalid-binding', message: `bindings[${index}] must be an object` });
    return null;
  }

  const raw = input as Record<string, unknown>;
  const bindingId = typeof raw.id === 'string' ? raw.id : undefined;
  const id = normalizeSlug(raw.id, 'id', bindingId, push);
  const labelId = normalizeSlug(raw.labelId, 'labelId', bindingId, push);
  const skillSlug = normalizeSlug(raw.skillSlug, 'skillSlug', bindingId, push);
  const enabled = normalizeBoolean(raw.enabled, 'enabled', bindingId, push);
  const compactInstruction = normalizeCompactInstruction(raw.compactInstruction, enabled, bindingId, push);
  const applyScope = normalizeApplyScope(raw.applyScope, bindingId, push);
  const createdAt = normalizeTimestamp(raw.createdAt, 'createdAt', bindingId, push);
  const updatedAt = normalizeTimestamp(raw.updatedAt, 'updatedAt', bindingId, push);

  const normalized: LabelSkillBinding = {
    id,
    enabled,
    labelId,
    skillSlug,
    compactInstruction,
    applyScope,
    createdAt,
    updatedAt,
  };

  if (Object.prototype.hasOwnProperty.call(raw, 'requiredSourcesSnapshot')) {
    const snapshot = normalizeRequiredSourcesSnapshot(raw.requiredSourcesSnapshot, bindingId, push);
    if (snapshot) normalized.requiredSourcesSnapshot = snapshot;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'generatedFrom')) {
    const generatedFrom = normalizeGeneratedFrom(raw.generatedFrom, bindingId, push);
    if (generatedFrom) normalized.generatedFrom = generatedFrom;
  }

  return normalized;
}

function normalizeSlug(
  value: unknown,
  field: 'id' | 'labelId' | 'skillSlug',
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
    const code = field === 'id' ? 'invalid-id' : field === 'labelId' ? 'invalid-label-id' : 'invalid-skill-slug';
    const label = field === 'labelId' ? 'label id' : field === 'skillSlug' ? 'skill slug' : 'binding id';
    push({ severity: 'error', code, message: `Invalid ${label}: ${String(value)}`, bindingId });
    return '';
  }
  return value;
}

function normalizeBoolean(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): boolean {
  if (typeof value !== 'boolean') {
    push({ severity: 'error', code: `invalid-${field}`, message: `${field} must be boolean`, bindingId });
    return false;
  }
  return value;
}

function normalizeCompactInstruction(
  value: unknown,
  enabled: boolean,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string {
  if (typeof value !== 'string') {
    push({ severity: 'error', code: 'invalid-compact-instruction', message: 'compactInstruction must be a string', bindingId });
    return '';
  }
  const trimmedLength = value.trim().length;
  if (enabled && trimmedLength === 0) {
    push({ severity: 'warning', code: 'empty-enabled-instruction', message: 'Enabled binding has an empty compact instruction and will not apply at runtime', bindingId });
  }
  if (value.length > MAX_COMPACT_INSTRUCTION_CHARS) {
    push({ severity: 'error', code: 'compact-instruction-too-long', message: `compactInstruction exceeds ${MAX_COMPACT_INSTRUCTION_CHARS} characters`, bindingId });
  } else if (value.length > WARN_COMPACT_INSTRUCTION_CHARS) {
    push({ severity: 'warning', code: 'compact-instruction-long', message: `compactInstruction is longer than ${WARN_COMPACT_INSTRUCTION_CHARS} characters`, bindingId });
  }
  return value;
}

function normalizeApplyScope(
  value: unknown,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): LabelSkillBindingApplyScope {
  const fallback: LabelSkillBindingApplyScope = { mode: 'workspace-slug', workspaceSlug: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    push({ severity: 'error', code: 'invalid-scope', message: 'applyScope must be an object', bindingId });
    return fallback;
  }

  const scope = value as Record<string, unknown>;
  if (scope.mode === 'workspace-slug') {
    const workspaceSlug = normalizeWorkspaceSlug(scope.workspaceSlug, bindingId, push);
    if (workspaceSlug === undefined) return fallback;
    return { mode: 'workspace-slug', workspaceSlug };
  }

  if (scope.mode === 'source-fingerprint') {
    const source = scope.source;
    const metadataHash = scope.metadataHash;
    const scopeFingerprint = scope.scopeFingerprint;
    if (typeof source !== 'string' || !SKILL_SOURCES.has(source as SkillSource)) {
      push({ severity: 'error', code: 'invalid-source-scope', message: 'source-fingerprint scope requires a valid source', bindingId });
    }
    if (typeof metadataHash !== 'string' || !SHA256_PATTERN.test(metadataHash)) {
      push({ severity: 'error', code: 'invalid-metadata-hash', message: 'source-fingerprint scope requires a sha256 metadataHash', bindingId });
    }
    if (typeof scopeFingerprint !== 'string' || !scopeFingerprint.trim()) {
      push({ severity: 'error', code: 'invalid-scope-fingerprint', message: 'source-fingerprint scope requires scopeFingerprint', bindingId });
    }
    return {
      mode: 'source-fingerprint',
      source: typeof source === 'string' && SKILL_SOURCES.has(source as SkillSource) ? source as SkillSource : 'workspace',
      metadataHash: typeof metadataHash === 'string' ? metadataHash : '',
      scopeFingerprint: typeof scopeFingerprint === 'string' ? scopeFingerprint : '',
    };
  }

  push({ severity: 'error', code: 'unsupported-scope-mode', message: 'applyScope.mode must be source-fingerprint or workspace-slug', bindingId });
  return fallback;
}

function normalizeTimestamp(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    push({ severity: 'error', code: 'invalid-timestamp', message: `${field} must be an ISO timestamp`, bindingId });
    return '';
  }
  return value;
}

function normalizeRequiredSourcesSnapshot(
  value: unknown,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): RequiredSourceSnapshotEntry[] | undefined {
  if (!Array.isArray(value)) {
    push({ severity: 'error', code: 'invalid-required-sources-snapshot', message: 'requiredSourcesSnapshot must be an array of source metadata objects', bindingId });
    return undefined;
  }
  if (value.length > MAX_REQUIRED_SOURCES) {
    push({ severity: 'error', code: 'too-many-required-sources', message: `requiredSourcesSnapshot cannot include more than ${MAX_REQUIRED_SOURCES} entries`, bindingId });
  }

  const result: RequiredSourceSnapshotEntry[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      push({ severity: 'error', code: 'invalid-required-source-entry', message: `requiredSourcesSnapshot[${index}] must be an object`, bindingId });
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const slug = normalizeOptionalSlug(raw.slug, `requiredSourcesSnapshot[${index}].slug`, bindingId, push);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const normalized: RequiredSourceSnapshotEntry = { slug };
    const name = normalizeOptionalDisplayString(raw.name, `requiredSourcesSnapshot[${index}].name`, bindingId, push, MAX_NAME_CHARS);
    if (name !== undefined) normalized.name = name;
    const type = normalizeSourceType(raw.type, `requiredSourcesSnapshot[${index}].type`, bindingId, push);
    if (type !== undefined) normalized.type = type;
    const metadataHash = normalizeOptionalSha256(raw.metadataHash, `requiredSourcesSnapshot[${index}].metadataHash`, bindingId, push);
    if (metadataHash !== undefined) normalized.metadataHash = metadataHash;
    result.push(normalized);
  }
  return result.sort((a, b) => a.slug.localeCompare(b.slug));
}

function normalizeGeneratedFrom(
  value: unknown,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): LabelSkillBindingGeneratedFrom | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    push({ severity: 'error', code: 'invalid-generated-from', message: 'generatedFrom must be an object', bindingId });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const skillSlug = normalizeOptionalSlug(raw.skillSlug, 'generatedFrom.skillSlug', bindingId, push);
  const skillName = normalizeRequiredDisplayString(raw.skillName, 'generatedFrom.skillName', bindingId, push, MAX_NAME_CHARS);
  const skillDescription = normalizeRequiredDisplayString(raw.skillDescription, 'generatedFrom.skillDescription', bindingId, push, MAX_DISPLAY_STRING_CHARS);
  const skillSource = normalizeSkillSource(raw.skillSource, 'generatedFrom.skillSource', bindingId, push);
  const metadataHash = normalizeRequiredSha256(raw.metadataHash, 'generatedFrom.metadataHash', bindingId, push);
  const generatedAt = normalizeTimestamp(raw.generatedAt, 'generatedFrom.generatedAt', bindingId, push);

  const normalized: LabelSkillBindingGeneratedFrom = {
    skillSlug: skillSlug ?? '',
    skillName,
    skillDescription,
    skillSource,
    metadataHash,
    generatedAt,
  };

  const contentHash = normalizeOptionalSha256(raw.contentHash, 'generatedFrom.contentHash', bindingId, push);
  if (contentHash !== undefined) normalized.contentHash = contentHash;
  if (Object.prototype.hasOwnProperty.call(raw, 'requiredSources')) {
    const requiredSources = normalizeRequiredSourceSlugs(raw.requiredSources, 'generatedFrom.requiredSources', bindingId, push);
    if (requiredSources) normalized.requiredSources = requiredSources;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'workingDirectoryHint')) {
    const workingDirectoryHint = normalizeWorkingDirectoryHint(raw.workingDirectoryHint, bindingId, push);
    if (workingDirectoryHint !== undefined) normalized.workingDirectoryHint = workingDirectoryHint;
  }

  return normalized;
}

function normalizeOptionalSlug(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string | undefined {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
    push({ severity: 'error', code: 'invalid-slug', message: `${field} must be a lowercase slug`, bindingId });
    return undefined;
  }
  return value;
}

function normalizeRequiredDisplayString(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
  maxLength: number,
): string {
  if (value === undefined) {
    push({ severity: 'error', code: 'missing-display-string', message: `${field} is required`, bindingId });
    return '';
  }
  const normalized = normalizeOptionalDisplayString(value, field, bindingId, push, maxLength);
  if (normalized === undefined) return '';
  return normalized;
}

function normalizeOptionalDisplayString(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
  maxLength = MAX_DISPLAY_STRING_CHARS,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    push({ severity: 'error', code: 'invalid-display-string', message: `${field} must be a string`, bindingId });
    return undefined;
  }
  if (value.length > maxLength) {
    push({ severity: 'error', code: 'display-string-too-long', message: `${field} exceeds ${maxLength} characters`, bindingId });
  }
  return value.slice(0, maxLength);
}

function normalizeSourceType(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !SOURCE_TYPES.has(value)) {
    push({ severity: 'error', code: 'invalid-source-type', message: `${field} must be one of: api, local, mcp`, bindingId });
    return undefined;
  }
  return value;
}

function normalizeSkillSource(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): SkillSource {
  if (typeof value !== 'string' || !SKILL_SOURCES.has(value as SkillSource)) {
    push({ severity: 'error', code: 'invalid-skill-source', message: `${field} must be one of: global, workspace, project`, bindingId });
    return 'workspace';
  }
  return value as SkillSource;
}

function normalizeRequiredSha256(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string {
  if (value === undefined) {
    push({ severity: 'error', code: 'missing-sha256', message: `${field} is required`, bindingId });
    return '';
  }
  const normalized = normalizeOptionalSha256(value, field, bindingId, push);
  return normalized ?? '';
}

function normalizeOptionalSha256(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    push({ severity: 'error', code: 'invalid-sha256', message: `${field} must be a sha256 hash`, bindingId });
    return undefined;
  }
  return value;
}

function normalizeRequiredSourceSlugs(
  value: unknown,
  field: string,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string[] | undefined {
  if (!Array.isArray(value)) {
    push({ severity: 'error', code: 'invalid-required-sources', message: `${field} must be an array of source slugs`, bindingId });
    return undefined;
  }
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const slug = normalizeOptionalSlug(item, `${field}[${index}]`, bindingId, push);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs.sort();
}

function normalizeWorkingDirectoryHint(
  value: unknown,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > MAX_NAME_CHARS || isPathLike(value) || value.trim().length === 0) {
    push({ severity: 'error', code: 'invalid-working-directory-hint', message: 'generatedFrom.workingDirectoryHint must be a display-only folder name, not a path', bindingId });
    return undefined;
  }
  return value;
}

function normalizeWorkspaceSlug(
  value: unknown,
  bindingId: string | undefined,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): string | undefined {
  if (typeof value !== 'string') {
    push({ severity: 'error', code: 'invalid-workspace-scope', message: 'workspace-slug scope requires workspaceSlug', bindingId });
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized === '.' || value.length > MAX_NAME_CHARS || normalized.length > MAX_NAME_CHARS || isPathLike(normalized)) {
    push({ severity: 'error', code: 'invalid-workspace-scope', message: 'applyScope.workspaceSlug must be a display-only workspace id/name, not a path', bindingId });
    return undefined;
  }

  return normalized;
}

function isPathLike(value: string): boolean {
  return value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
    || value.startsWith('~')
    || value.includes('..')
    || /^[a-zA-Z]:/.test(value);
}

function validateScopeAgainstSkill(
  binding: LabelSkillBinding,
  skill: SkillSummary,
  context: LabelSkillBindingsContext,
  push: (diagnostic: LabelSkillBindingDiagnostic) => void,
): void {
  if (binding.applyScope.mode === 'workspace-slug') {
    if (context.workspaceSlug && binding.applyScope.workspaceSlug !== context.workspaceSlug) {
      push({ severity: 'warning', code: 'workspace-scope-mismatch', message: `Binding applies to workspace "${binding.applyScope.workspaceSlug}", not "${context.workspaceSlug}"`, bindingId: binding.id });
    }
    return;
  }

  if (binding.applyScope.source !== skill.source || binding.applyScope.scopeFingerprint !== skill.scopeFingerprint) {
    push({ severity: 'warning', code: 'source-scope-mismatch', message: `Binding scope does not match the current ${skill.source} skill scope`, bindingId: binding.id });
  }
  if (binding.applyScope.metadataHash !== skill.metadataHash) {
    push({ severity: 'warning', code: 'skill-metadata-drift', message: `Skill "${binding.skillSlug}" metadata changed since this binding was saved`, bindingId: binding.id });
  }
}

function applyScopeKey(scope: LabelSkillBindingApplyScope): string {
  return stableStringify(scope);
}
