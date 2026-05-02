import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NotificationEntry } from '@craft-agent/shared/notifications/types';
import { NotificationService } from './NotificationService';

function makeService() {
  const root = mkdtempSync(join(tmpdir(), 'notif-svc-'));
  const emit = mock((_workspaceId: string, _entries: NotificationEntry[]) => {});
  const svc = new NotificationService({
    getWorkspaceRootPath: () => root,
    emitUpdated: emit,
  });
  return { svc, root, emit };
}

const baseInput = {
  workspaceId: 'ws',
  source: 'pulse' as const,
  message: 'Goal stalled',
  urgency: 'normal' as const,
};

describe('NotificationService', () => {
  let svc: NotificationService;
  let root: string;
  let emit: ReturnType<typeof mock>;

  beforeEach(() => {
    ({ svc, root, emit } = makeService());
  });

  it('add writes to disk and emits UPDATED with new entry first', () => {
    const e = svc.add({ ...baseInput });
    expect(e.id).toBeDefined();
    expect(e.createdAt).toBeDefined();
    const path = join(root, 'notifications.json');
    expect(existsSync(path)).toBe(true);
    const persisted = JSON.parse(readFileSync(path, 'utf-8'));
    expect(persisted).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
    const lastCall = emit.mock.calls[emit.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe('ws');
    expect((lastCall[1] as NotificationEntry[])[0]?.id).toBe(e.id);
  });

  it('list returns newest-first', async () => {
    const a = svc.add({ ...baseInput, message: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    const b = svc.add({ ...baseInput, message: 'second' });
    const list = svc.list('ws');
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });

  it('dedupes within 1h window when (message, goalSlug) match', () => {
    const a = svc.add({ ...baseInput, goalSlug: 'g1' });
    const b = svc.add({ ...baseInput, goalSlug: 'g1' });
    expect(b.id).toBe(a.id);
    const list = svc.list('ws');
    expect(list).toHaveLength(1);
  });

  it('does not dedupe when goalSlug differs', () => {
    const a = svc.add({ ...baseInput, goalSlug: 'g1' });
    const b = svc.add({ ...baseInput, goalSlug: 'g2' });
    expect(b.id).not.toBe(a.id);
    expect(svc.list('ws')).toHaveLength(2);
  });

  it('acknowledge sets acknowledgedAt', () => {
    const e = svc.add({ ...baseInput });
    const ack = svc.acknowledge('ws', e.id);
    expect(ack?.acknowledgedAt).toBeDefined();
    expect(svc.acknowledge('ws', 'missing')).toBeNull();
  });

  it('clear returns true and persists clearedAt', () => {
    const e = svc.add({ ...baseInput });
    expect(svc.clear('ws', e.id)).toBe(true);
    const persisted = JSON.parse(readFileSync(join(root, 'notifications.json'), 'utf-8'));
    expect(persisted[0].clearedAt).toBeDefined();
    expect(svc.clear('ws', 'missing')).toBe(false);
  });

  it('clearAll returns count of previously-uncleared entries', () => {
    svc.add({ ...baseInput, message: 'a' });
    svc.add({ ...baseInput, message: 'b' });
    const e3 = svc.add({ ...baseInput, message: 'c' });
    svc.clear('ws', e3.id);
    const cleared = svc.clearAll('ws');
    expect(cleared).toBe(2);
    const remaining = svc.list('ws').filter((e) => !e.clearedAt);
    expect(remaining).toHaveLength(0);
  });

  it('recordResponse only writes on awaitingResponse entries', () => {
    const ask = svc.add({ ...baseInput, message: 'q?', awaitingResponse: true });
    const updated = svc.recordResponse('ws', ask.id, 'yes');
    expect(updated?.userResponse).toBe('yes');
    expect(updated?.awaitingResponse).toBe(false);

    const plain = svc.add({ ...baseInput, message: 'plain' });
    expect(svc.recordResponse('ws', plain.id, 'nope')).toBeNull();
  });
});
