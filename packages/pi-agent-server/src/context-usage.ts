import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { PiContextUsagePayload } from '../../shared/src/agent/backend/pi/protocol.ts';

type ContextSession = Pick<AgentSession, 'getContextUsage' | 'settingsManager' | 'model'>;

/** Capture SDK-owned values synchronously at a boundary, never billable lastUsage. */
export function readContextUsage(session: ContextSession): PiContextUsagePayload {
  // Metadata must not break a completed model turn/compaction if unavailable.
  let contextUsage: PiContextUsagePayload['contextUsage'];
  let compactionSettings: PiContextUsagePayload['compactionSettings'];
  try {
    contextUsage = session.getContextUsage();
  } catch { /* fail soft: no invented count */ }
  try {
    // Pass the model like the SDK's own compaction checks do: the reserve is per model.
    const { enabled, reserveTokens } = session.settingsManager.getCompactionSettings(session.model);
    compactionSettings = { enabled, reserveTokens };
  } catch { /* fail soft: no guessed SDK reserve */ }
  return {
    ...(contextUsage && { contextUsage }),
    ...(compactionSettings && { compactionSettings }),
  };
}

/** message_end listeners run before SDK journal append; read after it commits. */
export function deferContextUsage<T extends ContextSession>(
  session: T,
  getCurrentSession: () => T | null,
  emit: (payload: PiContextUsagePayload) => void,
): void {
  queueMicrotask(() => {
    if (getCurrentSession() !== session) return;
    emit(readContextUsage(session));
  });
}
