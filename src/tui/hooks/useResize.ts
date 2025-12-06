import { useEffect, useState, useRef } from 'react';

/**
 * Hook that handles terminal resize
 * Returns current dimensions for layout calculations
 *
 * On resize: clears screen (debounced) and calls onResize callback.
 * The callback should increment staticResetKey so Static items re-render.
 * Both state updates (callback + setDimensions) batch together in React 18.
 */
export function useResize(onResize?: () => void): { columns: number; rows: number } {
  const [dimensions, setDimensions] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleResize = () => {
      // Debounce: Cancel pending resize if another comes quickly
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        // Clear screen FIRST (like /clear command does)
        // This prevents artifacts from Ink's stale previousLineCount
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

        // Call onResize callback (for staticResetKey) BEFORE setDimensions
        // React 18 batches both state updates into single render
        if (onResize) onResize();

        setDimensions({
          columns: process.stdout.columns || 80,
          rows: process.stdout.rows || 24,
        });
      }, 50); // 50ms debounce - prevents flicker during drag resize
    };

    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [onResize]);

  return dimensions;
}
