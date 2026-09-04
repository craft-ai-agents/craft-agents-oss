export interface StoredDesktopSession {
  serverUrl: string
  encryptedToken: string
  managed?: { wsUrl: string; workspaceId: string }
}

/** Restore the encrypted first-login session during a later app launch. */
export function restoreStoredDesktopSession(serialized: string, deps: {
  normalizeServerUrl: (value: string) => string
  decrypt: (value: Buffer) => string
}): { serverUrl: string; token: string; managed?: StoredDesktopSession['managed'] } {
  const stored = JSON.parse(serialized) as Partial<StoredDesktopSession> | null
  if (!stored || typeof stored.serverUrl !== 'string' || typeof stored.encryptedToken !== 'string' || !stored.encryptedToken) {
    throw new Error('桌面登录状态无效')
  }
  if (stored.managed && (typeof stored.managed.wsUrl !== 'string' || typeof stored.managed.workspaceId !== 'string'
    || !stored.managed.wsUrl || !stored.managed.workspaceId)) throw new Error('桌面企业会话无效')
  const token = deps.decrypt(Buffer.from(stored.encryptedToken, 'base64'))
  if (!token) throw new Error('桌面登录状态已失效')
  return { serverUrl: deps.normalizeServerUrl(stored.serverUrl), token, managed: stored.managed }
}
