import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SkillSummary } from '../../skills/types.ts';
import type { LabelSkillBindingsConfig, ResolvedLabelSkillAnchor } from '../types.ts';
import { loadAndValidateLabelSkillBindingsConfig, saveLabelSkillBindingsConfig, validateLabelSkillBindingsConfig } from '../storage.ts';
import { getLabelSkillBootstrapEligibility, resolveActiveLabelSkillAnchors, selectLabelSkillBootstrapCandidates } from '../runtime.ts';

const NOW = '2026-07-01T00:00:00.000Z';
const metadataHash = 'a'.repeat(64);
const skill: SkillSummary = {
  slug: 'audit',
  metadata: {
    name: 'Audit',
    description: 'Review implementation quality',
    requiredSources: ['linear'],
  },
  source: 'project',
  metadataHash,
  scopeLabel: 'Project: app',
  scopeFingerprint: 'project:fingerprint',
  requiredSources: ['linear'],
};

function config(overrides: Partial<LabelSkillBindingsConfig['bindings'][number]> = {}): LabelSkillBindingsConfig {
  return {
    version: 1,
    bindings: [{
      id: 'binding-one',
      enabled: true,
      labelId: 'review',
      skillSlug: 'audit',
      compactInstruction: 'Review the current change carefully.',
      applyScope: {
        mode: 'source-fingerprint',
        source: 'project',
        metadataHash,
        scopeFingerprint: 'project:fingerprint',
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      ...overrides,
    }],
  };
}

function anchor(overrides: Partial<ResolvedLabelSkillAnchor> = {}): ResolvedLabelSkillAnchor {
  const skillSlug = overrides.skillSlug ?? 'audit';
  const requiredSourceSlugs = overrides.requiredSourceSlugs ?? [];
  return {
    bindingId: overrides.bindingId ?? 'binding-one',
    labelId: overrides.labelId ?? 'review',
    skillSlug,
    skillName: overrides.skillName ?? skillSlug,
    skillRef: overrides.skillRef ?? { slug: skillSlug, name: skillSlug, requiredSources: requiredSourceSlugs.length ? requiredSourceSlugs : undefined },
    compactInstruction: overrides.compactInstruction ?? 'Review the current change carefully.',
    requiredSourceSlugs,
  };
}

describe('label-skill-bindings runtime', () => {
  it('validates duplicate enabled label/skill/scope bindings', () => {
    const cfg = config();
    cfg.bindings.push({ ...cfg.bindings[0]!, id: 'binding-two' });
    const result = validateLabelSkillBindingsConfig(cfg, { labels: [{ id: 'review' }], skills: [skill] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.code === 'duplicate-enabled-binding')).toBe(true);
  });

  it('canonicalizes optional nested fields and strips unknown data', () => {
    const raw = config({
      requiredSourcesSnapshot: [{
        slug: 'linear',
        name: 'Linear',
        type: 'mcp',
        metadataHash,
        absolutePath: '/private/source/path',
      } as never],
      generatedFrom: {
        skillSlug: 'audit',
        skillName: 'Audit',
        skillDescription: 'Review implementation quality',
        skillSource: 'project',
        metadataHash,
        contentHash: 'b'.repeat(64),
        requiredSources: ['linear', 'linear'],
        workingDirectoryHint: 'app',
        generatedAt: '2026-07-01T00:00:00.000Z',
        skillContent: 'full SKILL.md body must not round-trip',
        absolutePath: '/private/skill/path',
      } as never,
      extraBindingField: 'strip-me',
    } as never) as unknown as Record<string, unknown>;
    raw.extraRootField = 'strip-me-too';

    const result = validateLabelSkillBindingsConfig(raw, { labels: [{ id: 'review' }], skills: [skill] });

    expect(result.valid).toBe(true);
    expect((result.config as unknown as Record<string, unknown>).extraRootField).toBeUndefined();
    const binding = result.config.bindings[0]! as unknown as Record<string, unknown>;
    expect(binding.extraBindingField).toBeUndefined();
    expect((result.config.bindings[0]!.requiredSourcesSnapshot![0]! as unknown as Record<string, unknown>).absolutePath).toBeUndefined();
    expect((result.config.bindings[0]!.generatedFrom! as unknown as Record<string, unknown>).skillContent).toBeUndefined();
    expect((result.config.bindings[0]!.generatedFrom! as unknown as Record<string, unknown>).absolutePath).toBeUndefined();
    expect(result.config.bindings[0]!.generatedFrom!.requiredSources).toEqual(['linear']);
  });

  it('saves and reloads only canonical fields', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'label-skill-bindings-'));
    try {
      const raw = config({
        requiredSourcesSnapshot: [{ slug: 'linear', leakedPath: '/private/source' } as never],
        generatedFrom: {
          skillSlug: 'audit',
          skillName: 'Audit',
          skillDescription: 'Review implementation quality',
          skillSource: 'project',
          metadataHash,
          generatedAt: '2026-07-01T00:00:00.000Z',
          workingDirectoryHint: 'app',
          skillContent: 'full SKILL.md body must not be persisted',
        } as never,
        localPath: '/private/skill/path',
      } as never);

      const saved = saveLabelSkillBindingsConfig(tmpRoot, raw, { labels: [{ id: 'review' }], skills: [skill] });
      const onDisk = JSON.parse(readFileSync(join(tmpRoot, 'label-skill-bindings.json'), 'utf-8'));
      const loaded = loadAndValidateLabelSkillBindingsConfig(tmpRoot, { labels: [{ id: 'review' }], skills: [skill] });

      expect(saved.valid).toBe(true);
      expect(onDisk.bindings[0].localPath).toBeUndefined();
      expect(onDisk.bindings[0].requiredSourcesSnapshot[0].leakedPath).toBeUndefined();
      expect(onDisk.bindings[0].generatedFrom.skillContent).toBeUndefined();
      expect(loaded.config).toEqual(saved.config);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects malformed optional snapshots and runtime revokes instead of throwing', () => {
    const malformed = config({
      requiredSourcesSnapshot: { slug: 'linear' } as never,
    });

    const validation = validateLabelSkillBindingsConfig(malformed, { labels: [{ id: 'review' }], skills: [skill] });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some(error => error.code === 'invalid-required-sources-snapshot')).toBe(true);
    expect(validation.config.bindings[0]!.requiredSourcesSnapshot).toBeUndefined();

    const result = resolveActiveLabelSkillAnchors(malformed, {
      sessionLabels: ['review'],
      skills: [skill],
      previousState: { lastActiveBindingIds: ['binding-one'], lastBlockKind: 'active' },
    });
    expect(result.blockKind).toBe('revocation');
    expect(result.block).toContain('revokedBindingIds');
  });

  it('rejects path-like generatedFrom workingDirectoryHint values', () => {
    const result = validateLabelSkillBindingsConfig(config({
      generatedFrom: {
        skillSlug: 'audit',
        skillName: 'Audit',
        skillDescription: 'Review implementation quality',
        skillSource: 'project',
        metadataHash,
        generatedAt: '2026-07-01T00:00:00.000Z',
        workingDirectoryHint: '/private/app',
      },
    }), { labels: [{ id: 'review' }], skills: [skill] });

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.code === 'invalid-working-directory-hint')).toBe(true);
    expect(result.config.bindings[0]!.generatedFrom!.workingDirectoryHint).toBeUndefined();
  });

  it('rejects path-like and oversized applyScope workspaceSlug values', () => {
    const invalidWorkspaceSlugs = [
      '/private/workspace',
      '.',
      '  .  ',
      'workspace/child',
      'workspace\\child',
      '../workspace',
      'workspace..name',
      '~/workspace',
      'C:\\Users\\test\\workspace',
      'C:/Users/test/workspace',
      'a'.repeat(301),
    ];

    for (const workspaceSlug of invalidWorkspaceSlugs) {
      const result = validateLabelSkillBindingsConfig(config({
        applyScope: { mode: 'workspace-slug', workspaceSlug },
      }), { labels: [{ id: 'review' }], skills: [skill] });

      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.code === 'invalid-workspace-scope')).toBe(true);
      expect(result.config.bindings[0]!.applyScope).toEqual({ mode: 'workspace-slug', workspaceSlug: '' });
    }
  });

  it('does not save or import path-like applyScope workspaceSlug values', () => {
    for (const workspaceSlug of ['/private/workspace', '  .  ']) {
      const tmpRoot = mkdtempSync(join(tmpdir(), 'label-skill-bindings-scope-'));
      const pathLikeConfig = config({
        applyScope: { mode: 'workspace-slug', workspaceSlug },
      });

      try {
        expect(() => saveLabelSkillBindingsConfig(tmpRoot, pathLikeConfig, { labels: [{ id: 'review' }], skills: [skill] })).toThrow(/workspaceSlug/);

        writeFileSync(join(tmpRoot, 'label-skill-bindings.json'), `${JSON.stringify(pathLikeConfig, null, 2)}\n`);
        const loaded = loadAndValidateLabelSkillBindingsConfig(tmpRoot, { labels: [{ id: 'review' }], skills: [skill] });

        expect(loaded.valid).toBe(false);
        expect(loaded.errors.some(error => error.code === 'invalid-workspace-scope')).toBe(true);
        expect(loaded.config.bindings[0]!.applyScope).toEqual({ mode: 'workspace-slug', workspaceSlug: '' });
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    }
  });

  it('trims applyScope workspaceSlug before validation, runtime matching, and save', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'label-skill-bindings-scope-'));
    const raw = config({
      applyScope: { mode: 'workspace-slug', workspaceSlug: '  safe-id  ' },
    });

    try {
      const validation = validateLabelSkillBindingsConfig(raw, { labels: [{ id: 'review' }], skills: [skill], workspaceSlug: 'safe-id' });
      expect(validation.valid).toBe(true);
      expect(validation.config.bindings[0]!.applyScope).toEqual({ mode: 'workspace-slug', workspaceSlug: 'safe-id' });

      const runtime = resolveActiveLabelSkillAnchors(raw, {
        sessionLabels: ['review'],
        skills: [skill],
        workspaceSlug: 'safe-id',
      });
      expect(runtime.blockKind).toBe('active');

      const saved = saveLabelSkillBindingsConfig(tmpRoot, raw, { labels: [{ id: 'review' }], skills: [skill], workspaceSlug: 'safe-id' });
      const onDisk = JSON.parse(readFileSync(join(tmpRoot, 'label-skill-bindings.json'), 'utf-8'));
      expect(saved.config.bindings[0]!.applyScope).toEqual({ mode: 'workspace-slug', workspaceSlug: 'safe-id' });
      expect(onDisk.bindings[0].applyScope.workspaceSlug).toBe('safe-id');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('matches valued labels by base label id and builds a hidden active-role block', () => {
    const result = resolveActiveLabelSkillAnchors(config(), {
      sessionLabels: ['review::PR-42'],
      labels: [{ id: 'review' }],
      skills: [skill],
      previousState: undefined,
    });
    expect(result.blockKind).toBe('active');
    expect(result.activeAnchors).toHaveLength(1);
    expect(result.requiredSourceSlugs).toEqual(['linear']);
    expect(result.block).toContain('<label-skill-bindings-context>');
    expect(result.block).toContain('A label-bound skill role is active for this session.');
    expect(result.block).toContain('This is not an explicit [skill:...] mention, but it is still an active runtime role binding.');
    expect(result.block).toContain('Do not claim no skill/role is active while this block is present.');
    expect(result.block).toContain('supersedes prior label-skill compact/bootstrap contexts only');
    expect(result.block).toContain('Review the current change carefully.');
    expect(result.block).toContain('"skillRef"');
    expect(result.block).toContain('"metadataHash"');
    expect(result.block).toContain('"requiredSources"');
    expect(result.block).toContain('re-read the bound SKILL.md');
    expect(result.block).not.toContain('skillFilePath');
    expect(result.block).not.toContain('/private/');
  });

  it('ignores session labels whose base label no longer exists and revokes stale context', () => {
    const result = resolveActiveLabelSkillAnchors(config(), {
      sessionLabels: ['review'],
      labels: [{ id: 'other-label' }],
      skills: [skill],
      previousState: { lastActiveBindingIds: ['binding-one'], lastBlockKind: 'active' },
    });
    expect(result.blockKind).toBe('revocation');
    expect(result.activeAnchors).toHaveLength(0);
    expect(result.block).toContain('No label-bound skill role is active for this session.');
  });

  it('emits revocation when previous anchors existed and none are active now', () => {
    const result = resolveActiveLabelSkillAnchors(config(), {
      sessionLabels: [],
      skills: [skill],
      previousState: { lastActiveBindingIds: ['binding-one'], lastBlockKind: 'active' },
    });
    expect(result.blockKind).toBe('revocation');
    expect(result.block).toContain('revokedBindingIds');
    expect(result.block).toContain('prior label-bound bootstrap/read-derived role instructions only');
    expect(result.block).toContain('does not ask you to disregard independent facts, tool outputs, or direct user instructions');
  });

  it('emits revocation when only previous bootstrap state existed', () => {
    const result = resolveActiveLabelSkillAnchors(config(), {
      sessionLabels: [],
      skills: [skill],
      previousState: {
        lastActiveBindingIds: [],
        bootstrap: {
          configHash: 'old',
          contextEpoch: 0,
          entries: [{ bindingId: 'binding-one', skillSlug: 'audit', status: 'completed', completedAt: NOW }],
          bootstrappedSkillSlugs: ['audit'],
        },
      },
    });
    expect(result.blockKind).toBe('revocation');
    expect(result.nextState.bootstrap?.entries).toEqual([]);
  });

  it('evaluates first-turn bootstrap from pre-model final assistant state', () => {
    expect(getLabelSkillBootstrapEligibility({
      activeAnchorCount: 1,
      messagesBeforeModelCall: [{ role: 'user' }],
    })).toEqual({ eligible: true });

    expect(getLabelSkillBootstrapEligibility({
      activeAnchorCount: 1,
      messagesBeforeModelCall: [{ role: 'user' }, { role: 'error' }],
    })).toEqual({ eligible: true });

    expect(getLabelSkillBootstrapEligibility({
      activeAnchorCount: 1,
      messagesBeforeModelCall: [{ role: 'user' }, { role: 'assistant' }],
    })).toEqual({ eligible: false, reason: 'prior-final-assistant' });

    expect(getLabelSkillBootstrapEligibility({
      activeAnchorCount: 1,
      messagesBeforeModelCall: [{ role: 'user' }, { role: 'assistant' }],
      contextEpoch: 1,
      previousBootstrapContextEpoch: 0,
    })).toEqual({ eligible: true });

    expect(getLabelSkillBootstrapEligibility({
      activeAnchorCount: 1,
      messagesBeforeModelCall: [{ role: 'user' }],
      isQueuedReplay: true,
      contextEpoch: 1,
      previousBootstrapContextEpoch: 0,
    })).toEqual({ eligible: false, reason: 'queued-replay' });
  });

  it('selects first-turn bootstrap candidates with explicit-first dedupe, completion suppression, and overflow', () => {
    const anchors = [
      anchor({ bindingId: 'binding-a', skillSlug: 'explicit', compactInstruction: 'a' }),
      anchor({ bindingId: 'binding-b', skillSlug: 'audit', compactInstruction: 'b' }),
      anchor({ bindingId: 'binding-c', skillSlug: 'plan', compactInstruction: 'c' }),
      anchor({ bindingId: 'binding-d', skillSlug: 'ship', compactInstruction: 'd' }),
    ];

    const selected = selectLabelSkillBootstrapCandidates({
      activeAnchors: anchors,
      configHash: 'hash',
      messagesBeforeModelCall: [],
      explicitSkillSlugs: ['explicit'],
      maxBootstrapSkills: 2,
    });
    expect(selected.anchors.map(anchor => anchor.skillSlug)).toEqual(['audit', 'plan']);
    expect(selected.overflowAnchors.map(anchor => anchor.skillSlug)).toEqual(['ship']);

    const afterCompleted = selectLabelSkillBootstrapCandidates({
      activeAnchors: anchors,
      configHash: 'hash',
      previousState: {
        contextEpoch: 0,
        bootstrap: {
          configHash: 'hash',
          contextEpoch: 0,
          entries: [{ bindingId: 'binding-b', skillSlug: 'audit', status: 'completed', completedAt: NOW }],
          bootstrappedSkillSlugs: ['audit'],
        },
      },
      messagesBeforeModelCall: [],
      explicitSkillSlugs: [],
      maxBootstrapSkills: 2,
    });
    expect(afterCompleted.anchors.map(anchor => anchor.skillSlug)).toEqual(['explicit', 'plan']);
  });

  it('suppresses same-epoch bootstrap after a prior assistant but reboots after a stale compaction epoch', () => {
    const anchors = [anchor({ bindingId: 'binding-b', skillSlug: 'audit' })];
    const previousState = {
      contextEpoch: 1,
      bootstrap: {
        configHash: 'hash',
        contextEpoch: 1,
        entries: [{ bindingId: 'binding-b', skillSlug: 'audit', status: 'completed' as const, completedAt: NOW }],
        bootstrappedSkillSlugs: ['audit'],
      },
    };

    const sameEpoch = selectLabelSkillBootstrapCandidates({
      activeAnchors: anchors,
      configHash: 'hash',
      previousState,
      contextEpoch: 1,
      messagesBeforeModelCall: [{ role: 'assistant' }],
      maxBootstrapSkills: 2,
    });
    expect(sameEpoch.eligible).toBe(false);
    expect(sameEpoch.reason).toBe('prior-final-assistant');

    const staleEpoch = selectLabelSkillBootstrapCandidates({
      activeAnchors: anchors,
      configHash: 'hash',
      previousState: { ...previousState, contextEpoch: 2 },
      contextEpoch: 2,
      messagesBeforeModelCall: [{ role: 'assistant' }],
      maxBootstrapSkills: 2,
    });
    expect(staleEpoch.eligible).toBe(true);
    expect(staleEpoch.anchors.map(anchor => anchor.skillSlug)).toEqual(['audit']);
  });

  it('shortens oversized runtime anchors while preserving skillRef reread guidance', () => {
    const longInstruction = 'x'.repeat(1_500);
    const result = resolveActiveLabelSkillAnchors(config({ compactInstruction: longInstruction }), {
      sessionLabels: ['review'],
      labels: [{ id: 'review' }],
      skills: [skill],
    });

    expect(result.blockKind).toBe('active');
    expect(result.warnings.some(warning => warning.code === 'runtime-anchor-shortened')).toBe(true);
    expect(result.block).toContain('[runtime anchor shortened; re-read bound SKILL.md if needed]');
    expect(result.block).toContain('"skillRef"');
    expect(result.block).toContain('re-read the bound SKILL.md');
  });

  it('serializes safe skillRef metadata without skill description, content, or local paths', () => {
    const result = resolveActiveLabelSkillAnchors(config({
      generatedFrom: {
        skillSlug: 'audit',
        skillName: 'Audit',
        skillDescription: 'Generated description should not be serialized in the runtime block.',
        skillSource: 'project',
        metadataHash,
        contentHash: 'b'.repeat(64),
        requiredSources: ['linear'],
        generatedAt: NOW,
      },
    }), {
      sessionLabels: ['review'],
      labels: [{ id: 'review' }],
      skills: [{ ...skill, contentHash: 'c'.repeat(64) }],
      previousState: undefined,
    });

    expect(result.blockKind).toBe('active');
    expect(result.block).toContain('"skillRef"');
    expect(result.block).toContain('"source": "project"');
    expect(result.block).toContain('"contentHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"');
    expect(result.block).not.toContain('Generated description should not be serialized');
    expect(result.block).not.toContain('full SKILL.md body');
    expect(result.block).not.toContain('/private/skill/path');
  });

  it('skips project bindings when source fingerprint no longer matches', () => {
    const changedSkill = { ...skill, scopeFingerprint: 'project:other' };
    const result = resolveActiveLabelSkillAnchors(config(), {
      sessionLabels: ['review'],
      skills: [changedSkill],
    });
    expect(result.blockKind).toBe('none');
    expect(result.warnings.some(warning => warning.code === 'runtime-scope-mismatch')).toBe(true);
  });
});
