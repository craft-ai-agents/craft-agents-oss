export interface DesktopAccountWorkspace {
  workspaceId: string
  executionMode?: 'server_only'
}

/**
 * Local desktop accounts authenticate the user but continue using the
 * window's local workspace. Managed ERP accounts execute on the account
 * server and therefore use the workspace ID returned by that server.
 */
export function preferredWorkspaceIdForDesktopAccount(account: DesktopAccountWorkspace): string | null {
  return account.executionMode === 'server_only' ? account.workspaceId : null
}
