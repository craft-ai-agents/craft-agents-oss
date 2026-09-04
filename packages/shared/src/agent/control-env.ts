/** Never pass middle-office credentials/session signing keys to model subprocesses.
 * This is defence in depth, not a filesystem/process sandbox.
 */
export function withoutControlSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy={...env}
  for (const name of Object.keys(copy)) {
    if (name.startsWith('JONWORK_SSO_') || name.startsWith('JONWORK_CANVAS_') || name==='JONWORK_MESHY_API_KEY' || name==='JONWORK_CONTROL_BINDINGS'
      || name==='CRAFT_SERVER_TOKEN' || name==='CRAFT_WEBUI_PASSWORD') delete copy[name]
  }
  return copy
}
