/**
 * Tests for HookSystem facade
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HookSystem, type SessionMetadataSnapshot } from './hook-system.ts';

describe('HookSystem', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hook-system-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create a HookSystem without hooks.json', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      expect(system.isDisposed()).toBe(false);
      expect(system.getConfig()).toEqual({ hooks: {} });

      await system.dispose();
    });

    it('should load hooks.json if present', async () => {
      writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
        hooks: {
          LabelAdd: [
            {
              matcher: 'test',
              hooks: [{ type: 'command', command: 'echo hello' }],
            },
          ],
        },
      }));

      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const config = system.getConfig();
      expect(config?.hooks.LabelAdd).toHaveLength(1);

      await system.dispose();
    });

    it('should handle invalid hooks.json gracefully', async () => {
      writeFileSync(join(tempDir, 'hooks.json'), 'invalid json');

      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      expect(system.getConfig()).toEqual({ hooks: {} });

      await system.dispose();
    });
  });

  describe('reloadConfig', () => {
    it('should reload hooks.json', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      expect(system.getConfig()).toEqual({ hooks: {} });

      // Create hooks.json
      writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
        hooks: {
          LabelAdd: [
            {
              matcher: 'test',
              hooks: [{ type: 'command', command: 'echo hello' }],
            },
          ],
        },
      }));

      const result = system.reloadConfig();
      expect(result.success).toBe(true);
      expect(result.hookCount).toBe(1);
      expect(system.getConfig()?.hooks.LabelAdd).toHaveLength(1);

      await system.dispose();
    });

    it('should return errors for invalid config', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      // Invalid JSON structure (hooks must have at least one hook)
      writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
        hooks: {
          LabelAdd: [
            { matcher: 'test', hooks: 'not-an-array' }, // Invalid: hooks should be an array
          ],
        },
      }));

      const result = system.reloadConfig();
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      await system.dispose();
    });

    it('should ignore unknown event types with warning', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      // Unknown events are filtered out with a warning, not an error
      writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
        hooks: {
          UnknownEvent: [
            { matcher: 'test', hooks: [{ type: 'command', command: 'echo test' }] },
          ],
        },
      }));

      const result = system.reloadConfig();
      expect(result.success).toBe(true); // Unknown events are ignored, not errors
      expect(result.hookCount).toBe(0); // No valid hooks

      await system.dispose();
    });
  });

  describe('getMatchersForEvent', () => {
    it('should return matchers for configured events', async () => {
      writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
        hooks: {
          LabelAdd: [
            { matcher: 'test1', hooks: [{ type: 'command', command: 'echo 1' }] },
            { matcher: 'test2', hooks: [{ type: 'command', command: 'echo 2' }] },
          ],
        },
      }));

      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const matchers = system.getMatchersForEvent('LabelAdd');
      expect(matchers).toHaveLength(2);
      expect(matchers[0]?.matcher).toBe('test1');

      await system.dispose();
    });

    it('should return empty array for unconfigured events', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const matchers = system.getMatchersForEvent('LabelAdd');
      expect(matchers).toEqual([]);

      await system.dispose();
    });
  });

  describe('updateSessionMetadata', () => {
    it('should emit PermissionModeChange event', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        permissionMode: 'execute',
      });

      expect(events).toContain('PermissionModeChange');
      expect(emitSpy).toHaveBeenCalledWith('PermissionModeChange', expect.objectContaining({
        sessionId: 'session-1',
        oldMode: '',
        newMode: 'execute',
      }));

      await system.dispose();
    });

    it('should emit LabelAdd event for new labels', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        labels: ['label-1', 'label-2'],
      });

      expect(events).toContain('LabelAdd');
      expect(emitSpy).toHaveBeenCalledWith('LabelAdd', expect.objectContaining({
        label: 'label-1',
      }));
      expect(emitSpy).toHaveBeenCalledWith('LabelAdd', expect.objectContaining({
        label: 'label-2',
      }));

      await system.dispose();
    });

    it('should emit LabelRemove event for removed labels', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      // Set initial state
      system.setInitialSessionMetadata('session-1', {
        labels: ['label-1', 'label-2'],
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        labels: ['label-1'], // label-2 removed
      });

      expect(events).toContain('LabelRemove');
      expect(emitSpy).toHaveBeenCalledWith('LabelRemove', expect.objectContaining({
        label: 'label-2',
      }));

      await system.dispose();
    });

    it('should emit FlagChange event', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        isFlagged: true,
      });

      expect(events).toContain('FlagChange');
      expect(emitSpy).toHaveBeenCalledWith('FlagChange', expect.objectContaining({
        isFlagged: true,
      }));

      await system.dispose();
    });

    it('should emit TodoStateChange event', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      system.setInitialSessionMetadata('session-1', {
        todoState: 'todo',
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        todoState: 'done',
      });

      expect(events).toContain('TodoStateChange');
      expect(emitSpy).toHaveBeenCalledWith('TodoStateChange', expect.objectContaining({
        oldState: 'todo',
        newState: 'done',
      }));

      await system.dispose();
    });

    it('should not emit events when metadata unchanged', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      system.setInitialSessionMetadata('session-1', {
        permissionMode: 'explore',
        labels: ['label-1'],
        isFlagged: false,
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        permissionMode: 'explore',
        labels: ['label-1'],
        isFlagged: false,
      });

      expect(events).toEqual([]);
      expect(emitSpy).not.toHaveBeenCalled();

      await system.dispose();
    });

    it('should update stored metadata', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      await system.updateSessionMetadata('session-1', {
        permissionMode: 'execute',
        labels: ['label-1'],
      });

      const stored = system.getSessionMetadata('session-1');
      expect(stored?.permissionMode).toBe('execute');
      expect(stored?.labels).toEqual(['label-1']);

      await system.dispose();
    });
  });

  describe('removeSessionMetadata', () => {
    it('should remove stored metadata', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      system.setInitialSessionMetadata('session-1', {
        permissionMode: 'explore',
      });

      expect(system.getSessionMetadata('session-1')).toBeDefined();

      system.removeSessionMetadata('session-1');

      expect(system.getSessionMetadata('session-1')).toBeUndefined();

      await system.dispose();
    });
  });

  describe('emitLabelConfigChange', () => {
    it('should emit LabelConfigChange event', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      const emitSpy = vi.spyOn(system.eventBus, 'emit');

      await system.emitLabelConfigChange();

      expect(emitSpy).toHaveBeenCalledWith('LabelConfigChange', expect.objectContaining({
        workspaceId: 'test-workspace',
      }));

      await system.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      system.setInitialSessionMetadata('session-1', { permissionMode: 'explore' });

      await system.dispose();

      expect(system.isDisposed()).toBe(true);
      expect(system.eventBus.isDisposed()).toBe(true);
      expect(system.getSessionMetadata('session-1')).toBeUndefined();
    });

    it('should be idempotent', async () => {
      const system = new HookSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
      });

      await system.dispose();
      await system.dispose(); // Should not throw
      expect(system.isDisposed()).toBe(true);
    });
  });
});
