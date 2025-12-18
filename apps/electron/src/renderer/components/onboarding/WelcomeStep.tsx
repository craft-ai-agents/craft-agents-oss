import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"

interface WelcomeStepProps {
  onContinue: () => void
  onCancel?: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * Shows different messaging for new vs existing users:
 * - New users: Welcome to Craft Agent
 * - Existing users: Update your billing settings
 */
export function WelcomeStep({
  onContinue,
  onCancel,
  isExistingUser = false
}: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      {/* Icon */}
      <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="size-8 text-primary" />
      </div>

      {/* Title */}
      <h1 className="text-2xl font-semibold tracking-tight">
        {isExistingUser ? 'Update Settings' : 'Welcome to Craft Agent'}
      </h1>

      {/* Description */}
      <p className="mt-3 max-w-sm text-muted-foreground">
        {isExistingUser
          ? 'You can update your billing method or connect a different Craft space.'
          : 'A Claude Code-like interface for managing your Craft documents with AI assistance.'}
      </p>

      {/* Features list for new users */}
      {!isExistingUser && (
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" />
            Connect to your Craft spaces
          </li>
          <li className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" />
            Manage documents with natural language
          </li>
          <li className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" />
            Create and activate custom agents
          </li>
        </ul>
      )}

      {/* Actions */}
      <div className="mt-8 flex gap-3">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={onContinue}>
          {isExistingUser ? 'Continue' : 'Get Started'}
        </Button>
      </div>
    </div>
  )
}
