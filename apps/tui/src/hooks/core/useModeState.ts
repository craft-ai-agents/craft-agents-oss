/**
 * React hook for Mode Manager state using useSyncExternalStore
 *
 * Provides reactive access to mode state without React state duplication.
 * The Mode Manager is the single source of truth.
 */

import { useSyncExternalStore, useCallback } from 'react';
import {
  isModeActive,
  subscribeModeChanges,
  type Mode
} from '@craft-agent/shared/agent/craft-agent';

/**
 * Hook to reactively subscribe to a specific mode's state
 *
 * @param sessionId - The session ID to track mode for (undefined = always false)
 * @param mode - The mode to track
 * @returns boolean indicating if the mode is active
 */
export function useModeState(sessionId: string | undefined, mode: Mode): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!sessionId) return () => {};
      return subscribeModeChanges(sessionId, callback);
    },
    [sessionId]
  );

  const getSnapshot = useCallback(() => {
    if (!sessionId) return false;
    return isModeActive(sessionId, mode);
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
