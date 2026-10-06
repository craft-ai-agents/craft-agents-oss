import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupModeState, initializeModeState, setGuardedModeActiveResolver } from '../../mode-manager.ts';
import { runPreToolUseChecks } from '../pre-tool-use.ts';
import { permissionsConfigCache } from '../../permissions-config.ts';
import { applyGuardedModeCheck, getGuardedModeCall, needsGuardedModeCheck, type GuardedModeCheck, type GuardedModeCall } from '../guarded-mode.ts';
import type { PreToolUseCheckResult, PreToolUseInput } from '../pre-tool-use.ts';

const SESSION = 'guarded-mode-test';
const originalConfigDir = process.env.CRAFT_CONFIG_DIR;
let configDir: string;
let workspaceRootPath: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'guard-config-'));
  workspaceRootPath = mkdtempSync(join(tmpdir(), 'guard-workspace-'));
  mkdirSync(join(configDir, 'permissions'), { recursive: true });
  writeFileSync(join(configDir, 'permissions', 'default.json'), JSON.stringify({
    version: '2026-09-27',
    allowedBashPatterns: [{ pattern: '^ls\\b', comment: 'list' }],
    allowedMcpPatterns: ['get', 'list'],
    allowedApiEndpoints: [],
    allowedWritePaths: [],
  }));
  process.env.CRAFT_CONFIG_DIR = configDir;
  permissionsConfigCache.clear();
  cleanupModeState(SESSION);
  initializeModeState(SESSION, 'guarded');
  setGuardedModeActiveResolver(() => true);
});

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = originalConfigDir;
  permissionsConfigCache.clear();
  cleanupModeState(SESSION);
  setGuardedModeActiveResolver(null);
  rmSync(configDir, { recursive: true, force: true });
  rmSync(workspaceRootPath, { recursive: true, force: true });
});

function ctx(toolName: string, input: Record<string, unknown>): PreToolUseInput {
  return {
    toolName,
    input,
    sessionId: SESSION,
    permissionMode: 'guarded',
    workspaceRootPath,
    workspaceId: 'ws',
    workingDirectory: '/repo',
    activeSourceSlugs: ['github'],
    allSourceSlugs: ['github'],
    hasSourceActivation: false,
    permissionManager: { isCommandWhitelisted: () => false, getBaseCommand: (c: string) => c, isDomainWhitelisted: () => false } as never,
    prerequisiteManager: { checkPrerequisites: () => ({ allowed: true }), trackBashSkillRead: () => false } as never,
  } as PreToolUseInput;
}

describe('getGuardedModeCall', () => {
  it('skips read-only calls and built-in session tools', () => {
    expect(getGuardedModeCall('Bash', { command: 'ls -la' }, ctx('Bash', {}))).toBeNull();
    expect(getGuardedModeCall('mcp__github__get_issue', { number: 1 }, ctx('mcp__github__get_issue', {}))).toBeNull();
    expect(getGuardedModeCall('mcp__session__set_session_status', {}, ctx('mcp__session__set_session_status', {}))).toBeNull();
    expect(getGuardedModeCall('api_github', { method: 'GET', path: '/repos' }, ctx('api_github', {}))).toBeNull();
    expect(getGuardedModeCall('Read', { file_path: '/x' }, ctx('Read', {}))).toBeNull();
  });

  it('asks, without the model, before a file write outside the project and its session folders', () => {
    const plans = join(workspaceRootPath, 'plans');
    const withFolders = { ...ctx('Write', {}), plansFolderPath: plans };
    expect(getGuardedModeCall('Write', { file_path: '/repo/src/a.ts' }, withFolders)).toBeNull();
    expect(getGuardedModeCall('Edit', { file_path: 'src/a.ts' }, withFolders)).toBeNull();
    expect(getGuardedModeCall('Write', { file_path: join(plans, 'p.md') }, withFolders)).toBeNull();
    expect(getGuardedModeCall('Write', { file_path: '~/.ssh/config' }, withFolders)).toMatchObject({ promptType: 'file_write', alwaysAsk: 'outside_workspace' });
    expect(getGuardedModeCall('MultiEdit', { file_path: '/repo/../other/x.ts' }, withFolders)).toMatchObject({ command: '/other/x.ts' });
  });

  it('judges session tools that Explore blocks, but not session bookkeeping', () => {
    expect(getGuardedModeCall('mcp__session__delete_page', { slug: 'p' }, ctx('mcp__session__delete_page', {}))).toMatchObject({ promptType: 'mcp_mutation' });
    expect(getGuardedModeCall('mcp__session__set_session_labels', {}, ctx('mcp__session__set_session_labels', {}))).toBeNull();
  });

  it('describes writes, MCP mutations and non-GET API calls', () => {
    expect(getGuardedModeCall('Bash', { command: 'git push --force' }, ctx('Bash', {}))).toMatchObject({
      promptType: 'bash', command: 'git push --force', workingDirectory: '/repo',
    });
    expect(getGuardedModeCall('mcp__github__create_issue', { title: 't' }, ctx('mcp__github__create_issue', {}))).toMatchObject({
      promptType: 'mcp_mutation', command: 'mcp__github__create_issue', arguments: { title: 't' },
    });
    expect(getGuardedModeCall('api_github', { method: 'DELETE', path: '/repos/o/r' }, ctx('api_github', {}))).toMatchObject({
      promptType: 'api_mutation',
    });
  });
});

