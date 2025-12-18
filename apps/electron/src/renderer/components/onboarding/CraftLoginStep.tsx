import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react"

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

interface CraftLoginStepProps {
  status: LoginStatus
  errorMessage?: string
  onLogin: () => void
  onOpenManually?: () => void
  onBack: () => void
  onRetry?: () => void
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
  onRetry
}: CraftLoginStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      {/* Status Icon */}
      <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        {status === 'waiting' && (
          <Loader2 className="size-8 text-primary animate-spin" />
        )}
        {status === 'success' && (
          <CheckCircle2 className="size-8 text-green-500" />
        )}
        {status === 'error' && (
          <XCircle className="size-8 text-destructive" />
        )}
        {status === 'idle' && (
          <svg className="size-8 text-primary" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
          </svg>
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl font-semibold tracking-tight">
        {status === 'waiting' && 'Waiting for login...'}
        {status === 'success' && 'Login successful!'}
        {status === 'error' && 'Login failed'}
        {status === 'idle' && 'Sign in with Craft'}
      </h1>

      {/* Description */}
      <p className="mt-3 max-w-sm text-muted-foreground">
        {status === 'waiting' && 'Complete the login in your browser. This window will update automatically.'}
        {status === 'success' && 'You\'re signed in. Let\'s select a space to connect.'}
        {status === 'error' && (errorMessage || 'Something went wrong. Please try again.')}
        {status === 'idle' && 'Connect your Craft account to access your spaces and documents.'}
      </p>

      {/* Actions */}
      <div className="mt-8 flex flex-col gap-3">
        {status === 'idle' && (
          <>
            <Button onClick={onLogin} className="gap-2">
              <ExternalLink className="size-4" />
              Open Craft Login
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          </>
        )}

        {status === 'waiting' && (
          <>
            {onOpenManually && (
              <Button variant="outline" onClick={onOpenManually} className="gap-2">
                <ExternalLink className="size-4" />
                Open login page again
              </Button>
            )}
            <Button variant="ghost" onClick={onBack}>
              Cancel
            </Button>
          </>
        )}

        {status === 'success' && (
          <p className="text-sm text-muted-foreground">Continuing automatically...</p>
        )}

        {status === 'error' && (
          <>
            {onRetry && (
              <Button onClick={onRetry}>
                Try Again
              </Button>
            )}
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
