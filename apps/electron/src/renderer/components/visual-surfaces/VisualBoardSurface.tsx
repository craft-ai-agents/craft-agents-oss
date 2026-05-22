import * as React from 'react'
import { FilePlus2, FileText, Plus, Save, Trash2 } from 'lucide-react'
import {
  VISUAL_BOARD_MAX_BODY_LENGTH,
  VISUAL_BOARD_MAX_TITLE_LENGTH,
  VISUAL_BOARD_TAG,
  type VisualBoardCard,
  type VisualBoardOutputCard,
  type VisualBoardSnapshot,
} from '@craft-agent/shared/visual-board'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useVisualBoard } from '@/hooks/useVisualBoard'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'

interface VisualBoardSurfaceProps {
  workspaceId: string
  sessionId: string
  outputs: OutputSummaryDTO[]
  onOpenOutput: (output: OutputSummaryDTO) => void
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function VisualBoardSurface({
  workspaceId,
  sessionId,
  outputs,
  onOpenOutput,
}: VisualBoardSurfaceProps) {
  const { board, loading, error, saveBoard } = useVisualBoard(workspaceId, sessionId)
  const [draft, setDraft] = React.useState<VisualBoardSnapshot | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [saveState, setSaveState] = React.useState<SaveState>('idle')
  const versionRef = React.useRef(0)

  React.useEffect(() => {
    if (!board) return
    setDraft(board)
    setDirty(false)
    setSaveState('saved')
    versionRef.current += 1
  }, [board])

  React.useEffect(() => {
    if (!draft || !dirty) return
    setSaveState('dirty')
    const version = versionRef.current
    const timeout = window.setTimeout(() => {
      setSaveState('saving')
      saveBoard(draft).then((result) => {
        if (versionRef.current !== version) return
        setDraft(result.board)
        setDirty(false)
        setSaveState('saved')
      }).catch(() => {
        if (versionRef.current === version) setSaveState('error')
      })
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [dirty, draft, saveBoard])

  const updateDraft = React.useCallback((updater: (board: VisualBoardSnapshot) => VisualBoardSnapshot) => {
    setDraft((current) => {
      if (!current) return current
      versionRef.current += 1
      setDirty(true)
      return updater(current)
    })
  }, [])

  const addNote = React.useCallback(() => {
    const now = new Date().toISOString()
    updateDraft((current) => ({
      ...current,
      cards: [
        {
          id: createCardId('note'),
          type: 'note',
          title: 'New note',
          body: '',
          createdAt: now,
          updatedAt: now,
        },
        ...current.cards,
      ],
      updatedAt: now,
    }))
  }, [updateDraft])

  const pinOutput = React.useCallback((output: OutputSummaryDTO) => {
    const now = new Date().toISOString()
    updateDraft((current) => {
      if (current.cards.some((card) => card.type === 'output' && card.outputId === output.id)) return current
      const card: VisualBoardOutputCard = {
        id: createCardId('output'),
        type: 'output',
        outputId: output.id,
        title: output.title,
        kind: output.kind,
        summary: output.summary,
        createdAt: now,
        updatedAt: now,
      }
      return {
        ...current,
        cards: [card, ...current.cards],
        updatedAt: now,
      }
    })
  }, [updateDraft])

  const cardOutputs = React.useMemo(
    () => new Set(draft?.cards.filter((card) => card.type === 'output').map((card) => card.outputId) ?? []),
    [draft?.cards],
  )
  const pinnableOutputs = React.useMemo(
    () => outputs.filter((output) => !isVisualBoardOutput(output) && !cardOutputs.has(output.id)).slice(0, 4),
    [cardOutputs, outputs],
  )

  if (loading && !draft) {
    return <BoardShell message="Loading board..." />
  }

  if (error && !draft) {
    return <BoardShell message={`Board unavailable: ${error}`} />
  }

  if (!draft) {
    return <BoardShell message="Board is unavailable." />
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background/45">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/45 px-3 py-2">
        <Button type="button" size="sm" variant="secondary" className="h-8" onClick={addNote}>
          <Plus className="h-3.5 w-3.5" />
          Note
        </Button>
        {pinnableOutputs.map((output) => (
          <Button
            key={output.id}
            type="button"
            size="sm"
            variant="outline"
            className="h-8 max-w-40 justify-start"
            onClick={() => pinOutput(output)}
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span className="truncate">{output.title}</span>
          </Button>
        ))}
        <div className={cn(
          'ml-auto flex items-center gap-1.5 text-[11px]',
          saveState === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}>
          <Save className="h-3.5 w-3.5" />
          {saveLabel(saveState)}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {draft.cards.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-border/55 bg-foreground/[0.025] p-6 text-center text-sm text-muted-foreground">
            Add a note or pin an output to build this session board.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
            {draft.cards.map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                outputs={outputs}
                onOpenOutput={onOpenOutput}
                onChange={(next) => {
                  updateDraft((current) => ({
                    ...current,
                    cards: current.cards.map((item) => item.id === next.id ? next : item),
                    updatedAt: next.updatedAt,
                  }))
                }}
                onDelete={() => {
                  const now = new Date().toISOString()
                  updateDraft((current) => ({
                    ...current,
                    cards: current.cards.filter((item) => item.id !== card.id),
                    updatedAt: now,
                  }))
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BoardCard({
  card,
  outputs,
  onChange,
  onDelete,
  onOpenOutput,
}: {
  card: VisualBoardCard
  outputs: OutputSummaryDTO[]
  onChange: (card: VisualBoardCard) => void
  onDelete: () => void
  onOpenOutput: (output: OutputSummaryDTO) => void
}) {
  if (card.type === 'output') {
    const output = outputs.find((entry) => entry.id === card.outputId)
    return (
      <article className="rounded-md border border-border/60 bg-background/78 p-3 shadow-xs">
        <div className="flex items-start gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sky-400/12 text-sky-200">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{card.title}</div>
            <div className="mt-0.5 text-[11px] capitalize text-muted-foreground">{card.kind}</div>
          </div>
          <DeleteButton onDelete={onDelete} />
        </div>
        {card.summary ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{card.summary}</p> : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3 h-7 w-full"
          disabled={!output}
          onClick={() => output && onOpenOutput(output)}
        >
          Open output
        </Button>
      </article>
    )
  }

  return (
    <article className="rounded-md border border-border/60 bg-background/78 p-3 shadow-xs">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={card.title}
          maxLength={VISUAL_BOARD_MAX_TITLE_LENGTH}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
          placeholder="Note title"
          onChange={(event) => onChange({ ...card, title: event.target.value, updatedAt: new Date().toISOString() })}
        />
        <DeleteButton onDelete={onDelete} />
      </div>
      <textarea
        value={card.body}
        maxLength={VISUAL_BOARD_MAX_BODY_LENGTH}
        className="min-h-28 w-full resize-none rounded-md border border-border/45 bg-foreground/[0.025] px-2.5 py-2 text-xs leading-5 outline-none placeholder:text-muted-foreground focus:border-sky-300/35"
        placeholder="Write a note..."
        onChange={(event) => onChange({ ...card, body: event.target.value, updatedAt: new Date().toISOString() })}
      />
    </article>
  )
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" onClick={onDelete}>
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
}

function BoardShell({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center bg-background/45 p-4 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function createCardId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function isVisualBoardOutput(output: OutputSummaryDTO): boolean {
  return output.tags?.includes(VISUAL_BOARD_TAG) ?? false
}

function saveLabel(state: SaveState): string {
  if (state === 'dirty') return 'Saving soon'
  if (state === 'saving') return 'Saving'
  if (state === 'saved') return 'Saved'
  if (state === 'error') return 'Save failed'
  return 'Ready'
}
