import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import {
  CRAFT_PI_EPHEMERAL_MAX_BACKOFF_MS,
  CRAFT_PI_EPHEMERAL_QUERY_DEADLINE_MS,
  CRAFT_PI_EPHEMERAL_RETRY_SETTINGS,
  CRAFT_PI_RETRY_SETTINGS,
  compactionReserveFor,
  createCraftSettingsManager,
} from './session-settings.ts';

describe('createCraftSettingsManager', () => {
  it('batches steering without changing follow-up defaults', () => {
    expect(createCraftSettingsManager().getSteeringMode()).toBe('all');
    expect(createCraftSettingsManager().getFollowUpMode()).toBe(SettingsManager.inMemory().getFollowUpMode());
  });
  it('pins the agent-level auto-retry policy', () => {
    const settings = createCraftSettingsManager();
    expect(settings.getRetryEnabled()).toBe(true);
    expect(settings.getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: CRAFT_PI_RETRY_SETTINGS.maxRetries,
      baseDelayMs: CRAFT_PI_RETRY_SETTINGS.baseDelayMs,
      maxAgentDelayMs: CRAFT_PI_RETRY_SETTINGS.maxAgentDelayMs,
    });
  });

  it('enables provider-level (pre-stream) retries that the SDK leaves off by default', () => {
    const settings = createCraftSettingsManager();
    expect(settings.getProviderRetrySettings()).toMatchObject({
      maxRetries: CRAFT_PI_RETRY_SETTINGS.provider.maxRetries,
      maxRetryDelayMs: CRAFT_PI_RETRY_SETTINGS.provider.maxRetryDelayMs,
    });
    // Documents the SDK default this policy overrides. If a future SDK turns
    // provider retries on by itself, this assertion is the cue to revisit.
    expect(SettingsManager.inMemory().getProviderRetrySettings().maxRetries).toBeUndefined();
  });

  it('uses a smaller retry policy for bounded ephemeral queries', () => {
    const settings = createCraftSettingsManager('ephemeral');
    expect(settings.getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.maxRetries,
      baseDelayMs: CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.baseDelayMs,
      maxAgentDelayMs: CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.maxAgentDelayMs,
    });
    expect(settings.getProviderRetrySettings()).toMatchObject({
      maxRetries: CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.provider.maxRetries,
      maxRetryDelayMs: CRAFT_PI_EPHEMERAL_RETRY_SETTINGS.provider.maxRetryDelayMs,
    });
    expect(CRAFT_PI_EPHEMERAL_MAX_BACKOFF_MS).toBe(66_000);
    expect(CRAFT_PI_EPHEMERAL_QUERY_DEADLINE_MS).toBe(115_000);
    expect(CRAFT_PI_EPHEMERAL_MAX_BACKOFF_MS).toBeLessThan(
      CRAFT_PI_EPHEMERAL_QUERY_DEADLINE_MS,
    );
  });

  it('keeps auto-compaction enabled', () => {
    expect(createCraftSettingsManager().getCompactionEnabled()).toBe(true);
  });

  it('warms the prompt cache during chat runs but never for one-shot utility sessions', () => {
    expect(createCraftSettingsManager().getCacheWarmingMode()).toBe('streaming');
    expect(createCraftSettingsManager('ephemeral').getCacheWarmingMode()).toBe('off');
  });

  it('never trusts the working directory as a Pi project', () => {
    // A trusted project auto-loads <cwd>/.pi/extensions (code), skills, prompts
    // and SYSTEM.md. The SDK's in-memory default trusts the project.
    expect(SettingsManager.inMemory().isProjectTrusted()).toBe(true);
    expect(createCraftSettingsManager().isProjectTrusted()).toBe(false);
    expect(createCraftSettingsManager('ephemeral').isProjectTrusted()).toBe(false);
  });

  it('ignores a .pi/settings.json in the working directory', () => {
    // A repo used as the session's working directory may ship Pi project
    // settings. The SDK's default SettingsManager.create(cwd, agentDir) merges
    // them (project scope is trusted by default) — a repo could silently turn
    // off retries or compaction for Craft sessions. The in-memory manager must
    // not see them.
    const cwd = mkdtempSync(join(tmpdir(), 'craft-pi-settings-'));
    try {
      mkdirSync(join(cwd, '.pi'));
      writeFileSync(
        join(cwd, '.pi', 'settings.json'),
        JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }),
      );

      // Proves the default path would have honored the repo file…
      const fromDisk = SettingsManager.create(cwd, join(cwd, 'agent-dir'));
      expect(fromDisk.getRetryEnabled()).toBe(false);
      expect(fromDisk.getCompactionEnabled()).toBe(false);

      // …and that Craft's manager does not.
      const settings = createCraftSettingsManager();
      expect(settings.getRetryEnabled()).toBe(true);
      expect(settings.getCompactionEnabled()).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns a fresh manager per call so sessions cannot leak settings into each other', () => {
    const a = createCraftSettingsManager('ephemeral');
    const b = createCraftSettingsManager('ephemeral');
    expect(a).not.toBe(b);
    a.setRetryEnabled(false);
    expect(a.getRetryEnabled()).toBe(false);
    expect(b.getRetryEnabled()).toBe(true);
  });
});

// "Compact context at" (config.json autoCompactWindow) used to be Claude-only; Pi
// ignored it. Pi compacts at contextWindow - reserveTokens, so it maps to a reserve.
describe('autoCompactWindow ("Compact context at")', () => {
  const opus = { provider: 'anthropic', id: 'claude-opus', contextWindow: 1_000_000 };
  const local = { provider: 'custom-endpoint', id: 'qwen', contextWindow: 131_072 };
  const sdkReserve = SettingsManager.inMemory().getCompactionSettings().reserveTokens;

  it("leaves Pi's reserve untouched when unset", () => {
    expect(createCraftSettingsManager('main').getCompactionSettings(opus).reserveTokens).toBe(sdkReserve);
  });

  it("reserves the rest of the model's window so compaction triggers at the configured size", () => {
    const manager = createCraftSettingsManager('main', { autoCompactWindow: 400_000 });
    expect(manager.getCompactionSettings(opus).reserveTokens).toBe(600_000);
  });

  it('recomputes per model, so switching models keeps the configured threshold', () => {
    const manager = createCraftSettingsManager('main', { autoCompactWindow: 100_000 });
    expect(manager.getCompactionSettings(opus).reserveTokens).toBe(900_000);
    expect(manager.getCompactionSettings(local).reserveTokens).toBe(31_072);
  });

  it("never compacts later than Pi would when the window exceeds the model's", () => {
    const manager = createCraftSettingsManager('main', { autoCompactWindow: 400_000 });
    expect(manager.getCompactionSettings(local).reserveTokens).toBe(sdkReserve);
  });

  it('keeps the SDK reserve when the model is unknown and preserves the other compaction settings', () => {
    const manager = createCraftSettingsManager('main', { autoCompactWindow: 400_000 });
    expect(manager.getCompactionSettings().reserveTokens).toBe(sdkReserve);
    const { enabled, keepRecentTokens } = manager.getCompactionSettings(opus);
    expect({ enabled, keepRecentTokens }).toEqual({
      enabled: true,
      keepRecentTokens: SettingsManager.inMemory().getCompactionSettings().keepRecentTokens,
    });
  });

  it('ignores invalid windows instead of producing a NaN or negative reserve', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, '400000' as unknown as number]) {
      expect(compactionReserveFor(1_000_000, 16_384, bad)).toBe(16_384);
      expect(compactionReserveFor(bad, 16_384, 400_000)).toBe(16_384);
    }
  });
});
