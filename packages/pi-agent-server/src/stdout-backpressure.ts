import type { Writable } from 'node:stream';

/** Tracks the stream's own buffer; does not queue another copy of outgoing data. */
export function createStdoutBackpressure(stream: Writable): {
  write(text: string): void;
  wait(signal?: AbortSignal): Promise<void>;
} {
  let blocked = false;
  let failure: Error | undefined = stream.errored ?? undefined;
  if (!failure && (stream.destroyed || stream.writableEnded)) {
    failure = new Error('stdout is closed');
  }
  // Only active callers waiting for drain are retained, never outgoing messages.
  const waiters = new Set<() => void>();

  function fail(error: Error): void {
    failure ??= error;
    for (const settle of waiters) settle();
  }

  // Keep these listeners for the process-owned stdout lifetime. In particular,
  // an error arriving between writes must be remembered without an unhandled event.
  stream.on('drain', () => {
    blocked = false;
    for (const settle of waiters) settle();
  });
  stream.on('error', fail);
  stream.on('close', () => fail(new Error('stdout is closed')));

  return {
    write(text) {
      if (failure) throw failure;
      if (stream.destroyed || stream.writableEnded) {
        const error = new Error('stdout is closed');
        fail(error);
        throw error;
      }
      try {
        // Bun stdout can return false while writableLength is zero. The write
        // result and drain event are the contract; a later true does not clear it.
        if (!stream.write(text)) blocked = true;
      } catch (error) {
        const writeError = error instanceof Error ? error : new Error(String(error));
        fail(writeError);
        throw writeError;
      }
    },

    wait(signal) {
      if (failure) return Promise.reject(failure);
      // Stopping releases the producer so it can emit terminal events. It does
      // not discard already-written data or mark the shared stream as drained.
      if (!blocked || signal?.aborted) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const settle = () => {
          if (!failure && blocked && !signal?.aborted) return;
          waiters.delete(settle);
          signal?.removeEventListener('abort', settle);
          if (failure) reject(failure);
          else resolve();
        };
        waiters.add(settle);
        signal?.addEventListener('abort', settle, { once: true });
        settle();
      });
    },
  };
}
