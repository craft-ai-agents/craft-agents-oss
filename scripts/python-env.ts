const PYTHON_CONTROL_VARS = new Set(['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV'])

export function stripPythonInterpreterEnvironment(
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv }
  for (const key of Object.keys(env)) {
    if (PYTHON_CONTROL_VARS.has(key.toUpperCase())) delete env[key]
  }
  return env
}