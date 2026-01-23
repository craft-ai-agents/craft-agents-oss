/**
 * useOrchestrationEvents Hook
 *
 * Listens for real-time orchestration events from the main process.
 * Used for GitHub connection updates, report status changes, etc.
 */

import { useEffect, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import {
  githubConnectionAtom,
  dailyReportDraftAtom,
  latestReportAtom,
} from '@/atoms/orchestration';

export interface OrchestrationEvent {
  type:
    | 'connection-status-updated'
    | 'report-created'
    | 'report-submitted'
    | 'triage-completed'
    | 'sync-started'
    | 'sync-completed'
    | 'error';
  [key: string]: unknown;
}

/**
 * Hook to listen for orchestration events
 *
 * Automatically updates Jotai atoms when events are received.
 * Optional callback for custom event handling.
 */
export function useOrchestrationEvents(
  onEvent?: (event: OrchestrationEvent) => void
): void {
  const setConnection = useSetAtom(githubConnectionAtom);
  const setDraft = useSetAtom(dailyReportDraftAtom);
  const setLatestReport = useSetAtom(latestReportAtom);

  const handleOrchestrationEvent = useCallback(
    (event: OrchestrationEvent) => {
      // Handle different event types
      if (event.type === 'connection-status-updated') {
        const status = (event as any).status;
        setConnection(status);
      } else if (event.type === 'report-created') {
        const report = (event as any).report;
        setDraft(report);
      } else if (event.type === 'report-submitted') {
        const report = (event as any).report;
        setLatestReport(report);
        setDraft(null);
      } else if (event.type === 'error') {
        console.error('Orchestration error:', (event as any).error);
      }

      // Call optional user callback
      onEvent?.(event);
    },
    [setConnection, setDraft, setLatestReport, onEvent]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      return;
    }

    // Register listener
    const unsubscribe = window.electronAPI.onOrchestrationEvent(
      handleOrchestrationEvent
    );

    // Cleanup on unmount
    return () => {
      unsubscribe();
    };
  }, [handleOrchestrationEvent]);
}

/**
 * Hook to listen for a specific event type
 *
 * Useful when you only care about one type of event
 */
export function useOrchestrationEventType<T extends OrchestrationEvent['type']>(
  eventType: T,
  callback: (event: OrchestrationEvent) => void
): void {
  useOrchestrationEvents(
    useCallback(
      (event) => {
        if (event.type === eventType) {
          callback(event);
        }
      },
      [eventType, callback]
    )
  );
}
