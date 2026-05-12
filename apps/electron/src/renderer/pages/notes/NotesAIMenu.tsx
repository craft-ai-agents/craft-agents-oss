import * as React from 'react'
import { Bot, ChevronDown, FileSearch, ListChecks, Maximize2, Sparkles } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import type { NoteDocument } from '../../../shared/types'

export type AIActionMode = 'analyze' | 'expand' | 'summarize' | 'extract-tasks'

export interface NotesAIMenuProps {
  activeNote: NoteDocument | null
  onAction(mode: AIActionMode): void
  disabled?: boolean
}

const ACTIONS: Array<{ mode: AIActionMode; label: string; icon: React.ElementType; description: string }> = [
  { mode: 'analyze', label: 'Analyze & act', icon: Sparkles, description: 'Analyze this note and suggest concrete next actions' },
  { mode: 'expand', label: 'Expand note', icon: Maximize2, description: 'Enrich with additional context, examples, and detail' },
  { mode: 'summarize', label: 'Summarize', icon: FileSearch, description: 'Write a concise summary with key takeaways' },
  { mode: 'extract-tasks', label: 'Extract tasks', icon: ListChecks, description: 'Extract all implied and explicit action items' },
]

export function NotesAIMenu({ activeNote, onAction, disabled }: NotesAIMenuProps) {
  const isDisabled = disabled || !activeNote

  return (
    <div className="flex items-center">
      <button
        className="flex h-7 items-center gap-1.5 rounded-l-[6px] border border-border/60 bg-background px-2.5 text-xs hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-40"
        onClick={() => onAction('analyze')}
        disabled={isDisabled}
        title="Analyze note with AI"
      >
        <Bot className="h-3.5 w-3.5" />
        Ask AI
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="-ml-px flex h-7 items-center rounded-r-[6px] border border-border/60 bg-background px-1.5 hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-40"
            disabled={isDisabled}
            title="More AI actions"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end" className="w-52">
          {ACTIONS.map((action, i) => (
            <React.Fragment key={action.mode}>
              {i === 0 && (
                <>
                  <StyledDropdownMenuItem
                    onClick={() => onAction(action.mode)}
                    className="gap-2"
                  >
                    <action.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">{action.label}</span>
                      <span className="text-[10px] text-muted-foreground">{action.description}</span>
                    </div>
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                </>
              )}
              {i > 0 && (
                <StyledDropdownMenuItem
                  onClick={() => onAction(action.mode)}
                  className="gap-2"
                >
                  <action.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{action.label}</span>
                    <span className="text-[10px] text-muted-foreground">{action.description}</span>
                  </div>
                </StyledDropdownMenuItem>
              )}
            </React.Fragment>
          ))}
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
