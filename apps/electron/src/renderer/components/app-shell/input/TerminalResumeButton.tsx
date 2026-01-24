import { useState } from 'react'
import { Terminal, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface TerminalResumeButtonProps {
  sessionId: string
  sdkSessionId?: string
  workingDirectory?: string
  disabled?: boolean
}

/**
 * Button that spawns a terminal window with the current Claude Agent SDK session resumed.
 * Only shown when the session has an SDK session ID (after first agent response).
 *
 * @example
 * ```tsx
 * <TerminalResumeButton
 *   sessionId="ses-abc123"
 *   sdkSessionId="sdk-session-xyz"
 *   workingDirectory="/Users/name/project"
 *   disabled={isProcessing}
 * />
 * ```
 */
export function TerminalResumeButton({
  sessionId,
  sdkSessionId,
  workingDirectory,
  disabled = false,
}: TerminalResumeButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  // Only enable if SDK session exists and not disabled
  const isEnabled = Boolean(sdkSessionId) && !disabled && !isLoading

  const handleClick = async () => {
    // Prevent rapid clicks / multi-spawn
    if (isLoading) {
      return
    }

    if (!sdkSessionId) {
      toast.error('No SDK session available', {
        description: 'Wait for the agent to respond first',
      })
      return
    }

    setIsLoading(true)

    try {
      const result = await window.electronAPI.resumeInTerminal(sessionId)

      if (result.success) {
        toast.success('Terminal opened with session resumed', {
          description: workingDirectory
            ? `Working directory: ${workingDirectory}`
            : 'Session resumed successfully',
        })
      } else {
        // Provide actionable error messages with recovery hints
        const errorMsg = result.error || 'Unknown error occurred'
        const isCliError = errorMsg.toLowerCase().includes('claude cli')
        const isDirectoryError = errorMsg.toLowerCase().includes('directory')

        toast.error('Failed to open terminal', {
          description: errorMsg,
          duration: isCliError ? 8000 : 5000, // Longer duration for CLI install errors
          action: isCliError
            ? {
                label: 'Install Guide',
                onClick: () => window.open('https://code.claude.com', '_blank'),
              }
            : undefined,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const isCliError = errorMessage.toLowerCase().includes('claude cli')

      toast.error('Failed to open terminal', {
        description: errorMessage,
        duration: isCliError ? 8000 : 5000,
        action: isCliError
          ? {
              label: 'Install Guide',
              onClick: () => window.open('https://code.claude.com', '_blank'),
            }
          : undefined,
      })
      console.error('Terminal resume error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Don't render if no SDK session (button should be hidden, not just disabled)
  if (!sdkSessionId) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-[6px]"
          onClick={handleClick}
          disabled={!isEnabled}
          aria-label="Open in Terminal (resume session)"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Terminal className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isLoading ? (
          <p>Opening terminal...</p>
        ) : disabled ? (
          <p>Terminal resume unavailable during processing</p>
        ) : (
          <div className="space-y-1">
            <p className="font-medium">Open in Terminal (resume session)</p>
            {workingDirectory && (
              <p className="text-xs text-muted-foreground">
                Directory: {workingDirectory}
              </p>
            )}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
