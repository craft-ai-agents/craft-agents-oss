import { useState } from "react"
import { AlertCircle, HelpCircle, AlertTriangle, FileQuestion } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "@/components/onboarding/primitives"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

// Concern types from the agent extraction
export type ConcernType = 'confusing' | 'conflicting' | 'missing' | 'general'

export interface Concern {
  type: ConcernType
  description: string
  context?: string
  suggestedQuestion?: string
  suggestedAnswers?: string[]
}

interface ReviewConcernsStepProps {
  /** Name of the agent */
  agentName: string
  /** List of concerns to review */
  concerns: Concern[]
  /** Called when user submits answers */
  onContinue?: (answers: Record<number, string>) => void
  /** Called when user cancels */
  onCancel?: () => void
  /** Whether submission is in progress */
  isLoading?: boolean
}

const concernTypeConfig: Record<ConcernType, { icon: typeof AlertCircle; label: string; color: string }> = {
  confusing: { icon: HelpCircle, label: 'Unclear', color: 'text-amber-500' },
  conflicting: { icon: AlertTriangle, label: 'Conflict', color: 'text-orange-500' },
  missing: { icon: FileQuestion, label: 'Missing', color: 'text-blue-500' },
  general: { icon: AlertCircle, label: 'Review', color: 'text-muted-foreground' },
}

/**
 * ReviewConcernsStep - User reviews and answers concerns from agent extraction
 *
 * Shows each concern with optional context and suggested question.
 * User can select from suggested answers or type custom response.
 */
export function ReviewConcernsStep({
  agentName,
  concerns,
  onContinue,
  onCancel,
  isLoading = false,
}: ReviewConcernsStepProps) {
  // Track answers for each concern by index
  const [answers, setAnswers] = useState<Record<number, string>>({})
  // Track which concerns are expanded for custom input
  const [customInputs, setCustomInputs] = useState<Record<number, boolean>>({})

  const handleSelectAnswer = (index: number, answer: string) => {
    setAnswers(prev => ({ ...prev, [index]: answer }))
    setCustomInputs(prev => ({ ...prev, [index]: false }))
  }

  const handleCustomAnswer = (index: number, value: string) => {
    setAnswers(prev => ({ ...prev, [index]: value }))
  }

  const toggleCustomInput = (index: number) => {
    setCustomInputs(prev => ({ ...prev, [index]: !prev[index] }))
    // Clear answer when switching to custom
    if (!customInputs[index]) {
      setAnswers(prev => ({ ...prev, [index]: '' }))
    }
  }

  const allAnswered = concerns.every((_, i) => answers[i]?.trim())

  const handleContinue = () => {
    if (allAnswered) {
      onContinue?.(answers)
    }
  }

  return (
    <StepFormLayout
      icon={<AlertCircle />}
      iconVariant="primary"
      title="Review agent setup"
      description={`${agentName} has ${concerns.length} item${concerns.length === 1 ? '' : 's'} that need your input before activation.`}
      actions={
        <>
          <BackButton onClick={onCancel}>Cancel</BackButton>
          <ContinueButton
            onClick={handleContinue}
            disabled={!allAnswered}
            loading={isLoading}
            loadingText="Processing..."
          >
            Continue
          </ContinueButton>
        </>
      }
    >
      <ScrollArea className="h-[320px]">
        <div className="space-y-4 pr-4">
          {concerns.map((concern, index) => {
            const config = concernTypeConfig[concern.type]
            const Icon = config.icon
            const isCustom = customInputs[index]
            const selectedAnswer = answers[index]

            return (
              <div
                key={index}
                className="rounded-lg border border-border/50 bg-foreground/[0.02] p-4"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", config.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px] font-medium">
                        {config.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-foreground">
                      {concern.suggestedQuestion || concern.description}
                    </p>
                    {concern.context && (
                      <p className="mt-2 text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                        "{concern.context}"
                      </p>
                    )}
                  </div>
                </div>

                {/* Answer options */}
                <div className="mt-3 ml-7">
                  {concern.suggestedAnswers && concern.suggestedAnswers.length > 0 && !isCustom && (
                    <div className="flex flex-wrap gap-2">
                      {concern.suggestedAnswers.map((answer, answerIdx) => (
                        <button
                          key={answerIdx}
                          type="button"
                          onClick={() => handleSelectAnswer(index, answer)}
                          className={cn(
                            "px-3 py-1.5 text-xs rounded-md border transition-colors",
                            selectedAnswer === answer
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/50 bg-background hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {answer}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => toggleCustomInput(index)}
                        className="px-3 py-1.5 text-xs rounded-md border border-dashed border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                      >
                        Other...
                      </button>
                    </div>
                  )}

                  {/* Custom input */}
                  {(isCustom || !concern.suggestedAnswers?.length) && (
                    <div className="space-y-2">
                      <Textarea
                        value={selectedAnswer || ''}
                        onChange={(e) => handleCustomAnswer(index, e.target.value)}
                        placeholder="Enter your answer..."
                        className="min-h-[60px] text-sm resize-none"
                        rows={2}
                      />
                      {concern.suggestedAnswers && concern.suggestedAnswers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleCustomInput(index)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Choose from suggestions
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </StepFormLayout>
  )
}
