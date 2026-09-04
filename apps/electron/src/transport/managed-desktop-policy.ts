import { RPC_CHANNELS as C } from '@craft-agent/shared/protocol'

// Only native presentation/preferences stay local. Credentials, files, tools,
// sessions, skills, projects and workspace administration must go to the server.
const NATIVE = new Set<string>([
  ...Object.values(C.notification), ...Object.values(C.update),
  C.window.GET_MODE, C.window.CLOSE, C.window.CONFIRM_CLOSE, C.window.CANCEL_CLOSE,
  C.window.SET_TRAFFIC_LIGHTS, C.window.CLOSE_REQUESTED,
  C.theme.GET_SYSTEM_PREFERENCE, C.theme.SYSTEM_CHANGED,
  C.system.VERSIONS, C.system.IS_DEBUG_MODE,
])
export const isManagedNativeChannel = (channel: string): boolean => NATIVE.has(channel)

export function managedWorkspaceResult(channel: string, args: unknown[], workspaceId: string): { value: unknown } | undefined {
  if (channel === C.window.GET_WORKSPACE) return { value: workspaceId }
  if (channel === C.window.SWITCH_WORKSPACE) {
    if (args[0] !== workspaceId) throw new Error('ERP 账号只能使用授权的服务端工作区')
    // The authenticated WS handshake already bound this workspace. Do not call
    // the local switch handler or replace the managed connection.
    return { value: { workspaceId } }
  }
}
