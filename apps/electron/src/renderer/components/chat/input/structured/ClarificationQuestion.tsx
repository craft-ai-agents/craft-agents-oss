import * as React from 'react'
import { MessageCircleQuestion, Check, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ClarificationQuestion as ClarificationQuestionType, ClarificationResponse } from './types'

interface ClarificationQuestionProps {
  question: ClarificationQuestionType
  onResponse: (response: ClarificationResponse) => void
  /** When true, removes container styling (shadow, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * ClarificationQuestion - Self-contained structured input for answering questions
 *
 * Features:
 * - Question text with header
 * - Selectable option cards
 * - Single-select: clicking option auto-submits
 * - Multi-select: toggle options, then submit
 * - Skip button to bypass the question
 */
export function ClarificationQuestion({ question, onResponse, unstyled = false }: ClarificationQuestionProps) {
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(new Set())

  const handleOptionClick = (index: number) => {
    if (question.multiSelect) {
      // Toggle selection
      setSelectedIndices(prev => {
        const next = new Set(prev)
        if (next.has(index)) {
          next.delete(index)
        } else {
          next.add(index)
        }
        return next
      })
    } else {
      // Single select - submit immediately
      onResponse({
        type: 'clarification',
        questionId: question.id,
        selectedOptions: [index],
        skipped: false,
      })
    }
  }

  const handleSubmit = () => {
    onResponse({
      type: 'clarification',
      questionId: question.id,
      selectedOptions: Array.from(selectedIndices),
      skipped: false,
    })
  }

  const handleSkip = () => {
    onResponse({
      type: 'clarification',
      questionId: question.id,
      selectedOptions: [],
      skipped: true,
    })
  }

  // Keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Number keys 1-9 to select options
      const num = parseInt(e.key)
      if (num >= 1 && num <= question.options.length) {
        handleOptionClick(num - 1)
      }
      // Enter to submit (multi-select only)
      if (e.key === 'Enter' && question.multiSelect && selectedIndices.size > 0) {
        e.preventDefault()
        handleSubmit()
      }
      // Escape to skip
      if (e.key === 'Escape') {
        handleSkip()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [question, selectedIndices])

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
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            {question.header && (
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {question.header}
              </div>
            )}
            <p className="text-sm font-medium text-foreground">{question.question}</p>
          </div>
        </div>

        {/* Options */}
        <div className="grid gap-2">
          {question.options.map((option, index) => {
            const isSelected = selectedIndices.has(index)
            return (
              <button
                key={index}
                type="button"
                onClick={() => handleOptionClick(index)}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-md border text-left transition-all',
                  'hover:bg-foreground/5',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
                )}
              >
                {/* Selection indicator / number */}
                <div className={cn(
                  'shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}>
                  {isSelected ? <Check className="h-3 w-3" /> : index + 1}
                </div>

                {/* Option content */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{option.label}</div>
                  {option.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{option.description}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
        {/* Left side: context info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {question.multiSelect ? (
            <span>{selectedIndices.size} selected</span>
          ) : (
            <span>Select an option</span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side: actions */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5"
          onClick={handleSkip}
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip
        </Button>

        {question.multiSelect && (
          <Button
            size="sm"
            variant="default"
            className="h-7"
            onClick={handleSubmit}
            disabled={selectedIndices.size === 0}
          >
            Submit
          </Button>
        )}
      </div>
    </div>
  )
}
