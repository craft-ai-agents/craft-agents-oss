/**
 * React hook for Mode Manager state using useSyncExternalStore
 *
 * Provides reactive access to mode state without React state duplication.
 * The Mode Manager is the single source of truth.
 */

import { useSyncExternalStore, useCallback } from 'react';
import {
  subscribeModeChanges,
  getPermissionMode,
  type PermissionMode,
} from '@craft-agent/shared/agent/craft-agent';

/**
 * Hook to reactively subscribe to a specific mode's state
 *
 * @param sessionId - The session ID to track mode for (undefined = always false)
 * @param mode - The mode to track
 * @returns boolean indicating if the mode is active
 */
export function useModeState(sessionId: string | undefined, mode: PermissionMode): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!sessionId) return () => {};
      return subscribeModeChanges(sessionId, callback);
    },
    [sessionId]
  );

  const getSnapshot = useCallback(() => {
    if (!sessionId) return false;
    return getPermissionMode(sessionId) === mode;
  }, [sessionId, mode]);

  // Server snapshot is same as client (no SSR considerations for TUI)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Convenience hook for safe mode specifically
 *
 * @param sessionId - The session ID to track safe mode for
 * @returns boolean indicating if safe mode is active
 */
export function useSafeMode(sessionId: string | undefined): boolean {
  return useModeState(sessionId, 'safe');
}

/**
 * Hook to get the current permission mode reactively
 *
 * @param sessionId - The session ID to track permission mode for
 * @returns The current PermissionMode ('safe', 'ask', 'allow-all')
 */
export function usePermissionMode(sessionId: string | undefined): PermissionMode {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!sessionId) return () => {};
      return subscribeModeChanges(sessionId, callback);
    },
    [sessionId]
  );

  const getSnapshot = useCallback((): PermissionMode => {
    if (!sessionId) return 'safe'; // Default to safe if no session
    return getPermissionMode(sessionId);
  }, [sessionId]);

  // Server snapshot is same as client (no SSR considerations for TUI)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
