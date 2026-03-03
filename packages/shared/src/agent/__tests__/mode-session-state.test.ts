import { describe, it, expect } from 'bun:test';
import {
  cleanupModeState,
  formatSessionState,
  getPermissionModeDiagnostics,
  hydratePreviousPermissionMode,
  initializeModeState,
  setPermissionMode,
} from '../mode-manager.ts';

describe('mode transition session_state context', () => {
  it('includes explicit transition metadata after a mode change', () => {
    const sessionId = `mode-transition-${Date.now()}`;

    initializeModeState(sessionId, 'safe');
    setPermissionMode(sessionId, 'allow-all', {
      changedBy: 'user',
      changedAt: '2026-03-02T08:00:00.000Z',
    });

    const diagnostics = getPermissionModeDiagnostics(sessionId);
    expect(diagnostics.permissionMode).toBe('allow-all');
    expect(diagnostics.previousPermissionMode).toBe('safe');
    expect(diagnostics.transitionDisplay).toBe('Explore -> Execute');

    const stateBlock = formatSessionState(sessionId, {
      plansFolderPath: '/tmp/plans',
      dataFolderPath: '/tmp/data',
    });

    expect(stateBlock).toContain('permissionMode: execute');
    expect(stateBlock).toContain('modeTransition: Explore -> Execute');
    expect(stateBlock).toContain('modeChangedBy: user');
    expect(stateBlock).toContain('modeChangedAt: 2026-03-02T08:00:00.000Z');
    expect(stateBlock).toContain('modeVersion: 2');

    cleanupModeState(sessionId);
  });

  it('omits modeTransition when no previous mode exists', () => {
    const sessionId = `mode-no-transition-${Date.now()}`;

    const stateBlock = formatSessionState(sessionId, {
      plansFolderPath: '/tmp/plans',
    });

    expect(stateBlock).toContain('permissionMode: ask to edit');
    expect(stateBlock).not.toContain('modeTransition:');
    expect(stateBlock).toContain('modeVersion: 0');

    cleanupModeState(sessionId);
  });

  it('does not emit a synthetic modeTransition on initial restore', () => {
    const sessionId = `mode-restore-${Date.now()}`;

    initializeModeState(sessionId, 'safe');

    const diagnostics = getPermissionModeDiagnostics(sessionId);
    expect(diagnostics.permissionMode).toBe('safe');
    expect(diagnostics.transitionDisplay).toBeUndefined();

    const stateBlock = formatSessionState(sessionId);
    expect(stateBlock).toContain('permissionMode: explore');
    expect(stateBlock).not.toContain('modeTransition:');
    expect(stateBlock).toContain('modeChangedBy: restore');

    cleanupModeState(sessionId);
  });

  it('restores modeTransition after rehydrating persisted previous mode', () => {
    const sessionId = `mode-rehydrate-${Date.now()}`;

    // Simulate restored current mode after app restart.
    setPermissionMode(sessionId, 'allow-all', { changedBy: 'restore' });
    hydratePreviousPermissionMode(sessionId, 'safe');

    const diagnostics = getPermissionModeDiagnostics(sessionId);
    expect(diagnostics.permissionMode).toBe('allow-all');
    expect(diagnostics.previousPermissionMode).toBe('safe');
    expect(diagnostics.transitionDisplay).toBe('Explore -> Execute');

    const stateBlock = formatSessionState(sessionId);
    expect(stateBlock).toContain('permissionMode: execute');
    expect(stateBlock).toContain('modeTransition: Explore -> Execute');

    cleanupModeState(sessionId);
  });
});