describe('applyGuardedModeCheck', () => {
  const allow: PreToolUseCheckResult = { type: 'allow' };
  // Built per test: the temp workspace only exists after beforeEach.
  const pushCtx = () => ctx('Bash', { command: 'git push --force' });
  const guardOf = (check: GuardedModeCheck['check'], active = true): GuardedModeCheck => ({ isActive: () => active, check });
  const flagging = guardOf(async () => ({ risks: ['external'] }));

  it('leaves the result alone without a check, outside Guarded mode, or for non-allow results', async () => {
    expect(await applyGuardedModeCheck(allow, pushCtx(), undefined)).toBe(allow);
    const block: PreToolUseCheckResult = { type: 'block', reason: 'no' };
    expect(await applyGuardedModeCheck(block, pushCtx(), flagging)).toBe(block);
    initializeModeState(SESSION, 'ask');
    expect(await applyGuardedModeCheck(allow, pushCtx(), flagging)).toBe(allow);
  });

  it('prompts for an outside write without calling the model', async () => {
    let calls = 0;
    const counting = guardOf(async () => { calls++; return { risks: [] }; });
    const result = await applyGuardedModeCheck(allow, ctx('Write', { file_path: '/etc/hosts', content: 'x' }), counting);
    expect(result).toMatchObject({ type: 'prompt', promptType: 'file_write', command: '/etc/hosts' });
    expect(calls).toBe(0);
  });

  it('behaves as Ask while its check cannot run (feature or decision layer off)', async () => {
    setGuardedModeActiveResolver(() => false);
    const result = await runPreToolUseChecks(ctx('Bash', { command: 'git push --force' }));
    expect(result.type).toBe('prompt');
  });

  it('never consults the model in Execute mode', async () => {
    initializeModeState(SESSION, 'allow-all');
    let calls = 0;
    const counting = guardOf(async () => { calls++; return { risks: ['irreversible'] }; });
    expect(needsGuardedModeCheck(allow, { sessionId: SESSION, toolName: 'Bash' }, counting)).toBe(false);
    expect(await applyGuardedModeCheck(allow, pushCtx(), counting)).toBe(allow);
    expect(calls).toBe(0);
  });

  it('does nothing at all while the check is inactive (toggle off or nobody watching)', async () => {
    let calls = 0;
    const inactive = guardOf(async () => { calls++; return { risks: ['external'] }; }, false);
    expect(needsGuardedModeCheck(allow, { sessionId: SESSION, toolName: 'Bash' }, inactive)).toBe(false);
    expect(await applyGuardedModeCheck(allow, pushCtx(), inactive)).toBe(allow);
    expect(calls).toBe(0);
  });

  it('turns a flagged call into a prompt that cannot be remembered', async () => {
    const seen: GuardedModeCall[] = [];
    const result = await applyGuardedModeCheck(allow, pushCtx(), guardOf(async (call) => {
      seen.push(call);
      return { risks: ['irreversible', 'external'] };
    }));
    expect(seen[0]?.command).toBe('git push --force');
    expect(result).toMatchObject({ type: 'prompt', promptType: 'bash', command: 'git push --force' });
    expect((result as { description: string }).description).toContain('Guarded mode (hard to undo, reaches other people or services)');
    expect((result as { remember?: unknown }).remember).toBeUndefined();
  });

  it('judges the command the agent asked for and keeps the rewrite for execution', async () => {
    // A read-only command rewritten by rtk is still read-only: no check.
    let calls = 0;
    const counting = guardOf(async () => { calls++; return { risks: ['external'] }; });
    const rewrittenLs: PreToolUseCheckResult = { type: 'modify', input: { command: 'rtk ls -la' } };
    expect(await applyGuardedModeCheck(rewrittenLs, ctx('Bash', { command: 'ls -la' }), counting)).toBe(rewrittenLs);
    expect(calls).toBe(0);

    const rewrittenPush: PreToolUseCheckResult = { type: 'modify', input: { command: 'rtk git push --force' } };
    const result = await applyGuardedModeCheck(rewrittenPush, pushCtx(), flagging);
    expect(result).toMatchObject({ type: 'prompt', command: 'git push --force', modifiedInput: { command: 'rtk git push --force' } });
  });

  it('re-decides under the current mode when the mode changes while the check thinks', async () => {
    const toExplore = guardOf(async () => {
      initializeModeState(SESSION, 'safe');
      return { risks: [] };
    });
    expect(await applyGuardedModeCheck(allow, pushCtx(), toExplore)).toMatchObject({ type: 'block' });

    // Switching to Execute drops the flag: Execute never prompts.
    initializeModeState(SESSION, 'guarded');
    const toExecute = guardOf(async () => {
      initializeModeState(SESSION, 'allow-all');
      return { risks: ['irreversible'] };
    });
    expect((await applyGuardedModeCheck(allow, pushCtx(), toExecute)).type).not.toBe('prompt');
  });

  it('blocks instead of prompting when the turn stops while the check thinks', async () => {
    const turn = new AbortController();
    const stopping = guardOf(async () => {
      turn.abort();
      return { risks: ['external'] };
    });
    expect(await applyGuardedModeCheck(allow, pushCtx(), stopping, { signal: turn.signal })).toEqual({ type: 'block', reason: 'The turn was stopped.' });
  });

  it('never asks for read-only calls, and runs calls the check answered without a known risk', async () => {
    let calls = 0;
    const counting = guardOf(async () => { calls++; return { risks: [] }; });
    expect(await applyGuardedModeCheck(allow, ctx('Bash', { command: 'ls' }), counting)).toBe(allow);
    expect(calls).toBe(0);
    expect(await applyGuardedModeCheck(allow, pushCtx(), counting)).toBe(allow);
    expect(await applyGuardedModeCheck(allow, pushCtx(), guardOf(async () => ({ risks: ['unknown_risk'] }) as never))).toBe(allow);
  });

  it('asks when the check gives no answer, fails or answers without a risk list', async () => {
    // Before: each of these ran the call as in Execute, unjudged.
    for (const check of [async () => null, async () => { throw new Error('down'); }, async () => ({ risks: 'external' }) as never]) {
      const result = await applyGuardedModeCheck(allow, pushCtx(), guardOf(check));
      expect(result).toMatchObject({ type: 'prompt', promptType: 'bash', command: 'git push --force' });
      expect((result as { description: string }).description).toBe('Guarded mode (could not be checked) · Execute: git push --force');
      expect((result as { remember?: unknown }).remember).toBeUndefined();
    }
  });

  it('still blocks rather than asks when the turn stops and the check gives no answer', async () => {
    const turn = new AbortController();
    const stopped = guardOf(async () => { turn.abort(); return null; });
    expect(await applyGuardedModeCheck(allow, pushCtx(), stopped, { signal: turn.signal })).toEqual({ type: 'block', reason: 'The turn was stopped.' });
  });
});
