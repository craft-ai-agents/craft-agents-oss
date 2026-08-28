/**
 * Tests for RetentionHandler
 */

import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { WorkspaceEventBus } from '../event-bus.ts';
import { RetentionHandler } from './retention-handler.ts';
import type { RetentionHandlerOptions, RetentionResult } from './types.ts';
import type { RetentionConfig } from '../../workspaces/types.ts';

// Mock the session storage functions
const mockArchiveIdleSessions = jest.fn<() => Promise<number>>().mockResolvedValue(0);
const mockDeleteOldArchivedSessions = jest.fn<() => number>().mockReturnValue(0);

jest.mock('../../sessions/storage.ts', () => ({
  archiveIdleSessions: (...args: unknown[]) => mockArchiveIdleSessions(...args),
  deleteOldArchivedSessions: (...args: unknown[]) => mockDeleteOldArchivedSessions(...args),
}));

function createOptions(overrides: Partial<RetentionHandlerOptions> = {}): RetentionHandlerOptions {
  return {
    workspaceRootPath: '/tmp/test-workspace',
    workspaceId: 'test-workspace',
    getRetentionConfig: () => undefined,
    ...overrides,
  };
}

describe('RetentionHandler', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('test-workspace');
    mockArchiveIdleSessions.mockClear();
    mockDeleteOldArchivedSessions.mockClear();
  });

  afterEach(() => {
    bus.dispose();
  });

  it('should ignore non-SchedulerTick events', async () => {
    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({ autoArchiveAfterDays: 7 }),
    }));
    handler.subscribe(bus);

    await bus.emit('LabelAdd', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      label: 'test',
    });

    expect(mockArchiveIdleSessions).not.toHaveBeenCalled();
    handler.dispose();
  });

  it('should only run when minute is 0 (top of the hour)', async () => {
    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({ autoArchiveAfterDays: 7 }),
    }));
    handler.subscribe(bus);

    // Emit tick at minute 15 — should be skipped
    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '14:15',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).not.toHaveBeenCalled();

    // Emit tick at minute 0 — should run
    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '15:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).toHaveBeenCalledTimes(1);
    handler.dispose();
  });

  it('should not re-run in the same hour', async () => {
    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({ autoArchiveAfterDays: 7 }),
    }));
    handler.subscribe(bus);

    // First tick at 15:00
    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '15:00',
      utcTime: new Date().toISOString(),
    });

    // Second tick at 15:00 (duplicate)
    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '15:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).toHaveBeenCalledTimes(1);
    handler.dispose();
  });

  it('should do nothing when no retention config is set', async () => {
    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => undefined,
    }));
    handler.subscribe(bus);

    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '15:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).not.toHaveBeenCalled();
    expect(mockDeleteOldArchivedSessions).not.toHaveBeenCalled();
    handler.dispose();
  });

  it('should call archiveIdleSessions when autoArchiveAfterDays is configured', async () => {
    mockArchiveIdleSessions.mockResolvedValue(3);

    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({ autoArchiveAfterDays: 7 }),
      getActiveSessionIds: () => ['active-session-1'],
    }));
    handler.subscribe(bus);

    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '10:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).toHaveBeenCalledWith(
      '/tmp/test-workspace',
      7,
      { excludeSessionIds: ['active-session-1'] }
    );
    handler.dispose();
  });

  it('should call deleteOldArchivedSessions when autoDeleteArchivedAfterDays is configured', async () => {
    mockDeleteOldArchivedSessions.mockReturnValue(2);

    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({ autoDeleteArchivedAfterDays: 30 }),
    }));
    handler.subscribe(bus);

    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '10:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockDeleteOldArchivedSessions).toHaveBeenCalledWith(
      '/tmp/test-workspace',
      30
    );
    handler.dispose();
  });

  it('should call both when both are configured', async () => {
    mockArchiveIdleSessions.mockResolvedValue(5);
    mockDeleteOldArchivedSessions.mockReturnValue(2);

    const onRetentionRun = jest.fn();
    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({
        autoArchiveAfterDays: 7,
        autoDeleteArchivedAfterDays: 30,
      }),
      onRetentionRun,
    }));
    handler.subscribe(bus);

    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '10:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).toHaveBeenCalledTimes(1);
    expect(mockDeleteOldArchivedSessions).toHaveBeenCalledTimes(1);
    expect(onRetentionRun).toHaveBeenCalledWith(
      expect.objectContaining({ archived: 5, deleted: 2 })
    );
    handler.dispose();
  });

  it('should run again in a different hour', async () => {
    const handler = new RetentionHandler(createOptions({
      getRetentionConfig: () => ({ autoArchiveAfterDays: 7 }),
    }));
    handler.subscribe(bus);

    // First hour
    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '10:00',
      utcTime: new Date().toISOString(),
    });

    // Different hour
    await bus.emit('SchedulerTick', {
      workspaceId: 'test-workspace',
      timestamp: Date.now(),
      localTime: '11:00',
      utcTime: new Date().toISOString(),
    });

    expect(mockArchiveIdleSessions).toHaveBeenCalledTimes(2);
    handler.dispose();
  });

  it('should clean up on dispose', () => {
    const handler = new RetentionHandler(createOptions());
    handler.subscribe(bus);
    handler.dispose();

    // Should not throw when emitting after dispose
    expect(async () => {
      await bus.emit('SchedulerTick', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        localTime: '10:00',
        utcTime: new Date().toISOString(),
      });
    }).not.toThrow();
  });
});
