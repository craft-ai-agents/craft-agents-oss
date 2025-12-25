import * as React from 'react'
import * as ReactDOM from 'react-dom'
import {
  Paperclip,
  ArrowUp,
  Square,
  ChevronDown,
  SquareSlash,
  Check,
  Plus,
} from 'lucide-react'

import * as storage from '@/lib/local-storage'

import { Button } from '@/components/ui/button'
import {
  SlashCommandMenu,
  InlineSlashCommand,
  useInlineSlashCommand,
  DEFAULT_SLASH_COMMANDS,
  type SlashCommandId,
} from '@/components/ui/slash-command-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { AttachmentPreview } from '../AttachmentPreview'
import { MODELS, getModelDisplayName } from '@config/models'
import { ServiceLogo } from '@/components/ui/service-logo'
import { getLogoUrl } from '@craft-agent/shared/utils/logo'
import { getConnectionLogoUrl, getConnectionLabel, getConnectionFallbackIcon } from '@/utils/connection-types'
import type { FileAttachment, ConnectionConfig } from '../../../../shared/types'

export interface FreeFormInputProps {
  /** Placeholder text for the textarea */
  placeholder?: string
  /** Whether input is disabled */
  disabled?: boolean
  /** Whether the session is currently processing */
  isProcessing?: boolean
  /** Callback when message is submitted */
  onSubmit: (message: string, attachments?: FileAttachment[]) => void
  /** Callback to stop processing */
  onStop?: () => void
  /** External ref for the textarea */
  textareaRef?: React.RefObject<HTMLTextAreaElement>
  /** Current model ID */
  currentModel: string
  /** Callback when model changes */
  onModelChange: (model: string) => void
  // Advanced options
  ultrathinkEnabled?: boolean
  onUltrathinkChange?: (enabled: boolean) => void
  skipPermissions?: boolean
  onSkipPermissionsChange?: (enabled: boolean) => void
  safeModeEnabled?: boolean
  onSafeModeChange?: (enabled: boolean) => void
  // Controlled input value (for persisting across mode switches and conversation changes)
  /** Current input value - if provided, component becomes controlled */
  inputValue?: string
  /** Callback when input value changes */
  onInputChange?: (value: string) => void
  /** When true, removes container styling (shadow, bg, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
  /** Callback when component height changes (for external animation sync) */
  onHeightChange?: (height: number) => void
  /** Callback when focus state changes */
  onFocusChange?: (focused: boolean) => void
  // Connection selection
  /** Available connections (enabled only) */
  connections?: ConnectionConfig[]
  /** Currently selected connection IDs for this session */
  selectedConnectionIds?: string[]
  /** Callback when connection selection changes */
  onConnectionsChange?: (ids: string[]) => void
  /** Current working directory path */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
}

/**
 * FreeFormInput - Self-contained textarea input with attachments and controls
 *
 * Features:
 * - Auto-growing textarea
 * - File attachments via button or drag-drop
 * - Slash commands menu
 * - Model selector
 * - Active option badges
 */
