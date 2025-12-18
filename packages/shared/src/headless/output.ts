import type { HeadlessEvent, HeadlessResult } from './types.ts';

/**
 * Format result as plain text (human-readable).
 */
export function formatTextOutput(result: HeadlessResult): string {
  if (!result.success) {
    return `Error: ${result.error?.message || 'Unknown error'}`;
  }
  return result.response || '';
}

/**
 * Format result as JSON.
 */
export function formatJsonOutput(result: HeadlessResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format a single streaming event as JSON (for stream-json mode).
 */
export function formatStreamEvent(event: HeadlessEvent): string {
  return JSON.stringify(event);
}

/**
 * Process streaming events and write output based on format.
 *
 * @param events - Async generator of HeadlessEvent
 * @param format - Output format: 'text', 'json', or 'stream-json'
 * @returns The final HeadlessResult
 */
export async function writeStreamingOutput(
  events: AsyncGenerator<HeadlessEvent>,
  format: 'text' | 'json' | 'stream-json'
): Promise<HeadlessResult> {
  let result: HeadlessResult = { success: false };
  let receivedComplete = false;

  try {
    for await (const event of events) {
      // Handle streaming output based on format
      if (format === 'stream-json') {
        // Stream each event as a JSON line
        console.log(formatStreamEvent(event));
      } else if (format === 'text') {
        // For text mode, only output text deltas (streaming response)
        if (event.type === 'text_delta') {
          process.stdout.write(event.text);
        } else if (event.type === 'error') {
          // Show errors in text mode
          console.error(`\nError: ${event.message}`);
        }
      }
      // For json mode, we collect everything and output at the end

      // Capture the final result
      if (event.type === 'complete') {
        result = event.result;
        receivedComplete = true;
      }
    }
  } catch (error) {
    // Generator threw an exception
    const message = error instanceof Error ? error.message : String(error);
    console.error(`{"type":"error","message":"Generator exception: ${message}"}`);
    result = {
      success: false,
      error: { code: 'execution_error', message: `Generator exception: ${message}` },
    };
  }

  // Safety check: if we never received a complete event, something went wrong
  if (!receivedComplete) {
    const errorMsg = 'No complete event received - generator ended unexpectedly';
    if (format === 'text') {
      console.error(`Error: ${errorMsg}`);
    } else {
      console.error(`{"type":"error","message":"${errorMsg}"}`);
    }
    if (result.success) {
      // This shouldn't happen, but just in case
      result = { success: false, error: { code: 'execution_error', message: errorMsg } };
    }
  }

  // Final output
  if (format === 'text') {
    // Add newline after streaming text
    if (result.response) {
      console.log(); // Final newline
    }
    // If no response but there's an error, show it
    if (!result.success && result.error) {
      console.error(`Error: ${result.error.message}`);
    }
  } else if (format === 'json') {
    // Output complete result as JSON
    console.log(formatJsonOutput(result));
  }
  // stream-json already outputted everything

  return result;
}
