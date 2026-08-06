import * as React from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface NewTaskComposerProps {
  /** Create a task tile from the typed title. Fire-and-forget — the tile appears via the atom update. */
  onCreate: (title: string) => void
  className?: string
}

/**
 * Inline "new task" affordance at the top of the ToDo column. Collapsed it's a
 * dashed "+ New Task" button; expanded it's a single-line title field. Enter
 * creates the tile in place (no navigation) and stays open so several tasks can
 * be added in a row; Escape discards; blur commits any pending title and
 * collapses. Mirrors the subtask composer so a tile is born named rather than as
 * an empty "New chat".
 */
export function NewTaskComposer({ onCreate, className }: NewTaskComposerProps) {
  const { t } = useTranslation()
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (composing) inputRef.current?.focus()
  }, [composing])

  const commit = (keepOpen: boolean) => {
    const title = draft.trim()
    if (title) {
      onCreate(title)
      setDraft('')
    }
    if (keepOpen && title) inputRef.current?.focus()
    else setComposing(false)
  }

  if (!composing) {
    return (
      <button
        type="button"
        onClick={() => setComposing(true)}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 py-2',
          'text-[11px] font-medium text-foreground/50 transition-colors',
          'hover:border-border hover:text-foreground/80',
          className
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        {t('kanban.newTask')}
      </button>
    )
  }

  return (
    <textarea
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDraft('')
          setComposing(false)
        }
      }}
      onBlur={() => commit(false)}
      rows={1}
      placeholder={t('kanban.newTaskTitle')}
      className={cn(
        'w-full resize-none rounded-lg border border-border/60 bg-background px-2.5 py-2 text-sm text-foreground outline-none field-sizing-content max-h-40 focus:border-border',
        className
      )}
    />
  )
}
