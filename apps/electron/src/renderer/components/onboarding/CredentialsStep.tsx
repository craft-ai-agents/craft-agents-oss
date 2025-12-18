import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Eye, EyeOff, ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react"
import type { BillingMethod } from "./BillingMethodStep"

export type CredentialStatus = 'idle' | 'validating' | 'success' | 'error'

interface CredentialsStepProps {
  billingMethod: BillingMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (credential: string) => void
  onStartOAuth?: () => void
  onBack: () => void
}

/**
 * CredentialsStep - Enter API key or start OAuth flow
 *
 * For API Key: Shows input field with validation
 * For Claude OAuth: Shows button to start OAuth flow
 */
export function CredentialsStep({
  billingMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack
}: CredentialsStepProps) {
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)

  const isApiKey = billingMethod === 'api_key'
  const isOAuth = billingMethod === 'claude_oauth'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) {
      onSubmit(value.trim())
    }
  }

  // OAuth flow
  if (isOAuth) {
    return (
      <div className="flex flex-col items-center justify-center text-center">
        {/* Status Icon */}
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
          {status === 'validating' && (
            <Loader2 className="size-8 text-primary animate-spin" />
          )}
          {status === 'success' && (
            <CheckCircle2 className="size-8 text-green-500" />
          )}
          {status === 'error' && (
            <XCircle className="size-8 text-destructive" />
          )}
          {status === 'idle' && (
            <svg className="size-8 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {status === 'validating' && 'Connecting...'}
          {status === 'success' && 'Connected!'}
          {status === 'error' && 'Connection failed'}
          {status === 'idle' && 'Connect Claude Account'}
        </h1>

        {/* Description */}
        <p className="mt-3 max-w-sm text-muted-foreground">
          {status === 'validating' && 'Waiting for authentication to complete...'}
          {status === 'success' && 'Your Claude account is connected.'}
          {status === 'error' && (errorMessage || 'Something went wrong. Please try again.')}
          {status === 'idle' && 'Sign in with your Claude Pro or Max subscription to continue.'}
        </p>

        {/* Actions */}
        <div className="mt-8 flex flex-col gap-3">
          {status === 'idle' && (
            <>
              <Button onClick={onStartOAuth} className="gap-2">
                <ExternalLink className="size-4" />
                Sign in with Claude
              </Button>
              <Button variant="ghost" onClick={onBack}>
                Back
              </Button>
            </>
          )}

          {status === 'validating' && (
            <Button variant="ghost" onClick={onBack}>
              Cancel
            </Button>
          )}

          {status === 'error' && (
            <>
              <Button onClick={onStartOAuth}>
                Try Again
              </Button>
              <Button variant="ghost" onClick={onBack}>
                Back
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  // API Key flow
  return (
    <div className="flex w-full max-w-md flex-col">
      {/* Header */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Enter API Key
        </h1>
        <p className="mt-2 text-muted-foreground">
          Get your API key from{' '}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            console.anthropic.com
          </a>
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="api-key">Anthropic API Key</Label>
          <div className="relative">
            <Input
              id="api-key"
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-ant-..."
              className={cn(
                "pr-10",
                status === 'error' && "border-destructive focus-visible:ring-destructive"
              )}
              disabled={status === 'validating'}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showValue ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          {status === 'error' && errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-8 flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            className="flex-1"
            disabled={status === 'validating'}
          >
            Back
          </Button>
          <Button
            type="submit"
            disabled={!value.trim() || status === 'validating'}
            className="flex-1"
          >
            {status === 'validating' ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Validating...
              </>
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
