/**
 * AddWorkspaceWizard - Simple wizard for adding a new workspace
 *
 * Separate from onboarding - this is a focused 2-step flow:
 * 1. Select Space (with loading state while checking auth)
 * 2. Complete
 *
 * If login is needed, shows login step first.
 */
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/loading-indicator"
import { SpaceSelectionStep, type SpaceCategory } from "@/components/onboarding"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import type { AddWorkspaceState } from "@/hooks/useAddWorkspace"

interface AddWorkspaceWizardProps {
  state: AddWorkspaceState
  spaceCategories: SpaceCategory[]
  onLogin: () => void
  onSelectSpace: (spaceId: string, spaceName: string) => void
  onContinue: () => void
  onBack: () => void
  onCancel: () => void
  className?: string
}

/**
 * Simple 2-dot progress indicator
 */
function ProgressDots({ currentStep }: { currentStep: AddWorkspaceState['step'] }) {
  const isFirstStep = currentStep === 'loading' || currentStep === 'login' || currentStep === 'select-space'
  const isSecondStep = currentStep === 'saving' || currentStep === 'complete'

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "size-2 rounded-full transition-all duration-200",
          isSecondStep ? "bg-primary" : "bg-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-background"
        )}
      />
      <div
        className={cn(
          "size-2 rounded-full transition-all duration-200",
          isSecondStep ? "bg-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-background" : "bg-muted-foreground/30"
        )}
      />
    </div>
  )
}

/**
 * Loading state while checking auth or saving
 */
function LoadingStep({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Spinner className="text-2xl text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/**
 * Login required step
 */
function LoginStep({
  onLogin,
  onCancel,
  errorMessage
}: {
  onLogin: () => void
  onCancel: () => void
  errorMessage?: string
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="flex size-16 items-center justify-center">
        <CraftAgentsSymbol className="size-10" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">Sign in to Craft</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to access your Craft spaces.
        </p>
      </div>
      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onLogin}>
          Sign in with Craft
        </Button>
      </div>
    </div>
  )
}

/**
 * Completion step
 */
function CompleteStep({
  spaceName,
  onFinish
}: {
  spaceName?: string
  onFinish: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="flex size-16 items-center justify-center">
        <CraftAgentsSymbol className="size-10" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">Workspace Added</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {spaceName && (
            <>Connected to <span className="font-medium text-foreground">{spaceName}</span>. </>
          )}
          You can now start chatting.
        </p>
      </div>
      <Button onClick={onFinish} className="w-full max-w-xs">
        Done
      </Button>
    </div>
  )
}

/**
 * Error step
 */
function ErrorStep({
  message,
  onRetry,
  onCancel
}: {
  message: string
  onRetry: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <span className="text-2xl">!</span>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onRetry}>
          Try Again
        </Button>
      </div>
    </div>
  )
}

export function AddWorkspaceWizard({
  state,
  spaceCategories,
  onLogin,
  onSelectSpace,
  onContinue,
  onBack,
  onCancel,
  className,
}: AddWorkspaceWizardProps) {
  const renderStep = () => {
    switch (state.step) {
      case 'loading':
        return <LoadingStep message="Loading your spaces..." />

      case 'login':
        return (
          <LoginStep
            onLogin={onLogin}
            onCancel={onCancel}
            errorMessage={state.errorMessage}
          />
        )

      case 'select-space':
        return (
          <SpaceSelectionStep
            categories={spaceCategories}
            selectedSpaceId={state.selectedSpaceId}
            onSelect={onSelectSpace}
            onContinue={onContinue}
            onBack={onBack}
            onCancel={onCancel}
          />
        )

      case 'saving':
        return <LoadingStep message="Setting up workspace..." />

      case 'complete':
        return (
          <CompleteStep
            spaceName={state.selectedSpaceName ?? undefined}
            onFinish={onContinue}
          />
        )

      case 'error':
        return (
          <ErrorStep
            message={state.errorMessage || 'An error occurred'}
            onRetry={onContinue}
            onCancel={onCancel}
          />
        )

      default:
        return null
    }
  }

  return (
    <div className={cn("flex min-h-screen flex-col bg-background", className)}>
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-40" />

      {/* Header with progress indicator */}
      <header className="flex h-14 items-center justify-center px-4">
        <ProgressDots currentStep={state.step} />
      </header>

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          {renderStep()}
        </div>
      </main>
    </div>
  )
}
