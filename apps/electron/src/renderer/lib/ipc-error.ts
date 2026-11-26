/**
 * An error's message for the UI. Electron wraps errors thrown in a main-process `ipcMain.handle`
 * as "Error invoking remote method '<channel>': Error: <message>", and only the message means
 * something to a user. Errors from other calls (the WebSocket RPC) pass through unchanged.
 */
export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
