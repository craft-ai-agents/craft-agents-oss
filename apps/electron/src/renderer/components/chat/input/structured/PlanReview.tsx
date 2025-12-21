import * as React from 'react'
import { ClipboardList, Check, X, MessageSquare, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlanReview as PlanReviewType, PlanReviewResponse } from './types'

interface PlanReviewProps {
  plan: PlanReviewType
  onResponse: (response: PlanReviewResponse) => void
  /** When true, removes container styling (shadow, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * PlanReview - Self-contained structured input for reviewing and approving plans
 *
 * Features:
 * - Plan title and summary
 * - Scrollable step list with tool badges
 * - Optional questions section
 * - Actions: Approve, Refine, Cancel
 */
export function PlanReview({ plan, onResponse, unstyled = false }: PlanReviewProps) {
  const handleApprove = () => {
    onResponse({
      type: 'plan_review',
      planId: plan.id,
      action: 'approve',
    })
  }

  const handleRefine = () => {
    onResponse({
      type: 'plan_review',
      planId: plan.id,
      action: 'refine',
    })
  }

  const handleCancel = () => {
    onResponse({
      type: 'plan_review',
      planId: plan.id,
      action: 'cancel',
    })
  }

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Enter to approve
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleApprove()
      }
      // Shift + Enter to refine
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        handleRefine()
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        handleCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [plan])

  return (
    <div className={cn(
      'bg-background overflow-hidden h-full flex flex-col',
      unstyled ? 'border-0' : 'border border-border rounded-[8px] shadow-middle'
    )}>
      {/* Content - grows to fill available space */}
      <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <ClipboardList className="h-5 w-5 text-green-600 dark:text-green-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">{plan.title}</div>
            <p className="text-xs text-muted-foreground">{plan.summary}</p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {plan.steps.map((step, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
            >
              {/* Step number */}
              <div className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                {index + 1}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="text-sm">{step.description}</div>
                {step.tools && step.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {step.tools.map((tool, toolIndex) => (
                      <span
                        key={toolIndex}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-foreground/5 text-muted-foreground"
                      >
                        <Wrench className="h-2.5 w-2.5" />
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Questions (if any) */}
        {plan.questions && plan.questions.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Questions</span>
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {plan.questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground/50">•</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
        {/* Left side: step count */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{plan.steps.length} steps</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side: actions */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5"
          onClick={handleCancel}
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 border border-foreground/10"
          onClick={handleRefine}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Refine
        </Button>

        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5"
          onClick={handleApprove}
        >
          <Check className="h-3.5 w-3.5" />
          Approve
          <kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd>
        </Button>
      </div>
    </div>
  )
}
