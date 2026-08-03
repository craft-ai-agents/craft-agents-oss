import { describe, expect, it } from 'bun:test'
import { stripPythonInterpreterEnvironment } from './python-env'

describe('stripPythonInterpreterEnvironment', () => {
  it('removes Python interpreter controls case-insensitively', () => {
    const env = stripPythonInterpreterEnvironment({
      SAFE_VAR: 'kept',
      PyThOnPaTh: 'poisoned-path',
      pythonhome: 'poisoned-home',
      Virtual_Env: 'poisoned-venv',
    })

    expect(env.SAFE_VAR).toBe('kept')
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('PYTHONPATH')
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('PYTHONHOME')
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain('VIRTUAL_ENV')
  })
})