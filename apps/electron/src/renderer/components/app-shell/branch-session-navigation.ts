import type { CreateSessionOptions, Session } from "../../../shared/types"
import { routes, type Route } from "../../../shared/routes"

type BranchableSession = Pick<
  Session,
  | 'id'
  | 'workspaceId'
  | 'name'
  | 'llmConnection'
  | 'model'
  | 'permissionMode'
  | 'workingDirectory'
  | 'enabledSourceSlugs'
>

interface BranchSessionNavigationArgs {
  session: BranchableSession
  messageId: string
  createSession: (workspaceId: string, options: CreateSessionOptions) => Promise<Pick<Session, 'id'>>
  navigate: (route: Route) => void | Promise<void>
}

/** Creates a child branch session and navigates the current panel to it. */
export async function createBranchSessionAndNavigate({
  session,
  messageId,
  createSession,
  navigate,
}: BranchSessionNavigationArgs): Promise<Route> {
  const child = await createSession(
    session.workspaceId,
    {
      branchFromMessageId: messageId,
      branchFromSessionId: session.id,
      name: `Branch of ${session.name || 'Untitled'}`,
      llmConnection: session.llmConnection,
      model: session.model,
      permissionMode: session.permissionMode,
      workingDirectory: session.workingDirectory,
      enabledSourceSlugs: session.enabledSourceSlugs,
    }
  )
  const childRoute = routes.view.allSessions(child.id)
  await navigate(childRoute)
  return childRoute
}
