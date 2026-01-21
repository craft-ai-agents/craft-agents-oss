/**
 * SessionMetadataPanel - Session info panel with resizable metadata and files sections
 *
 * Displays two vertically stacked sections:
 * - Top: Editable session name and notes (auto-saved)
 * - Bottom: Files in the session directory
 *
 * A horizontal resize handle allows adjusting the split between sections.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { PanelHeader } from '../app-shell/PanelHeader'
import { useSession as useSessionData, useAppShellContext } from '@/context/AppShellContext'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { HorizontalResizeHandle } from '../ui/horizontal-resize-handle'
import { SessionFilesSection } from './SessionFilesSection'
import * as storage from '@/lib/local-storage'
import { useTranslation } from '@/i18n'

export interface SessionMetadataPanelProps {
  sessionId?: string
  closeButton?: React.ReactNode
}

// Default and constraints for metadata section height
const DEFAULT_METADATA_HEIGHT = 250
const MIN_METADATA_HEIGHT = 120
const MIN_FILES_HEIGHT = 80

/**
 * Custom hook for debounced callback
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args)
      }, delay)
    }) as T,
    [delay]
  )
}

/**
 * Panel displaying session metadata with minimal styling
 */
export function SessionMetadataPanel({ sessionId, closeButton }: SessionMetadataPanelProps) {
  const { t } = useTranslation()
  const { onRenameSession } = useAppShellContext()
  const containerRef = useRef<HTMLDivElement>(null)

  // State for editable fields
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [notesLoaded, setNotesLoaded] = useState(false)

  // State for resizable panel split - height of metadata section
  const [metadataHeight, setMetadataHeight] = useState(() => {
    return storage.get(storage.KEYS.sessionInfoMetadataHeight, DEFAULT_METADATA_HEIGHT)
  })

  // Get session data
  const session = useSessionData(sessionId || '')

  // Initialize name from session
  useEffect(() => {
    setName(session?.name || '')
  }, [session?.name])

  // Load notes when session changes
  useEffect(() => {
    if (!sessionId) return

    // Load notes
    window.electronAPI.getSessionNotes(sessionId).then((content) => {
      setNotes(content)
      setNotesLoaded(true)
    })
  }, [sessionId])

  // Debounced save for name
  const debouncedSaveName = useDebouncedCallback(
    (newName: string) => {
      if (sessionId && newName.trim()) {
        onRenameSession(sessionId, newName.trim())
      }
    },
    500
  )

  // Debounced save for notes
  const debouncedSaveNotes = useDebouncedCallback(
    (content: string) => {
      if (sessionId) {
        window.electronAPI.setSessionNotes(sessionId, content)
      }
    },
    500
  )

  // Handle name change
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    debouncedSaveName(newName)
  }

  // Handle notes change
  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const content = e.target.value
    setNotes(content)
    debouncedSaveNotes(content)
  }

  // Handle resize - constrain to min heights for both sections
  const handleResize = useCallback((deltaY: number) => {
    if (!containerRef.current) return

    const containerHeight = containerRef.current.clientHeight
    // Account for header (50px) when calculating available space
    const availableHeight = containerHeight - 50

    setMetadataHeight((prev) => {
      const newHeight = prev + deltaY
      // Ensure both sections have minimum heights
      const maxMetadataHeight = availableHeight - MIN_FILES_HEIGHT
      return Math.max(MIN_METADATA_HEIGHT, Math.min(maxMetadataHeight, newHeight))
    })
  }, [])

  // Save height to localStorage when resize ends
  const handleResizeEnd = useCallback(() => {
    storage.set(storage.KEYS.sessionInfoMetadataHeight, metadataHeight)
  }, [metadataHeight])

  // Early return if no sessionId
  if (!sessionId) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t('sessionMetadata' as any)} actions={closeButton} />
        <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
          <p className="text-sm text-center">{t('noSessionSelected' as any)}</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t('sessionMetadata' as any)} actions={closeButton} />
        <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
          <p className="text-sm text-center">{t('loadingSession' as any)}</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      <PanelHeader title={t('sessionMetadata' as any)} actions={closeButton} />

      {/* Metadata section (Name + Notes) - fixed height based on state */}
      <div
        className="shrink-0 overflow-auto p-4 space-y-5"
        style={{ height: metadataHeight }}
      >
        {/* Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
            {t('name' as any)}
          </label>
          <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
            <Input
              value={name}
              onChange={handleNameChange}
              placeholder={t('untitled' as any)}
              className="h-9 py-2 text-sm border-0 shadow-none bg-transparent focus-visible:ring-0"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
            {t('notesTitle' as any)}
          </label>
          <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
            <Textarea
              value={notes}
              onChange={handleNotesChange}
              placeholder={notesLoaded ? t('notesPlaceholder' as any) : t('loading' as any)}
              disabled={!notesLoaded}
              spellCheck={false}
              className="text-sm min-h-[80px] py-2 resize-y border-0 shadow-none bg-transparent focus-visible:ring-0 placeholder:select-none"
            />
          </div>
        </div>
      </div>

      {/* Horizontal resize handle */}
      <HorizontalResizeHandle
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />

      {/* Files section - takes remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SessionFilesSection sessionId={sessionId} />
      </div>
    </div>
  )
}
