import { Button } from "@/components/ui/button"
import { ExternalLink, CheckCircle2, XCircle } from "lucide-react"
import { Spinner } from "@/components/ui/loading-indicator"
import { StepFormLayout, BackButton, ContinueButton, type StepIconVariant } from "./primitives"
import { CraftAppIcon } from "@/components/icons/CraftAppIcon"

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

interface CraftLoginStepProps {
  status: LoginStatus
  errorMessage?: string
  onLogin: () => void
  onOpenManually?: () => void
  onBack?: () => void
  onRetry?: () => void
}

const STATUS_CONTENT: Record<LoginStatus, { title: string; description: string }> = {
  idle: {
    title: 'Sign in with Craft',
    description: 'A Craft account is required to use Craft Agents. Sign in or create a new account to continue.',
  },
  waiting: {
    title: 'Waiting for login...',
    description: 'Complete the login in your browser. This window will update automatically.',
  },
  success: {
    title: 'Login successful!',
    description: "You're signed in. Let's select a space to connect.",
  },
  error: {
    title: 'Login failed',
    description: '', // Will use errorMessage prop
  },
}

function getIconForStatus(status: LoginStatus): React.ReactNode {
  switch (status) {
    case 'idle': return null // Use CraftAppIcon instead
    case 'waiting': return <Spinner className="text-2xl" />
    case 'success': return <CheckCircle2 />
    case 'error': return <XCircle />
  }
}

function getIconVariant(status: LoginStatus): StepIconVariant {
  switch (status) {
    case 'idle': return 'none'
    case 'waiting': return 'loading'
    case 'success': return 'success'
    case 'error': return 'error'
  }
}

/**
 * CraftLoginStep - OAuth login with Craft account
 *
 * States:
 * - idle: Ready to start login
 * - waiting: Browser opened, waiting for callback
 * - success: Login successful
 * - error: Login failed
 */
export function CraftLoginStep({
  status,
  errorMessage,
  onLogin,
  onOpenManually,
  onBack,
  onRetry,
}: CraftLoginStepProps) {
  const content = STATUS_CONTENT[status]

  const actions = (
    <>
      {status === 'idle' && (
        <>
          {onBack && <BackButton onClick={onBack} />}
          <ContinueButton onClick={onLogin} className="gap-2">
            <ExternalLink className="size-4" />
            Open Craft Login
          </ContinueButton>
        </>
      )}

      {status === 'waiting' && (
        <>
          {onBack && <BackButton onClick={onBack}>Cancel</BackButton>}
          {onOpenManually && (
            <Button variant="outline" onClick={onOpenManually} className="flex-1 gap-2">
              <ExternalLink className="size-4" />
              Open login page again
            </Button>
          )}
        </>
      )}

      {status === 'success' && (
        <p className="text-sm text-muted-foreground">Continuing automatically...</p>
      )}

      {status === 'error' && (
        <>
          {onBack && <BackButton onClick={onBack} />}
          {onRetry && (
            <ContinueButton onClick={onRetry}>
              Try Again
            </ContinueButton>
          )}
        </>
      )}
    </>
  )

  return (
    <StepFormLayout
      iconElement={status === 'idle' ? (
        <div className="flex size-16 items-center justify-center">
          <CraftAppIcon size={40} />
        </div>
      ) : undefined}
      icon={status !== 'idle' ? getIconForStatus(status) : undefined}
      iconVariant={getIconVariant(status)}
      title={content.title}
      description={status === 'error' ? (errorMessage || 'Something went wrong. Please try again.') : content.description}
      actions={actions}
    />
  )
}
