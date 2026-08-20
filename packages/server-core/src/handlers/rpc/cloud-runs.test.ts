/**
 * Handler-level test for cloud-runs RPC surface (local provider leg).
 *
 * Runs the full scenario inside a spawned subprocess with an isolated
 * CRAFT_CONFIG_DIR. Rationale: packages/shared/config/paths.ts captures
 * CRAFT_CONFIG_DIR at module load — under the shared bun test process the
 * module may already be loaded by another test file with the user's real
 * ~/.craft-agent config (provider 'cloudflare'), which leaks into these
 * handlers and flips every assertion (same pattern as
 * apps/electron/src/main/__tests__/i18n-bootstrap.test.ts and
 * packages/shared/src/config/__tests__/storage-startup-migration.test.ts).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runScript(configDir: string, script: string): RunResult {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir, CRAFT_TEST_ROOT: join(import.meta.dir, '..', '..', '..', '..', '..') },
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: join(import.meta.dir, '..', '..', '..', '..', '..'),
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function freshConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-cloud-runs-test-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      cloudRuns: { enabled: true, provider: 'local' },
    }),
  );
  return dir;
}

const SETUP = `
const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');
const { registerCloudRunsHandlers } = await import(process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/cloud-runs.ts');
const handlers = new Map();
const fakeServer = { handle: (ch, fn) => handlers.set(ch, fn) };
const sent = [];
const fakeDeps = {
  sessionManager: {
    getSession: async (sessionId) => ({ id: sessionId, workspaceId: 'ws-test' }),
    sendMessage: async (sessionId, message) => { sent.push({ sessionId, message }); },
  },
};
registerCloudRunsHandlers(fakeServer, fakeDeps);
const invoke = async (channel, ...args) => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error('no handler for ' + channel);
  return handler({}, ...args);
};
`

describe('cloud-runs rpc handlers (local provider)', () => {
  test('GET_CONFIG reflects config.json', () => {
    const dir = freshConfigDir();
    try {
      const r = runScript(dir, SETUP + `
        const cfg = await invoke(RPC_CHANNELS.cloudRuns.GET_CONFIG);
        if (cfg.enabled !== true) throw new Error('enabled !== true: ' + JSON.stringify(cfg));
        if (cfg.provider !== 'local') throw new Error('provider !== local: ' + JSON.stringify(cfg.provider));
        console.log('ok');
      `);
      expect(r.stderr).toBe('');
      expect(r.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing cloudRuns seeds enabled cloudflare defaults; enabled:false preserved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-cloud-runs-seed-'));
    try {
      writeFileSync(
        join(dir, 'config.json'),
        JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null }),
      );
      const seeded = runScript(dir, SETUP + `
        const cfg = await invoke(RPC_CHANNELS.cloudRuns.GET_CONFIG);
        if (cfg.enabled !== true) throw new Error('seed enabled !== true: ' + JSON.stringify(cfg));
        if (cfg.provider !== 'cloudflare') throw new Error('seed provider !== cloudflare: ' + JSON.stringify(cfg.provider));
        if (!cfg.gatewayUrl || !String(cfg.gatewayUrl).includes('workers.dev')) {
          throw new Error('seed gatewayUrl missing workers.dev: ' + JSON.stringify(cfg.gatewayUrl));
        }
        const { readFileSync } = await import('node:fs');
        const stored = JSON.parse(readFileSync(process.env.CRAFT_CONFIG_DIR + '/config.json', 'utf8'));
        if (!stored.cloudRuns) throw new Error('cloudRuns not persisted after seed');
        if (stored.cloudRuns.enabled !== true) throw new Error('persisted enabled !== true');
        if (stored.cloudRuns.provider !== 'cloudflare') throw new Error('persisted provider !== cloudflare');
        console.log('ok');
      `);
      expect(seeded.stderr).toBe('');
      expect(seeded.exitCode).toBe(0);

      writeFileSync(
        join(dir, 'config.json'),
        JSON.stringify({
          workspaces: [],
          activeWorkspaceId: null,
          activeSessionId: null,
          cloudRuns: { enabled: false, provider: 'local' },
        }),
      );
      const preserved = runScript(dir, SETUP + `
        const cfg = await invoke(RPC_CHANNELS.cloudRuns.GET_CONFIG);
        if (cfg.enabled !== false) throw new Error('enabled:false not preserved: ' + JSON.stringify(cfg));
        if (cfg.provider !== 'local') throw new Error('provider local not preserved: ' + JSON.stringify(cfg.provider));
        console.log('ok');
      `);
      expect(preserved.stderr).toBe('');
      expect(preserved.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('schedule list/save/delete handlers', () => {
    const dir = freshConfigDir();
    try {
      const r = runScript(dir, SETUP + `
        for (const ch of [
          RPC_CHANNELS.cloudRuns.LIST_SCHEDULES,
          RPC_CHANNELS.cloudRuns.SAVE_SCHEDULE,
          RPC_CHANNELS.cloudRuns.DELETE_SCHEDULE,
        ]) {
          if (!handlers.has(ch)) throw new Error('missing handler: ' + ch);
        }

        const empty = await invoke(RPC_CHANNELS.cloudRuns.LIST_SCHEDULES);
        if (!Array.isArray(empty) || empty.length !== 0) throw new Error('expected empty schedules: ' + JSON.stringify(empty));

        const saved = await invoke(RPC_CHANNELS.cloudRuns.SAVE_SCHEDULE, {
          schedule: {
            id: 'sched-test-1',
            topic: 'daily brief',
            everyHours: 12,
            sessionId: 'sess-test',
            enabled: true,
          },
        });
        if (!saved?.ok) throw new Error('save failed: ' + JSON.stringify(saved));

        const listed = await invoke(RPC_CHANNELS.cloudRuns.LIST_SCHEDULES);
        if (!Array.isArray(listed) || listed.length !== 1) throw new Error('list after save: ' + JSON.stringify(listed));
        if (listed[0].id !== 'sched-test-1' || listed[0].topic !== 'daily brief' || listed[0].everyHours !== 12) {
          throw new Error('saved schedule mismatch: ' + JSON.stringify(listed[0]));
        }

        const toggled = await invoke(RPC_CHANNELS.cloudRuns.SAVE_SCHEDULE, {
          schedule: { ...listed[0], enabled: false },
        });
        if (!toggled?.ok) throw new Error('toggle save failed: ' + JSON.stringify(toggled));
        const afterToggle = await invoke(RPC_CHANNELS.cloudRuns.LIST_SCHEDULES);
        if (afterToggle[0]?.enabled !== false) throw new Error('toggle not persisted: ' + JSON.stringify(afterToggle));

        const generated = await invoke(RPC_CHANNELS.cloudRuns.SAVE_SCHEDULE, {
          schedule: { topic: 'no-id topic', everyHours: 24, sessionId: 'sess-test', enabled: true },
        });
        if (!generated?.ok || !generated.schedule?.id) throw new Error('id not generated: ' + JSON.stringify(generated));

        const del = await invoke(RPC_CHANNELS.cloudRuns.DELETE_SCHEDULE, { id: 'sched-test-1' });
        if (!del?.ok) throw new Error('delete failed: ' + JSON.stringify(del));
        const afterDel = await invoke(RPC_CHANNELS.cloudRuns.LIST_SCHEDULES);
        if (afterDel.some((s) => s.id === 'sched-test-1')) throw new Error('delete did not remove: ' + JSON.stringify(afterDel));
        console.log('ok');
      `);
      if (r.exitCode !== 0) {
        console.error('STDERR:', r.stderr.slice(0, 2000));
        console.error('STDOUT:', r.stdout.slice(0, 2000));
      }
      expect(r.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('submit → status → list → import → aggregate (+ disabled gate)', () => {
    const dir = freshConfigDir();
    try {
      const r = runScript(dir, SETUP + `
        // SUBMIT → run completes with artifacts
        const workspaceId = 'ws-test';
        const sessionId = 'sess-test';
        const sub = await invoke(RPC_CHANNELS.cloudRuns.SUBMIT, { sessionId, topic: 'test topic', brief: 'do research' });
        const runId = sub.runId ?? sub.id;
        if (!runId) throw new Error('no runId in SUBMIT result: ' + JSON.stringify(sub));

        // poll status until terminal
        const deadline = Date.now() + 25_000;
        let status;
        do {
          await new Promise((r) => setTimeout(r, 250));
          status = await invoke(RPC_CHANNELS.cloudRuns.GET_STATUS, runId);
        } while (status?.state !== 'done' && status?.state !== 'failed' && Date.now() < deadline);
        if (status?.state !== 'done') throw new Error('run did not complete: ' + JSON.stringify(status));

        // LIST contains the submitted run
        const list = await invoke(RPC_CHANNELS.cloudRuns.LIST);
        const items = Array.isArray(list) ? list : list?.runs ?? list?.items ?? [];
        if (!items.some((it) => it?.id === runId || it?.runId === runId)) throw new Error('run not in LIST: ' + JSON.stringify(list).slice(0, 400));

        // IMPORT downloads briefs/artifacts into the workspace dir
        const imported = await invoke(RPC_CHANNELS.cloudRuns.IMPORT, { runId, sessionId });
        if (!imported) throw new Error('IMPORT returned falsy: ' + JSON.stringify(imported));

        // AGGREGATE sends the report prompt into the session
        sent.length = 0;
        await invoke(RPC_CHANNELS.cloudRuns.AGGREGATE, { runId, sessionId });
        if (!sent.some((m) => m.sessionId === sessionId)) throw new Error('AGGREGATE did not send to session: ' + JSON.stringify(sent));

        // disabled feature is enforced
        const { writeFileSync } = await import('node:fs');
        writeFileSync(process.env.CRAFT_CONFIG_DIR + '/config.json', JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, cloudRuns: { enabled: false, provider: 'local' } }));
        const regMod = await import(process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/cloud-runs.ts?fresh');
        let threw = false;
        try {
          // fresh module instance to drop provider cache
          const h2 = new Map();
          regMod.registerCloudRunsHandlers({ handle: (ch, fn) => h2.set(ch, fn) }, fakeDeps);
          await h2.get('cloudRuns:submit')( {}, { sessionId, topic: 'x' });
        } catch (e) { threw = /disabled|not enabled|feature/i.test(String(e?.message ?? e)); }
        if (!threw) throw new Error('disabled feature not enforced');
        console.log('ok');
      `);
      if (r.exitCode !== 0) {
        console.error('STDERR:', r.stderr.slice(0, 2000));
        console.error('STDOUT:', r.stdout.slice(0, 2000));
      }
      expect(r.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
