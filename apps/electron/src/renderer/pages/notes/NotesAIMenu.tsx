import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FileSearch, ListChecks, Maximize2, Sparkles } from 'lucide-react'
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

const ACTIONS: Array<{
  mode: AIActionMode
  labelKey: string
  descriptionKey: string
  icon: React.ElementType
}> = [
  {
    mode: 'extract-tasks',
    labelKey: 'notes.ai.extractTasks',
    descriptionKey: 'notes.ai.extractTasksDesc',
    icon: ListChecks,
  },
  {
    mode: 'analyze',
    labelKey: 'notes.ai.analyze',
    descriptionKey: 'notes.ai.analyzeDesc',
    icon: Sparkles,
  },
  {
    mode: 'expand',
    labelKey: 'notes.ai.expand',
    descriptionKey: 'notes.ai.expandDesc',
    icon: Maximize2,
  },
  {
    mode: 'summarize',
    labelKey: 'notes.ai.summarize',
    descriptionKey: 'notes.ai.summarizeDesc',
    icon: FileSearch,
  },
]

export function NotesAIMenu({ activeNote, onAction, disabled }: NotesAIMenuProps) {
  const { t } = useTranslation()
  const isDisabled = disabled || !activeNote
  const primary = ACTIONS[0]

  return (
    <div className="flex items-center">
      <button
        className="flex h-7 items-center gap-1.5 rounded-l-[6px] border border-border/60 bg-background px-2.5 text-xs hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-40"
        onClick={() => onAction(primary.mode)}
        disabled={isDisabled}
        title={t('notes.ai.extractTasksTitle')}
      >
        <ListChecks className="h-3.5 w-3.5" />
        {t('notes.ai.extractTasks')}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="-ml-px flex h-7 items-center rounded-r-[6px] border border-border/60 bg-background px-1.5 hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:opacity-40"
            disabled={isDisabled}
            title={t('notes.ai.moreActions')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end" className="w-56">
          {ACTIONS.map((action, i) => (
            <React.Fragment key={action.mode}>
              {i === 1 && <StyledDropdownMenuSeparator />}
              <StyledDropdownMenuItem
                onClick={() => onAction(action.mode)}
                className="gap-2"
              >
                <action.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium">{t(action.labelKey)}</span>
                  <span className="text-[10px] text-muted-foreground">{t(action.descriptionKey)}</span>
                </div>
              </StyledDropdownMenuItem>
            </React.Fragment>
          ))}
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
