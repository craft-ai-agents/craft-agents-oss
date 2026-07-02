import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFakeSyncHarness,
  deleteSharedRecord,
  detectClobberedWrites,
  getPrivateUndoDir,
  getRecordFile,
  listConflictRecords,
  readSharedRecord,
  readSharedRecordBaseline,
  scanProviderConflictedCopies,
  writeSharedRecord,
} from './index.ts';

const roots: string[] = [];
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'runner-records-'));
  roots.push(root);
  process.env.CRAFT_CONFIG_DIR = join(root, 'private');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
});

describe('conflict-safe shared records', () => {
  test('same-machine stale baseline creates a conflict instead of overwriting', () => {
    const workspace = tempRoot();
    const first = writeSharedRecord(workspace, 'community/contacts', 'fan_01', {
      email: 'fan@example.com',
      name: 'Alex',
    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
    expect(first.status).toBe('written');
    if (first.status !== 'written') throw new Error('expected write');

    const stale = first.baseline;
    const second = writeSharedRecord(workspace, 'community/contacts', 'fan_01', {
      email: 'fan@example.com',
      name: 'Alex A',
    }, { machineId: 'machine_a', baseline: stale, now: '2026-07-02T12:01:00.000Z' });
    expect(second.status).toBe('written');

    const conflict = writeSharedRecord(workspace, 'community/contacts', 'fan_01', {
      email: 'fan@example.com',
      name: 'Alex stale',
    }, { machineId: 'machine_a', baseline: stale, now: '2026-07-02T12:02:00.000Z' });

    expect(conflict.status).toBe('conflict');
    expect(readSharedRecord(workspace, 'community/contacts', 'fan_01')?.name).toBe('Alex A');
    expect(listConflictRecords(workspace)).toHaveLength(1);
    if (conflict.status === 'conflict') {
      expect(conflict.conflict.reason).toBe('stale-baseline');
      expect(conflict.conflict.currentRevision).toBe(2);
      expect(conflict.conflict.incoming).toEqual({ email: 'fan@example.com', name: 'Alex stale' });
    }
  });

	  test('fake sync detects a silent last-writer clobber and recovers mine from local cache', () => {
    const root = tempRoot();
    const sync = createFakeSyncHarness(join(root, 'sync'));

    const base = writeSharedRecord(sync.machineA, 'community/contacts', 'fan_02', {
      email: 'fan2@example.com',
      name: 'Base',
    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
    expect(base.status).toBe('written');
    sync.syncAtoB();

    const baselineA = readSharedRecordBaseline(sync.machineA, 'community/contacts', 'fan_02');
    const baselineB = readSharedRecordBaseline(sync.machineB, 'community/contacts', 'fan_02');
    if (!baselineA || !baselineB) throw new Error('missing baselines');

    const mine = writeSharedRecord(sync.machineA, 'community/contacts', 'fan_02', {
      email: 'fan2@example.com',
      name: 'Mine',
    }, { machineId: 'machine_a', baseline: baselineA, now: '2026-07-02T12:01:00.000Z' });
    const theirs = writeSharedRecord(sync.machineB, 'community/contacts', 'fan_02', {
      email: 'fan2@example.com',
      name: 'Theirs',
    }, { machineId: 'machine_b', baseline: baselineB, now: '2026-07-02T12:01:30.000Z' });
    expect(mine.status).toBe('written');
    expect(theirs.status).toBe('written');

    sync.syncBtoA();
    const issues = detectClobberedWrites(sync.machineA, 'machine_a', { now: '2026-07-02T12:05:00.000Z' });
    const repeated = detectClobberedWrites(sync.machineA, 'machine_a', { now: '2026-07-02T12:06:00.000Z' });

    expect(issues).toHaveLength(1);
    expect(repeated).toHaveLength(0);
    expect(issues[0]?.conflict.reason).toBe('clobbered-write');
	    expect((issues[0]?.conflict.current as Record<string, unknown> | undefined)?.name).toBe('Theirs');
	    expect((issues[0]?.conflict.mine as Record<string, unknown> | undefined)?.name).toBe('Mine');
	  });

	  test('resolved clobber conflicts are not recreated on later scans', () => {
	    const root = tempRoot();
	    const sync = createFakeSyncHarness(join(root, 'sync'));
	    const base = writeSharedRecord(sync.machineA, 'community/contacts', 'fan_resolved', {
	      email: 'resolved@example.com',
	      name: 'Base',
	    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
	    if (base.status !== 'written') throw new Error('expected write');
	    sync.syncAtoB();

	    const baselineA = readSharedRecordBaseline(sync.machineA, 'community/contacts', 'fan_resolved');
	    const baselineB = readSharedRecordBaseline(sync.machineB, 'community/contacts', 'fan_resolved');
	    if (!baselineA || !baselineB) throw new Error('missing baselines');
	    writeSharedRecord(sync.machineA, 'community/contacts', 'fan_resolved', {
	      email: 'resolved@example.com',
	      name: 'Mine',
	    }, { machineId: 'machine_a', baseline: baselineA, now: '2026-07-02T12:01:00.000Z' });
	    writeSharedRecord(sync.machineB, 'community/contacts', 'fan_resolved', {
	      email: 'resolved@example.com',
	      name: 'Theirs',
	    }, { machineId: 'machine_b', baseline: baselineB, now: '2026-07-02T12:01:30.000Z' });
	    sync.syncBtoA();

	    const issues = detectClobberedWrites(sync.machineA, 'machine_a', { now: '2026-07-02T12:05:00.000Z' });
	    expect(issues).toHaveLength(1);
	    const conflict = { ...issues[0]!.conflict, status: 'resolved' as const };
	    writeFileSync(join(sync.machineA, 'team', 'conflicts', `${conflict.conflictId}.json`), JSON.stringify(conflict, null, 2), 'utf-8');

	    expect(detectClobberedWrites(sync.machineA, 'machine_a', { now: '2026-07-02T12:06:00.000Z' })).toHaveLength(0);
	    expect(listConflictRecords(sync.machineA)).toHaveLength(1);
	  });

	  test('old clobber oplog entries age out of detection', () => {
	    const workspace = tempRoot();
	    const created = writeSharedRecord(workspace, 'community/contacts', 'fan_old', {
	      email: 'old@example.com',
	      name: 'Old',
	    }, { machineId: 'machine_a', now: '2026-06-01T12:00:00.000Z' });
	    expect(created.status).toBe('written');

	    rmSync(getRecordFile(workspace, 'community/contacts', 'fan_old'), { force: true });

	    expect(detectClobberedWrites(workspace, 'machine_a', { now: '2026-07-02T12:00:00.000Z' })).toHaveLength(0);
	  });

  test('missing record file after a local write creates a clobber conflict', () => {
    const workspace = tempRoot();
    const created = writeSharedRecord(workspace, 'community/contacts', 'fan_missing', {
      email: 'missing@example.com',
      name: 'Missing',
    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
    expect(created.status).toBe('written');

    rmSync(getRecordFile(workspace, 'community/contacts', 'fan_missing'), { force: true });
    const issues = detectClobberedWrites(workspace, 'machine_a', { now: '2026-07-02T12:05:00.000Z' });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.conflict.entityPath).toBe('records/community/contacts/fan_missing.json');
    expect((issues[0]?.conflict.mine as Record<string, unknown> | undefined)?.name).toBe('Missing');
    expect(issues[0]?.conflict.current).toBeNull();
  });

  test('tombstone delete prevents stale PII from remaining in the record file', () => {
    const workspace = tempRoot();
    const created = writeSharedRecord(workspace, 'community/contacts', 'fan_03', {
      email: 'delete@example.com',
      name: 'Delete Me',
      notes: 'private note',
      tags: ['vip'],
      emailHash: 'hash_delete',
    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
    if (created.status !== 'written') throw new Error('expected write');

    const deleted = deleteSharedRecord(workspace, 'community/contacts', 'fan_03', {
      machineId: 'machine_a',
      baseline: created.baseline,
      emailHash: 'hash_delete',
      piiScrub: true,
      eraseUndo: true,
      now: '2026-07-02T12:03:00.000Z',
    });
    expect(deleted.status).toBe('written');

    const raw = JSON.parse(readFileSync(getRecordFile(workspace, 'community/contacts', 'fan_03'), 'utf-8')) as Record<string, unknown>;
    expect(raw.deletedAt).toBe('2026-07-02T12:03:00.000Z');
    expect(raw.emailHash).toBe('hash_delete');
    expect(raw.email).toBeUndefined();
    expect(raw.name).toBeUndefined();
    expect(raw.notes).toBeUndefined();
    expect(raw.tags).toBeUndefined();
    expect(raw.purgeUndoFor).toEqual(['fan_03']);
    expect(existsSync(getPrivateUndoDir(workspace, 'fan_03'))).toBe(false);
  });

  test('provider conflicted-copy files create conflict inbox items', () => {
    const workspace = tempRoot();
    const created = writeSharedRecord(workspace, 'community/contacts', 'fan_04', {
      email: 'copy@example.com',
      name: 'Original',
    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
    expect(created.status).toBe('written');

    const conflictPath = getRecordFile(workspace, 'community/contacts', 'fan_04').replace(/\.json$/, " (Michael's conflicted copy).json");
    rmSync(conflictPath, { force: true });
    writeFileSync(conflictPath, JSON.stringify({ id: 'fan_04', name: 'Copy' }, null, 2), 'utf-8');

    const conflicts = scanProviderConflictedCopies(workspace, {
      machineId: 'machine_a',
      now: '2026-07-02T12:10:00.000Z',
    });
    const repeated = scanProviderConflictedCopies(workspace, {
      machineId: 'machine_a',
      now: '2026-07-02T12:11:00.000Z',
    });
    expect(conflicts).toHaveLength(1);
    expect(repeated).toHaveLength(0);
    expect(conflicts[0]?.reason).toBe('provider-conflicted-copy');
    expect(conflicts[0]?.entityPath).toBe('records/community/contacts/fan_04.json');
    expect(conflicts[0]?.providerConflictPath).toContain("Michael's conflicted copy");
    expect(listConflictRecords(workspace)).toHaveLength(1);
  });
});
