import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Command as CommandPrimitive } from 'cmdk'
import { toast } from 'sonner'
import {
  Paperclip,
  ArrowUp,
  Square,
  ChevronDown,
  SquareSlash,
  Check,
  CloudCog,
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
import { SourceAvatar } from '@/components/ui/source-avatar'
import type { FileAttachment, LoadedSource } from '../../../../shared/types'
import type { PermissionMode } from '@craft-agent/shared/agent/modes'
import { PERMISSION_MODE_ORDER } from '@craft-agent/shared/agent/modes'


export interface FreeFormInputProps {
  /** Placeholder text for the textarea */
  placeholder?: string
  /** Whether input is disabled */
  disabled?: boolean
  /** Whether the session is currently processing */
  isProcessing?: boolean
  /** Callback when message is submitted */
  onSubmit: (message: string, attachments?: FileAttachment[]) => void
  /** Callback to stop processing. Pass silent=true to skip "Response interrupted" message */
  onStop?: (silent?: boolean) => void
  /** External ref for the textarea */
  textareaRef?: React.RefObject<HTMLTextAreaElement>
  /** Current model ID */
  currentModel: string
  /** Callback when model changes */
  onModelChange: (model: string) => void
  // Advanced options
  ultrathinkEnabled?: boolean
  onUltrathinkChange?: (enabled: boolean) => void
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
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
  // Source selection
  /** Available sources (enabled only) */
  sources?: LoadedSource[]
  /** Currently enabled source slugs for this session */
  enabledSourceSlugs?: string[]
  /** Callback when source selection changes */
  onSourcesChange?: (slugs: string[]) => void
  /** Current working directory path */
  workingDirectory?: string
  /** Callback when working directory changes */
  onWorkingDirectoryChange?: (path: string) => void
  /** Session ID for scoping events like approve-plan */
  sessionId?: string
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
  permissionMode = 'ask',
  onPermissionModeChange,
  inputValue,
  onInputChange,
  unstyled = false,
  onHeightChange,
  onFocusChange,
  sources = [],
  enabledSourceSlugs = [],
  onSourcesChange,
  workingDirectory,
  onWorkingDirectoryChange,
  sessionId,
}: FreeFormInputProps) {
  // Performance optimization: Always use internal state for typing to avoid parent re-renders
  // Sync FROM parent on mount/change (for restoring drafts)
  // Sync TO parent on blur/submit (debounced persistence)
  const [input, setInput] = React.useState(inputValue ?? '')
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])

  // Optimistic state for source selection - updates UI immediately before IPC round-trip completes
  const [optimisticSourceSlugs, setOptimisticSourceSlugs] = React.useState(enabledSourceSlugs)

  // Sync from prop when server state changes (reconciles after IPC or on external updates)
  // Use content comparison (not reference) to avoid infinite loops with empty arrays
  const prevEnabledSourceSlugsRef = React.useRef(enabledSourceSlugs)
  React.useEffect(() => {
    const prev = prevEnabledSourceSlugsRef.current
    const changed = enabledSourceSlugs.length !== prev.length ||
      enabledSourceSlugs.some((slug, i) => slug !== prev[i])

    if (changed) {
      setOptimisticSourceSlugs(enabledSourceSlugs)
      prevEnabledSourceSlugsRef.current = enabledSourceSlugs
    }
  }, [enabledSourceSlugs])

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
  const [sourceDropdownOpen, setSourceDropdownOpen] = React.useState(false)
  const [sourceFilter, setSourceFilter] = React.useState('')
  const [isFocused, setIsFocused] = React.useState(false)

  const dragCounterRef = React.useRef(0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const modelButtonRef = React.useRef<HTMLButtonElement>(null)
  const [modelDropdownPosition, setModelDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)
  const slashButtonRef = React.useRef<HTMLButtonElement>(null)
  const [slashDropdownPosition, setSlashDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)
  const sourceButtonRef = React.useRef<HTMLButtonElement>(null)
  const sourceFilterInputRef = React.useRef<HTMLInputElement>(null)
  const [sourceDropdownPosition, setSourceDropdownPosition] = React.useState<{ top: number; left: number } | null>(null)

  // Merge refs
  const internalRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalRef

  // Listen for craft:insert-text events (generic mechanism for inserting text into input)
  // Used by components that want to pre-fill the input with text
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

  // Listen for craft:approve-plan events (used by ResponseCard's Accept Plan button)
  // This disables safe mode AND submits the message in one action
  // Only process events for this session (sessionId must match)
  React.useEffect(() => {
    const handleApprovePlan = (e: CustomEvent<{ text?: string; sessionId?: string }>) => {
      // Only handle if this event is for our session
      if (e.detail?.sessionId && e.detail.sessionId !== sessionId) {
        return
      }
      const text = e.detail?.text
      if (!text) {
        toast.error('No details provided')
        return
      }
      // Switch to allow-all (Auto) mode if in Explore mode (allow execution without prompts)
      // Only switch if currently in safe mode - if user is in 'ask' mode, respect their choice
      if (permissionMode === 'safe') {
        onPermissionModeChange?.('allow-all')
      }
      // Submit the message
      onSubmit(text, undefined)
    }

    window.addEventListener('craft:approve-plan', handleApprovePlan as EventListener)
    return () => window.removeEventListener('craft:approve-plan', handleApprovePlan as EventListener)
  }, [sessionId, permissionMode, onPermissionModeChange, onSubmit])

  // Listen for craft:paste-files events (for global paste when input not focused)
  React.useEffect(() => {
    const handlePasteFiles = async (e: CustomEvent<{ files: File[] }>) => {
      if (disabled) return

      const { files } = e.detail
      if (!files || files.length === 0) return

      setLoadingCount(prev => prev + files.length)

      for (const file of files) {
        try {
          // Generate a name for clipboard images
          let fileName = file.name
          if (!fileName || fileName === 'image.png' || fileName === 'image.jpg' || fileName === 'blob') {
            const ext = file.type.split('/')[1] || 'png'
            fileName = `pasted-image-${Date.now()}.${ext}`
          }

          const attachment = await readFileAsAttachment(file, fileName)
          if (attachment) {
            setAttachments(prev => [...prev, attachment])
          }
        } catch (error) {
          console.error('[FreeFormInput] Failed to process pasted file:', error)
        }
        setLoadingCount(prev => prev - 1)
      }

      // Focus the textarea after adding attachments
      textareaRef.current?.focus()
    }

    window.addEventListener('craft:paste-files', handlePasteFiles as unknown as EventListener)
    return () => window.removeEventListener('craft:paste-files', handlePasteFiles as unknown as EventListener)
  }, [disabled, textareaRef])

  // Build active commands list for slash command menu
  const activeCommands = React.useMemo(() => {
    const active: SlashCommandId[] = []
    // Add the currently active permission mode
    if (permissionMode === 'safe') active.push('safe')
    else if (permissionMode === 'ask') active.push('ask')
    else if (permissionMode === 'allow-all') active.push('allow-all')
    if (ultrathinkEnabled) active.push('ultrathink')
    return active
  }, [permissionMode, ultrathinkEnabled])

  // Handle slash command selection
  const handleSlashCommand = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'safe') onPermissionModeChange?.('safe')
    else if (commandId === 'ask') onPermissionModeChange?.('ask')
    else if (commandId === 'allow-all') onPermissionModeChange?.('allow-all')
    else if (commandId === 'ultrathink') onUltrathinkChange?.(!ultrathinkEnabled)
  }, [permissionMode, ultrathinkEnabled, onPermissionModeChange, onUltrathinkChange])

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
  const readFileAsAttachment = async (file: File, overrideName?: string): Promise<FileAttachment | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const result = reader.result as ArrayBuffer
        const base64 = btoa(
          new Uint8Array(result).reduce((data, byte) => data + String.fromCharCode(byte), '')
        )

        let type: FileAttachment['type'] = 'unknown'
        const fileName = overrideName || file.name
        if (file.type.startsWith('image/')) type = 'image'
        else if (file.type === 'application/pdf') type = 'pdf'
        else if (file.type.includes('text') || fileName.match(/\.(txt|md|json|js|ts|tsx|py|css|html)$/i)) type = 'text'
        else if (file.type.includes('officedocument') || fileName.match(/\.(docx?|xlsx?|pptx?)$/i)) type = 'office'

        const mimeType = file.type || 'application/octet-stream'

        // For text files, decode the ArrayBuffer as UTF-8 text
        let text: string | undefined
        if (type === 'text') {
          text = new TextDecoder('utf-8').decode(new Uint8Array(result))
        }

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
          path: fileName,
          name: fileName,
          mimeType,
          base64,
          text,
          size: file.size,
          thumbnailBase64,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(file)
    })
  }

  // Clipboard paste handler for files/images
  const handlePaste = async (e: React.ClipboardEvent) => {
    if (disabled) return

    const clipboardItems = e.clipboardData?.files
    if (!clipboardItems || clipboardItems.length === 0) return

    // We have files to process - prevent default text paste behavior
    e.preventDefault()

    const files = Array.from(clipboardItems)
    setLoadingCount(prev => prev + files.length)

    for (const file of files) {
      try {
        // Generate a name for clipboard images (they often have no meaningful name)
        let fileName = file.name
        if (!fileName || fileName === 'image.png' || fileName === 'image.jpg' || fileName === 'blob') {
          const ext = file.type.split('/')[1] || 'png'
          fileName = `pasted-image-${Date.now()}.${ext}`
        }

        const attachment = await readFileAsAttachment(file, fileName)
        if (attachment) {
          setAttachments(prev => [...prev, attachment])
        }
      } catch (error) {
        console.error('[FreeFormInput] Failed to read pasted file:', error)
      }
      setLoadingCount(prev => prev - 1)
    }
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

  // Submit message - backend handles queueing and interruption
  const submitMessage = React.useCallback(() => {
    const hasContent = input.trim() || attachments.length > 0
    if (!hasContent || disabled) return false

    onSubmit(input.trim(), attachments.length > 0 ? attachments : undefined)
    setInput('')
    setAttachments([])
    // Clear draft immediately (cancel any pending debounced sync)
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    onInputChange?.('')
    prevInputValueRef.current = ''

    // Restore focus after state updates
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })

    return true
  }, [input, attachments, disabled, onInputChange, onSubmit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    submitMessage()
  }

  const handleStop = (silent = false) => {
    onStop?.(silent)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Tab cycles through permission modes
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      const currentIndex = PERMISSION_MODE_ORDER.indexOf(permissionMode)
      const nextIndex = (currentIndex + 1) % PERMISSION_MODE_ORDER.length
      const nextMode = PERMISSION_MODE_ORDER[nextIndex]
      onPermissionModeChange?.(nextMode)
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
      // Submit message - backend handles interruption if processing
      submitMessage()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      // Submit message - backend handles interruption if processing
      submitMessage()
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
          !unstyled && 'bg-background',
          isDraggingOver && 'ring-2 ring-foreground ring-offset-2 ring-offset-background bg-foreground/5'
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
            onPaste={handlePaste}
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
          {/* 1. Attach File Button */}
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent side="top">Attach files</TooltipContent>
          </Tooltip>

          {/* 2. Slash Command Button */}
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={slashButtonRef}
                  type="button"
                  className={cn(
                    "inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-[4px] hover:bg-foreground/5 transition-colors disabled:opacity-50 disabled:pointer-events-none",
                    slashDropdownOpen && "bg-foreground/5"
                  )}
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
              </TooltipTrigger>
              <TooltipContent side="top">Slash commands</TooltipContent>
            </Tooltip>
            {slashDropdownOpen && slashDropdownPosition && ReactDOM.createPortal(
              <>
                <div
                  className="fixed inset-0 z-[9998]"
                  onClick={() => setSlashDropdownOpen(false)}
                />
                <div
                  className="fixed popover-styled z-[9999] overflow-hidden"
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

          {/* 3. Source Selector Button - only show if onSourcesChange is provided */}
          {onSourcesChange && (
            <div className="relative">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={sourceButtonRef}
                    type="button"
                    className={cn(
                      "inline-flex items-center justify-center h-7 shrink-0 rounded-[6px] hover:bg-foreground/5 transition-colors disabled:opacity-50 disabled:pointer-events-none",
                      optimisticSourceSlugs.length === 0 && "w-7",
                      optimisticSourceSlugs.length > 0 && "px-0.5",
                      sourceDropdownOpen && "bg-foreground/5"
                    )}
                    disabled={disabled}
                    onClick={() => {
                      if (!sourceDropdownOpen && sourceButtonRef.current) {
                        const rect = sourceButtonRef.current.getBoundingClientRect()
                        setSourceDropdownPosition({
                          top: rect.top,
                          left: rect.left,
                        })
                        // Focus filter input after popover opens
                        setTimeout(() => sourceFilterInputRef.current?.focus(), 0)
                      } else {
                        // Clear filter when closing
                        setSourceFilter('')
                      }
                      setSourceDropdownOpen(!sourceDropdownOpen)
                    }}
                  >
                    {optimisticSourceSlugs.length === 0 ? (
                      <CloudCog className="h-4 w-4" />
                    ) : (
                      <div className="flex items-center">
                        {(() => {
                          const enabledSources = sources.filter(s => optimisticSourceSlugs.includes(s.config.slug))
                          const displaySources = enabledSources.slice(0, 3)
                          const remainingCount = enabledSources.length - 3
                          return (
                            <>
                              {displaySources.map((source, index) => (
                                <div
                                  key={source.config.slug}
                                  className={cn("relative h-6 w-6 rounded-[6px] bg-background shadow-minimal flex items-center justify-center", index > 0 && "-ml-1.5")}
                                  style={{ zIndex: index + 1 }}
                                >
                                  <SourceAvatar source={source} size="sm" />
                                </div>
                              ))}
                              {remainingCount > 0 && (
                                <div
                                  className="-ml-1.5 h-6 w-6 rounded-[6px] bg-background shadow-minimal flex items-center justify-center text-[9px] font-medium text-muted-foreground"
                                  style={{ zIndex: displaySources.length + 1 }}
                                >
                                  +{remainingCount}
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Sources</TooltipContent>
              </Tooltip>
              {sourceDropdownOpen && sourceDropdownPosition && ReactDOM.createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998]"
                    onClick={() => {
                      setSourceDropdownOpen(false)
                      setSourceFilter('')
                    }}
                  />
                  <div
                    className="fixed z-[9999] min-w-[200px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small"
                    style={{
                      top: sourceDropdownPosition.top - 8,
                      left: sourceDropdownPosition.left,
                      transform: 'translateY(-100%)',
                    }}
                  >
                    {sources.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-3">
                        No sources configured.
                        <br />
                        Add sources in Settings.
                      </div>
                    ) : (
                      <CommandPrimitive
                        className="min-w-[200px]"
                        shouldFilter={false}
                      >
                        <div className="border-b border-border/50 px-3 py-2">
                          <CommandPrimitive.Input
                            ref={sourceFilterInputRef}
                            value={sourceFilter}
                            onValueChange={setSourceFilter}
                            placeholder="Search sources..."
                            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                        <CommandPrimitive.List className="max-h-[240px] overflow-y-auto p-1">
                          {sources
                            .filter(source => source.config.name.toLowerCase().includes(sourceFilter.toLowerCase()))
                            .map(source => {
                              const isEnabled = optimisticSourceSlugs.includes(source.config.slug)
                              return (
                                <CommandPrimitive.Item
                                  key={source.config.slug}
                                  value={source.config.slug}
                                  onSelect={() => {
                                    const newSlugs = isEnabled
                                      ? optimisticSourceSlugs.filter(slug => slug !== source.config.slug)
                                      : [...optimisticSourceSlugs, source.config.slug]
                                    // Optimistic update - UI updates immediately
                                    setOptimisticSourceSlugs(newSlugs)
                                    // Then trigger async server update
                                    onSourcesChange?.(newSlugs)
                                  }}
                                  className={cn(
                                    "flex cursor-pointer select-none items-center gap-3 rounded-[6px] px-3 py-2 text-[13px]",
                                    "outline-none data-[selected=true]:bg-foreground/5",
                                    isEnabled && "bg-foreground/3"
                                  )}
                                >
                                  <div className="shrink-0 text-muted-foreground flex items-center">
                                    <SourceAvatar
                                      source={source}
                                      size="sm"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0 truncate">{source.config.name}</div>
                                  <div className={cn(
                                    "shrink-0 h-4 w-4 rounded-full bg-current flex items-center justify-center",
                                    !isEnabled && "opacity-0"
                                  )}>
                                    <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
                                  </div>
                                </CommandPrimitive.Item>
                              )
                            })}
                        </CommandPrimitive.List>
                      </CommandPrimitive>
                    )}
                  </div>
                </>,
                document.body
              )}
            </div>
          )}

          {/* 4. Model Selector */}
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={modelButtonRef}
                  type="button"
                  className={cn(
                    "inline-flex items-center h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 transition-colors",
                    modelDropdownOpen && "bg-foreground/5"
                  )}
                  onClick={() => {
                    if (!modelDropdownOpen && modelButtonRef.current) {
                      // Calculate position when opening
                      const rect = modelButtonRef.current.getBoundingClientRect()
                      setModelDropdownPosition({
                        top: rect.top,
                        left: rect.left, // Align left edge of dropdown with left edge of button
                      })
                    }
                    setModelDropdownOpen(!modelDropdownOpen)
                  }}
                >
                  {getModelDisplayName(currentModel)}
                  <ChevronDown className="opacity-50" style={{ width: 12, height: 12 }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Model</TooltipContent>
            </Tooltip>
            {modelDropdownOpen && modelDropdownPosition && ReactDOM.createPortal(
              <>
                {/* Backdrop to close on click outside */}
                <div
                  className="fixed inset-0 z-[9998]"
                  onClick={() => setModelDropdownOpen(false)}
                />
                <div
                  className="fixed popover-styled p-2 min-w-[280px] z-[9999]"
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
                          className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-foreground/3 transition-colors"
                        >
                          <div className="text-left">
                            <div className="font-medium text-sm">{model.name}</div>
                            <div className="text-xs text-muted-foreground">{descriptions[model.id] || model.description}</div>
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 text-foreground shrink-0 ml-3" />
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

          {/* 5. Working Directory Selector */}
          {workingDirectory && onWorkingDirectoryChange && (
            <WorkingDirectorySelector
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={onWorkingDirectoryChange}
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Send/Stop Button - Always show stop when processing */}
          {isProcessing ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 rounded-full shrink-0 hover:bg-foreground/15 active:bg-foreground/20"
              onClick={() => handleStop(false)}
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
 * Format path for display, replacing home directory with home icon
 */
function formatPathForDisplay(path: string, homeDir: string): string {
  if (homeDir && path.startsWith(homeDir)) {
    const relativePath = path.slice(homeDir.length)
    return `~${relativePath || '/'}`
  }
  return path
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
  const [dropdownOpen, setDropdownOpen] = React.useState(false)
  const [homeDir, setHomeDir] = React.useState<string>('')

  // Load home directory and recent directories on mount
  React.useEffect(() => {
    setRecentDirs(getRecentDirs())
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
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
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <Tooltip open={dropdownOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 data-[state=open]:bg-foreground/5 transition-colors max-w-[160px]"
            >
              <span className="truncate">{workingDirectory.split('/').pop() || 'Home'}</span>
              <ChevronDown className="opacity-50 shrink-0" style={{ width: 12, height: 12 }} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex flex-col gap-0.5">
          <span className="font-medium">Working directory</span>
          <span className="text-xs opacity-70">{formatPathForDisplay(workingDirectory, homeDir)}</span>
        </TooltipContent>
      </Tooltip>
      <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="w-auto min-w-[200px] max-w-[400px]">
        {/* Recent Directories */}
        {filteredRecent.length > 0 && (
          <>
            {filteredRecent.map((path) => (
              <StyledDropdownMenuItem
                key={path}
                onClick={() => handleSelectRecent(path)}
                className="text-sm"
              >
                <span className="whitespace-nowrap">{formatPathForDisplay(path, homeDir)}</span>
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
