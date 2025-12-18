import { Button } from "@/components/ui/button"
import { CheckCircle2, Loader2 } from "lucide-react"

interface CompletionStepProps {
  status: 'saving' | 'complete'
  spaceName?: string
  onFinish: () => void
}

/**
 * CompletionStep - Success screen after onboarding
 *
 * Shows:
 * - saving: Spinner while saving configuration
 * - complete: Success message with option to start
 */
export function CompletionStep({
  status,
  spaceName,
  onFinish
}: CompletionStepProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      {/* Icon */}
      <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-green-500/10">
        {status === 'saving' ? (
          <Loader2 className="size-8 text-green-500 animate-spin" />
        ) : (
          <CheckCircle2 className="size-8 text-green-500" />
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl font-semibold tracking-tight">
        {status === 'saving' ? 'Setting up...' : 'You\'re all set!'}
      </h1>

      {/* Description */}
      <p className="mt-3 max-w-sm text-muted-foreground">
        {status === 'saving' ? (
          'Saving your configuration...'
        ) : (
          <>
            {spaceName ? (
              <>Connected to <span className="font-medium text-foreground">{spaceName}</span>. </>
            ) : null}
            Start chatting with Claude to manage your Craft documents.
          </>
        )}
      </p>

      {/* What's next */}
      {status === 'complete' && (
        <div className="mt-6 rounded-lg border border-border bg-muted/50 p-4 text-left">
          <h3 className="text-sm font-medium">What you can do:</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              Search and read your Craft documents
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              Create and edit blocks with natural language
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              Activate custom agents from your Agents folder
            </li>
          </ul>
        </div>
      )}

      {/* Action */}
      {status === 'complete' && (
        <Button onClick={onFinish} className="mt-8" size="lg">
          Start Chatting
        </Button>
      )}
    </div>
  )
}
