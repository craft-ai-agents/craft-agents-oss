/** Validate inherited context before reading/copying a source transcript. */
export function assertContextSourceScope(
  workspaceId: string,
  projectId: string | undefined,
  source: { workspace: { id: string }; projectId?: string } | undefined,
): void {
  if (!projectId || !source || source.workspace.id !== workspaceId || source.projectId !== projectId) {
    throw new Error('禁止继承其他用户、其他项目或未绑定项目的会话上下文')
  }
}