export function FreeFormInput({
  placeholder = 'Message...',
  disabled = false,
  isProcessing = false,
  onSubmit,
  onStop,
  textareaRef: externalTextareaRef,
  currentModel,
  onModelChange,
  ultrathinkEnabled = false,
  onUltrathinkChange,
  skipPermissions = false,
  onSkipPermissionsChange,
  safeModeEnabled = false,
  onSafeModeChange,
  inputValue,
  onInputChange,
  unstyled = false,
  onHeightChange,
  onFocusChange,
  connections = [],
  selectedConnectionIds = [],
  onConnectionsChange,
  workingDirectory,
  onWorkingDirectoryChange,
}: FreeFormInputProps) {
  // Performance optimization: Always use internal state for typing to avoid parent re-renders
  // Sync FROM parent on mount/change (for restoring drafts)
  // Sync TO parent on blur/submit (debounced persistence)
  const [input, setInput] = React.useState(inputValue ?? '')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])

  // Sync from parent when inputValue changes externally (e.g., switching sessions)
  const prevInputValueRef = React.useRef(inputValue)
  React.useEffect(() => {
    if (inputValue !== undefined && inputValue !== prevInputValueRef.current) {
      setInput(inputValue)
      prevInputValueRef.current = inputValue
    }
  }, [inputValue])

  // Debounced sync to parent (saves draft without blocking typing)
  const syncTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const syncToParent = React.useCallback((value: string) => {
    if (!onInputChange) return
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    syncTimeoutRef.current = setTimeout(() => {
      onInputChange(value)
      prevInputValueRef.current = value
    }, 300) // Debounce 300ms
  }, [onInputChange])

  // Sync immediately on unmount to preserve input across mode switches
  // Also cleanup any pending debounced sync
  const inputRef = React.useRef(input)
  inputRef.current = input // Keep ref in sync with state

  React.useEffect(() => {
    return () => {
      // Cancel pending debounced sync
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      // Immediately sync current value to parent on unmount
      // This preserves input when switching to structured input (e.g., permission request)
      if (onInputChange && inputRef.current !== prevInputValueRef.current) {
        onInputChange(inputRef.current)
      }
    }
  }, [onInputChange])

  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const [loadingCount, setLoadingCount] = React.useState(0)
  const [slashDropdownOpen, setSlashDropdownOpen] = React.useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false)
  const [connectionDropdownOpen, setConnectionDropdownOpen] = React.useState(false)
  const [isFocused, setIsFocused] = React.useState(false)

  const dragCounterRef = React.useRef(0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const modelButtonRef = React.useRef<HTMLButtonElement>(null)
  const [modelDropdownPosition, setModelDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)
  const slashButtonRef = React.useRef<HTMLButtonElement>(null)
  const [slashDropdownPosition, setSlashDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)
  const connectionButtonRef = React.useRef<HTMLButtonElement>(null)
  const [connectionDropdownPosition, setConnectionDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)

  // Merge refs
  const internalRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalRef

  // Listen for craft:insert-text events (generic mechanism for inserting text into input)
  // Used by PlanCard's Approve button to insert "Go ahead"
  React.useEffect(() => {
    const handleInsertText = (e: CustomEvent<{ text: string }>) => {
      const { text } = e.detail
      setInput(text)
      syncToParent(text)
      // Focus the textarea after inserting
      setTimeout(() => {
        textareaRef.current?.focus()
        // Move cursor to end
        if (textareaRef.current) {
          textareaRef.current.selectionStart = text.length
          textareaRef.current.selectionEnd = text.length
        }
      }, 0)
    }

    window.addEventListener('craft:insert-text', handleInsertText as EventListener)
    return () => window.removeEventListener('craft:insert-text', handleInsertText as EventListener)
  }, [syncToParent, textareaRef])

  // Build active commands list for slash command menu
  const activeCommands = React.useMemo(() => {
    const active: SlashCommandId[] = []
    if (safeModeEnabled) active.push('safe')
    if (ultrathinkEnabled) active.push('ultrathink')
    if (skipPermissions) active.push('skip-permissions')
    return active
  }, [safeModeEnabled, ultrathinkEnabled, skipPermissions])

  // Handle slash command selection
  const handleSlashCommand = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe') onSafeModeChange?.(!safeModeEnabled)
    else if (commandId === 'ultrathink') onUltrathinkChange?.(!ultrathinkEnabled)
    else if (commandId === 'skip-permissions') onSkipPermissionsChange?.(!skipPermissions)
  }, [safeModeEnabled, ultrathinkEnabled, skipPermissions, onSafeModeChange, onUltrathinkChange, onSkipPermissionsChange])

  // Inline slash command hook
  const inlineSlash = useInlineSlashCommand({
    textareaRef: textareaRef as React.RefObject<HTMLTextAreaElement>,
    onSelect: handleSlashCommand,
    activeCommands,
  })

  // Report height changes to parent (for external animation sync)
  React.useLayoutEffect(() => {
    if (!onHeightChange || !containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onHeightChange(entry.contentRect.height)
      }
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [onHeightChange])

  // Check if running in Electron environment (has electronAPI)
  const hasElectronAPI = typeof window !== 'undefined' && !!window.electronAPI

  // File attachment handlers
  const handleAttachClick = async () => {
    if (disabled || !hasElectronAPI) return
    try {
      const paths = await window.electronAPI.openFileDialog()
      for (const path of paths) {
        const attachment = await window.electronAPI.readFileAttachment(path)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      }
    } catch (error) {
      console.error('[FreeFormInput] Failed to attach files:', error)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Helper to read a File using FileReader API
  const readFileAsAttachment = async (file: File): Promise<FileAttachment | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as ArrayBuffer
        const base64 = btoa(
          new Uint8Array(result).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )

        let type: FileAttachment['type'] = 'unknown'
        if (file.type.startsWith('image/')) type = 'image'
        else if (file.type === 'application/pdf') type = 'pdf'
        else if (file.type.includes('text') || file.name.match(/\.(txt|md|json|js|ts|tsx|py|css|html)$/i)) type = 'text'
        else if (file.type.includes('officedocument') || file.name.match(/\.(docx?|xlsx?|pptx?)$/i)) type = 'office'

        const mimeType = file.type || 'application/octet-stream'

        let thumbnailBase64: string | undefined
        if (hasElectronAPI) {
          try {
            const thumb = await window.electronAPI.generateThumbnail(base64, mimeType)
            if (thumb) thumbnailBase64 = thumb
          } catch (err) {
            console.log('[FreeFormInput] Thumbnail generation failed:', err)
          }
        }

        resolve({
          type,
          path: file.name,
          name: file.name,
          mimeType,
          base64,
          size: file.size,
          thumbnailBase64,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    if (disabled) return

    const files = Array.from(e.dataTransfer.files)
    setLoadingCount(files.length)

    for (const file of files) {
      const filePath = (file as File & { path?: string }).path
      if (filePath && hasElectronAPI) {
        try {
          const attachment = await window.electronAPI.readFileAttachment(filePath)
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
            setLoadingCount(prev => prev - 1)
            continue
          }
        } catch (error) {
          console.error('[FreeFormInput] Failed to read via IPC:', error)
        }
      }

      try {
        const attachment = await readFileAsAttachment(file)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[FreeFormInput] Failed to read dropped file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const hasContent = input.trim() || attachments.length > 0
    if (!hasContent || disabled) return

    onSubmit(input.trim(), attachments.length > 0 ? attachments : undefined)
    setInput('')
    setAttachments([])
    // Clear draft immediately (cancel any pending debounced sync)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.('')
    prevInputValueRef.current = ''
  }

  const handleStop = () => {
    onStop?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Tab toggles safe mode
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      onSafeModeChange?.(!safeModeEnabled)
      return
    }

    // Don't submit when slash command menu is open - let it handle the Enter key
    if (inlineSlash.isOpen) {
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // These keys are handled by the InlineSlashCommand component
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        inlineSlash.close()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // If processing, first Return stops - second Return sends
      if (isProcessing) {
        handleStop()
        return
      }
      handleSubmit(e)
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      // Cmd/Ctrl+Enter also stops first if processing
      if (isProcessing) {
        handleStop()
        return
      }
      handleSubmit(e)
    }
    if (e.key === 'Escape') {
      textareaRef.current?.blur()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let value = e.target.value
    const cursorPosition = e.target.selectionStart

    // Update inline slash command state
    inlineSlash.handleInputChange(value, cursorPosition)

    // Auto-capitalize first letter (but not for slash commands)
    if (value.length > 0 && value.charAt(0) !== '/') {
      value = value.charAt(0).toUpperCase() + value.slice(1)
    }

    setInput(value)
    syncToParent(value) // Debounced sync to parent for draft persistence
  }

  // Handle inline slash command selection (removes the /command text)
  const handleInlineSlashSelect = React.useCallback((commandId: SlashCommandId) => {
    const newValue = inlineSlash.handleSelect(commandId)
    setInput(newValue)
    syncToParent(newValue)
    textareaRef.current?.focus()
  }, [inlineSlash, syncToParent, textareaRef])

  const hasContent = input.trim() || attachments.length > 0

  return (
    <form onSubmit={handleSubmit}>
      <div
        ref={containerRef}
        className={cn(
          'overflow-hidden transition-all',
          // Container styling - only when not wrapped by InputContainer
          !unstyled && 'rounded-[8px] shadow-middle',
          !unstyled && (isFocused ? 'bg-white dark:bg-white' : 'bg-background'),
          isDraggingOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Inline Slash Command Autocomplete */}
        <InlineSlashCommand
          open={inlineSlash.isOpen}
          onOpenChange={(open) => !open && inlineSlash.close()}
          commands={DEFAULT_SLASH_COMMANDS}
          activeCommands={activeCommands}
          onSelect={handleInlineSlashSelect}
          filter={inlineSlash.filter}
          position={inlineSlash.position}
        />

        {/* Attachment Preview */}
        <AttachmentPreview
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          disabled={disabled}
          loadingCount={loadingCount}
        />

        {/* Textarea with auto-grow via hidden sizer */}
        <div className="relative min-h-[72px]">
          {/* Hidden sizer - mirrors content to determine height */}
          <div
            className="invisible whitespace-pre-wrap break-words pl-5 pr-4 pt-4 pb-3 text-sm"
            aria-hidden="true"
          >
            {input || placeholder}
            {/* Extra space for cursor on new line */}
            {'\n'}
          </div>
          {/* Textarea positioned over sizer */}
          <textarea
            ref={textareaRef}
            className="absolute inset-0 w-full h-full pl-5 pr-4 pt-4 pb-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
            placeholder={placeholder}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { setIsFocused(true); onFocusChange?.(true) }}
            onBlur={() => { setIsFocused(false); onFocusChange?.(false) }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            disabled={disabled}
            rows={1}
          />
        </div>

        {/* Bottom Row: Controls */}
        <div className="flex items-center gap-1 px-2 py-2 border-t border-border/50">
          {/* Slash Command Button */}
          <div className="relative">
            <button
              ref={slashButtonRef}
              type="button"
              className="inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              disabled={disabled}
              onClick={() => {
                if (!slashDropdownOpen && slashButtonRef.current) {
                  const rect = slashButtonRef.current.getBoundingClientRect()
                  setSlashDropdownPosition({
                    top: rect.top,
                    left: rect.left,
                  })
                }
                setSlashDropdownOpen(!slashDropdownOpen)
              }}
            >
              <SquareSlash className="h-4 w-4" />
            </button>
            {slashDropdownOpen && slashDropdownPosition && ReactDOM.createPortal(
              <>
                <div
                  className="fixed inset-0 z-[9998]"
                  onClick={() => setSlashDropdownOpen(false)}
                />
                <div
                  className="fixed rounded-2xl border bg-popover shadow-lg z-[9999] overflow-hidden"
                  style={{
                    top: slashDropdownPosition.top - 8,
                    left: slashDropdownPosition.left,
                    transform: 'translateY(-100%)',
                  }}
                >
                  <SlashCommandMenu
                    commands={DEFAULT_SLASH_COMMANDS}
                    activeCommands={activeCommands}
                    onSelect={(commandId) => {
                      handleSlashCommand(commandId)
                      setSlashDropdownOpen(false)
                    }}
                    showFilter
                  />
                </div>
              </>,
              document.body
            )}
          </div>

          {/* Connection Selector Button - only show if onConnectionsChange is provided */}
          {onConnectionsChange && (
            <div className="relative">
              <button
                ref={connectionButtonRef}
                type="button"
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5 transition-colors disabled:opacity-50 disabled:pointer-events-none",
                  selectedConnectionIds.length > 0 && "text-primary"
                )}
                disabled={disabled}
                onClick={() => {
                  if (!connectionDropdownOpen && connectionButtonRef.current) {
                    const rect = connectionButtonRef.current.getBoundingClientRect()
                    setConnectionDropdownPosition({
                      top: rect.top,
                      left: rect.left,
                    })
                  }
                  setConnectionDropdownOpen(!connectionDropdownOpen)
                }}
              >
                <Plus className="h-4 w-4" />
                {selectedConnectionIds.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 text-[10px] font-medium bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                    {selectedConnectionIds.length}
                  </span>
                )}
              </button>
              {connectionDropdownOpen && connectionDropdownPosition && ReactDOM.createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998]"
                    onClick={() => setConnectionDropdownOpen(false)}
                  />
                  <div
                    className="fixed rounded-2xl border bg-popover shadow-lg z-[9999] p-3 min-w-[240px]"
                    style={{
                      top: connectionDropdownPosition.top - 8,
                      left: connectionDropdownPosition.left,
                      transform: 'translateY(-100%)',
                    }}
                  >
                    <div className="text-sm font-medium mb-2">Connections</div>
                    {connections.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-2">
                        No connections configured.
                        <br />
                        Add connections in Settings.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {connections.map(conn => {
                          const FallbackIcon = getConnectionFallbackIcon(conn.type)
                          return (
                          <label
                            key={conn.id}
                            className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-accent/50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedConnectionIds.includes(conn.id)}
                              onChange={(e) => {
                                const newIds = e.target.checked
                                  ? [...selectedConnectionIds, conn.id]
                                  : selectedConnectionIds.filter(id => id !== conn.id)
                                onConnectionsChange(newIds)
                              }}
                              className="rounded"
                            />
                            <ServiceLogo
                              logo={getLogoUrl(getConnectionLogoUrl(conn))}
                              name={conn.name}
                              fallbackIcon={<FallbackIcon className="h-4 w-4" />}
                              className="h-4 w-4 shrink-0"
                            />
                            <div className="flex-1">
                              <div className="text-sm">{conn.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {getConnectionLabel(conn.type)}
                              </div>
                            </div>
                            {selectedConnectionIds.includes(conn.id) && (
                              <Check className="h-4 w-4 text-primary shrink-0" />
                            )}
                          </label>
                        )})}
                      </div>
                    )}
                  </div>
                </>,
                document.body
              )}
            </div>
          )}

          {/* Attach File Button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-[4px]"
            onClick={handleAttachClick}
            disabled={disabled}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          {/* Working Directory Selector */}
          {workingDirectory && onWorkingDirectoryChange && (
            <WorkingDirectorySelector
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Model Selector */}
          <div className="relative">
            <button
              ref={modelButtonRef}
              type="button"
              className="inline-flex items-center h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 transition-colors"
              onClick={() => {
                if (!modelDropdownOpen && modelButtonRef.current) {
                  // Calculate position when opening
                  const rect = modelButtonRef.current.getBoundingClientRect()
                  setModelDropdownPosition({
                    top: rect.top,
                    left: rect.right - 280, // Align right edge of dropdown with right edge of button
                  })
                }
                setModelDropdownOpen(!modelDropdownOpen)
              }}
            >
              {getModelDisplayName(currentModel)}
              <ChevronDown className="opacity-50" style={{ width: 12, height: 12 }} />
            </button>
            {modelDropdownOpen && modelDropdownPosition && ReactDOM.createPortal(
              <>
                {/* Backdrop to close on click outside */}
                <div
                  className="fixed inset-0 z-[9998]"
                  onClick={() => setModelDropdownOpen(false)}
                />
                <div
                  className="fixed p-2 min-w-[280px] rounded-2xl border bg-popover shadow-lg z-[9999]"
                  style={{
                    top: modelDropdownPosition.top - 8, // 8px gap above button
                    left: modelDropdownPosition.left,
                    transform: 'translateY(-100%)', // Position above the calculated point
                  }}
                >
                  <div className="space-y-1">
                    {MODELS.map((model) => {
                      const isSelected = currentModel === model.id
                      const descriptions: Record<string, string> = {
                        'claude-opus-4-5-20251101': 'Most capable for complex work',
                        'claude-sonnet-4-5-20250929': 'Best for everyday tasks',
                        'claude-haiku-4-5-20251001': 'Fastest for quick answers',
                      }
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            onModelChange(model.id)
                            setModelDropdownOpen(false)
                          }}
                          className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-accent/50 transition-colors"
                        >
                          <div className="text-left">
                            <div className="font-medium text-sm">{model.name}</div>
                            <div className="text-xs text-muted-foreground">{descriptions[model.id] || model.description}</div>
                          </div>
                          {isSelected ? (
                            <Check className="h-4 w-4 text-primary shrink-0 ml-3" />
                          ) : (
                            <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5 shrink-0 ml-3">New chat</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>,
              document.body
            )}
          </div>

          {/* Send/Stop Button - Always show stop when processing */}
          {isProcessing ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 rounded-full shrink-0 hover:bg-foreground/15 active:bg-foreground/20"
              onClick={handleStop}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-7 w-7 rounded-full shrink-0"
              disabled={!hasContent || disabled}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

/**
 * Helper functions for recent directories storage
 */
function getRecentDirs(): string[] {
  return storage.get<string[]>(storage.KEYS.recentWorkingDirs, [])
}

function addRecentDir(path: string): void {
  const recent = getRecentDirs().filter(p => p !== path)
  const updated = [path, ...recent].slice(0, 5)
  storage.set(storage.KEYS.recentWorkingDirs, updated)
}

/**
 * WorkingDirectorySelector - Dropdown for selecting working directory
 */
function WorkingDirectorySelector({
  workingDirectory,
  onWorkingDirectoryChange,
}: {
  workingDirectory: string
  onWorkingDirectoryChange: (path: string) => void
}) {
  const [recentDirs, setRecentDirs] = React.useState<string[]>([])

  // Load recent directories on mount
  React.useEffect(() => {
    setRecentDirs(getRecentDirs())
  }, [])

  const handleChooseFolder = async () => {
    if (!window.electronAPI) return
    const selectedPath = await window.electronAPI.openFolderDialog()
    if (selectedPath) {
      addRecentDir(selectedPath)
      setRecentDirs(getRecentDirs())
      onWorkingDirectoryChange(selectedPath)
    }
  }

  const handleSelectRecent = (path: string) => {
    addRecentDir(path) // Move to top of recent list
    setRecentDirs(getRecentDirs())
    onWorkingDirectoryChange(path)
  }

  // Filter out current directory from recent list
  const filteredRecent = recentDirs.filter(p => p !== workingDirectory)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 data-[state=open]:bg-foreground/5 max-w-[160px]"
            >
              <span className="truncate">{workingDirectory.split('/').pop() || 'Home'}</span>
              <ChevronDown className="opacity-50 shrink-0" style={{ width: 12, height: 12 }} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex flex-col gap-0.5">
          <span className="font-medium">Local working directory</span>
          <span className="text-xs opacity-70 font-mono">{workingDirectory}</span>
        </TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="start" sideOffset={8}>
        {/* Recent Directories */}
        {filteredRecent.length > 0 && (
          <>
            {filteredRecent.map((path) => (
              <StyledDropdownMenuItem
                key={path}
                onClick={() => handleSelectRecent(path)}
                className="font-mono text-xs"
              >
                <span className="truncate max-w-[200px]">{path}</span>
              </StyledDropdownMenuItem>
            ))}
            <div className="h-px bg-border my-1" />
          </>
        )}
        {/* Choose Folder option */}
        <StyledDropdownMenuItem onClick={handleChooseFolder}>
          Choose Folder...
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
