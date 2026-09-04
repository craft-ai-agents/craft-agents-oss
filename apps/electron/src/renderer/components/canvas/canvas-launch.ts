// Transient navigation intent only; no credentials or business materials in browser storage.
const pending = new Map<string, string>()
export function queueCanvasWorkflow(workspaceId: string, workflowId: string) { pending.set(workspaceId, workflowId) }
export function takeCanvasWorkflow(workspaceId: string) { const id = pending.get(workspaceId); pending.delete(workspaceId); return id }
