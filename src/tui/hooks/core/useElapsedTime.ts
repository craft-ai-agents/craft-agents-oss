import { useState, useEffect } from 'react';

export interface UseElapsedTimeOptions {
  startTime: number | null;
  updateInterval?: number;
  enabled?: boolean;
}

/**
 * Hook that tracks elapsed time from a start timestamp with periodic updates.
 * Returns null when disabled or no startTime provided.
 */
export function useElapsedTime({
  startTime,
  updateInterval = 100,
  enabled = true,
}: UseElapsedTimeOptions): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || startTime === null) {
      setElapsed(null);
      return;
    }

    // Set initial value immediately
    setElapsed(Date.now() - startTime);

    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, updateInterval);

    return () => clearInterval(interval);
  }, [startTime, updateInterval, enabled]);

  return elapsed;
}
