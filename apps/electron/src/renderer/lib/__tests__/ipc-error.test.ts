import { describe, expect, it } from 'bun:test'
import { ipcErrorMessage } from '../ipc-error'

describe('ipcErrorMessage', () => {
  it('drops the wrapper Electron puts around an error thrown in main', () => {
    const error = new Error("Error invoking remote method 'crafty:createSession': Error: Couldn't reach the server of “Work”: Connection failed")
    expect(ipcErrorMessage(error)).toBe("Couldn't reach the server of “Work”: Connection failed")
  })

  it('drops it when the thrown value had no "Error:" name either', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'x:y': boom"))).toBe('boom')
  })

  it('reads a thrown value that is not an Error', () => {
    expect(ipcErrorMessage('plain')).toBe('plain')
  })

  it('leaves other messages alone', () => {
    expect(ipcErrorMessage(new Error('Request timeout: sessions:get (30000ms)'))).toBe('Request timeout: sessions:get (30000ms)')
  })
})
