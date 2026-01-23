/**
 * Slack Settings Section
 *
 * Workspace-level Slack integration settings.
 * Allows connecting/disconnecting Slack OAuth and viewing connected workspaces.
 */

import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { MessageSquare, LogOut, Plus, CheckCircle2, XCircle } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import {
  slackConnectionAtom,
  slackWorkspacesAtom,
  slackErrorAtom,
  slackOAuthLoadingAtom,
} from '@/atoms/slack'

export function SlackSettingsSection() {
  const { activeWorkspaceId: workspaceId } = useAppShellContext()
  const [connection, setConnection] = useAtom(slackConnectionAtom)
  const [workspaces, setWorkspaces] = useAtom(slackWorkspacesAtom)
  const [error, setError] = useAtom(slackErrorAtom)
  const [isLoading, setIsLoading] = useAtom(slackOAuthLoadingAtom)
  const [hasCredentials, setHasCredentials] = useState(false)

  // Load Slack connection status when component mounts
  useEffect(() => {
    const loadSlackStatus = async () => {
      if (!workspaceId || !window.electronAPI.slackGetStatus) return
      try {
        const result = await window.electronAPI.slackGetStatus(workspaceId)
        if (result.success && result.connection) {
          setConnection(result.connection)
          if (result.workspaces) {
            setWorkspaces(result.workspaces)
          }
        }
      } catch (error) {
        console.error('Failed to load Slack status:', error)
      }
    }

    const checkCredentials = async () => {
      if (!window.electronAPI.slackHasOAuthCredentials) return
      try {
        const result = await window.electronAPI.slackHasOAuthCredentials()
        setHasCredentials(result)
      } catch (error) {
        console.error('Failed to check Slack credentials:', error)
      }
    }

    loadSlackStatus()
    checkCredentials()
  }, [workspaceId, setConnection, setWorkspaces])

  const handleConnect = async () => {
    if (!workspaceId || !window.electronAPI.slackStartOAuth) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.slackStartOAuth(workspaceId)

      if (result.success && result.connection) {
        setConnection(result.connection)
        // Reload workspaces list
        const statusResult = await window.electronAPI.slackGetStatus(workspaceId)
        if (statusResult.success && statusResult.workspaces) {
          setWorkspaces(statusResult.workspaces)
        }
      } else {
        setError(result.error || 'Failed to connect to Slack')
      }
    } catch (error) {
      console.error('Failed to connect Slack:', error)
      setError('Failed to connect to Slack')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisconnect = async (teamId?: string) => {
    if (!workspaceId || !window.electronAPI.slackDisconnect) return

    const confirmed = confirm(
      'Disconnect Slack? This will remove your OAuth token and you will need to reconnect.'
    )
    if (!confirmed) return

    setIsLoading(true)

    try {
      const result = await window.electronAPI.slackDisconnect(workspaceId, teamId)

      if (result.success) {
        setConnection({ isConnected: false, isConnecting: false })
        setWorkspaces([])
      } else {
        setError(result.error || 'Failed to disconnect')
      }
    } catch (error) {
      console.error('Failed to disconnect Slack:', error)
      setError('Failed to disconnect')
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Show credentials warning if not configured
  if (!hasCredentials) {
    return (
      <SettingsSection title="Slack Integration">
        <SettingsCard>
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium">OAuth Credentials Required</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Slack OAuth is not configured. Set SLACK_OAUTH_CLIENT_ID and
                  SLACK_OAUTH_CLIENT_SECRET environment variables to enable Slack integration.
                </p>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title="Slack Integration">
      <SettingsCard>
        {workspaces.length > 0 ? (
          <>
            {/* Connected workspaces */}
            {workspaces.map((workspace) => (
              <SettingsRow
                key={workspace.teamId}
                label={workspace.teamName}
                description={`Connected ${formatDate(workspace.connectedAt)}`}
                action={
                  <div className="flex items-center gap-2">
                    {connection.isConnected && connection.teamId === workspace.teamId ? (
                      <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <div className="w-2 h-2 rounded-full bg-green-600 dark:bg-green-400" />
                        Active
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        Saved
                      </div>
                    )}
                  </div>
                }
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
              </SettingsRow>
            ))}

            {/* Disconnect button */}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect(workspaces[0]?.teamId)}
                disabled={isLoading}
                className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect Slack
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Not connected - show connect button */}
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-sm font-medium">Connect Slack Workspace</h4>
                <p className="text-xs text-muted-foreground">
                  Connect your Slack workspace to receive notifications and interact with agents
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <Button
                size="sm"
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Connect to Slack
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </SettingsCard>

      {/* How it works */}
      <SettingsCard>
        <div className="p-4 space-y-3">
          <h4 className="text-sm font-medium">How Slack Integration Works</h4>
          <ul className="text-xs text-muted-foreground space-y-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">OAuth Authentication:</strong> Securely connect
                using Slack's OAuth flow with PKCE security
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">Full Workspace Access:</strong> Read channels,
                send messages, manage files, and more
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">Token Management:</strong> Tokens are
                encrypted and stored securely with automatic refresh
              </span>
            </li>
          </ul>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
