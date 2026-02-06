/**
 * SandboxToggle - Switch toggle for remote sandbox execution
 *
 * Displays next to the working directory badge in cloud workspaces.
 * Handles:
 * - Detecting if working directory is a GitHub repo
 * - Checking GitHub auth status
 * - Initiating OAuth flow when needed (on toggle)
 * - Toggling between local and remote execution
 */

import * as React from 'react'
import { Cloud, Loader2, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { Switch } from '@/components/ui/switch'
import type { GitInfo, SandboxAuthCheckResult } from '../../../../shared/types'

interface SandboxToggleProps {
  /** Current workspace ID */
  workspaceId: string
  /** Is this a cloud workspace? Only show toggle for cloud workspaces */
  isCloudWorkspace: boolean
  /** Current working directory path */
  workingDirectory?: string
  /** Whether remote sandbox mode is enabled */
  isRemote: boolean
  /** Callback when remote mode is toggled */
  onRemoteToggle: (enabled: boolean) => void
  /** Whether the session is currently processing */
  isProcessing?: boolean
  /** Whether this is the first message (can only toggle before starting) */
  isFirstMessage?: boolean
}

type AuthStatus = 'loading' | 'ready' | 'needs-auth' | 'not-github' | 'no-git' | 'error'

export function SandboxToggle({
  workspaceId,
  isCloudWorkspace,
  workingDirectory,
  isRemote,
  onRemoteToggle,
  isProcessing,
  isFirstMessage = true,
}: SandboxToggleProps) {
  const [gitInfo, setGitInfo] = React.useState<GitInfo | null>(null)
  const [authStatus, setAuthStatus] = React.useState<AuthStatus>('loading')
  const [authUrl, setAuthUrl] = React.useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Listen for GitHub OAuth callback
  React.useEffect(() => {
    const unsubscribe = window.electronAPI?.onGitHubOAuthCallback?.((result) => {
      if (result.success && result.repo === gitInfo?.repoKey) {
        // Auth succeeded for this repo - enable remote mode
        setAuthStatus('ready')
        setIsAuthenticating(false)
        onRemoteToggle(true)
      } else if (result.error && result.repo === gitInfo?.repoKey) {
        setError(`Authentication failed: ${result.error}`)
        setAuthStatus('error')
        setIsAuthenticating(false)
      }
    })

    return () => unsubscribe?.()
  }, [gitInfo?.repoKey, onRemoteToggle])

  // Get git info when working directory changes
  React.useEffect(() => {
    if (!workingDirectory || !isCloudWorkspace) {
      setGitInfo(null)
      setAuthStatus('no-git')
      return
    }

    setAuthStatus('loading')
    window.electronAPI?.getGitInfo?.(workingDirectory).then((info: GitInfo | null) => {
      if (info) {
        setGitInfo(info)
        // Now check auth status
        checkAuthStatus(info)
      } else {
        setGitInfo(null)
        setAuthStatus('no-git')
      }
    }).catch(() => {
      setAuthStatus('no-git')
    })
  }, [workingDirectory, isCloudWorkspace, workspaceId])

  const checkAuthStatus = React.useCallback(async (info?: GitInfo) => {
    const gitInfoToUse = info || gitInfo
    if (!gitInfoToUse || !workspaceId) return

    try {
      const result = await window.electronAPI?.sandboxCheckAuth?.(
        workspaceId,
        gitInfoToUse.repoKey,
        gitInfoToUse.repoUrl
      ) as SandboxAuthCheckResult | undefined

      if (result?.ready) {
        setAuthStatus('ready')
        setAuthUrl(null)
      } else if (result?.needsAuth) {
        setAuthStatus('needs-auth')
        setAuthUrl(result.authUrl || null)
      } else {
        setAuthStatus('error')
      }
    } catch (err) {
      console.error('Failed to check sandbox auth:', err)
      setAuthStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to check auth')
    }
  }, [gitInfo, workspaceId])

  const handleToggle = React.useCallback((checked: boolean) => {
    if (!checked) {
      // Turning off - always allowed (if can toggle)
      onRemoteToggle(false)
      return
    }

    // Turning on
    if (authStatus === 'needs-auth' && authUrl) {
      // Need to authenticate first - open OAuth in browser
      setIsAuthenticating(true)
      window.electronAPI?.openUrl?.(authUrl)
      // Don't toggle yet - wait for OAuth callback
      return
    }

    if (authStatus === 'ready') {
      // Already authenticated - toggle on
      onRemoteToggle(true)
    }
  }, [authStatus, authUrl, onRemoteToggle])

  // Don't show for non-cloud workspaces
  if (!isCloudWorkspace) {
    return null
  }

  // Don't show if no working directory
  if (!workingDirectory) {
    return null
  }

  // Don't show if not a git repo
  if (authStatus === 'no-git' || authStatus === 'not-github') {
    return null
  }

  // Can only toggle before first message and when not processing
  const canToggle = isFirstMessage && !isProcessing && !isAuthenticating
  const isLoading = authStatus === 'loading' || isAuthenticating

  const getTooltipContent = () => {
    if (isAuthenticating) {
      return 'Waiting for GitHub authentication...'
    }
    if (!canToggle && !isFirstMessage) {
      return 'Remote mode is locked after sending the first message'
    }
    if (isProcessing) {
      return 'Cannot change while processing'
    }
    switch (authStatus) {
      case 'loading':
        return 'Checking repository...'
      case 'needs-auth':
        return 'Toggle to connect GitHub and enable remote execution'
      case 'ready':
        return isRemote
          ? 'Cloud sandbox enabled - code runs remotely'
          : 'Local execution - toggle to use cloud sandbox'
      case 'error':
        return error || 'Error checking repository'
      default:
        return 'Remote sandbox execution'
    }
  }

  const isDisabled = !canToggle || isLoading || authStatus === 'error'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1.5 h-7 px-2 rounded-[6px] select-none",
            "transition-colors",
            isDisabled && "opacity-50",
            !isDisabled && "hover:bg-foreground/5"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : isRemote ? (
            <Cloud className="h-3.5 w-3.5 text-foreground" />
          ) : (
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Switch
            checked={isRemote}
            onCheckedChange={handleToggle}
            disabled={isDisabled}
            className="scale-[0.85]"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px]">
        <div>{getTooltipContent()}</div>
        {gitInfo && (authStatus === 'ready' || authStatus === 'needs-auth') && (
          <div className="text-xs opacity-70 mt-1">
            {gitInfo.repoKey} ({gitInfo.branch})
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
