import * as React from 'react'
import {
  Paperclip,
  ArrowUp,
  Square,
  ChevronDown,
  SquareSlash,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import {
  SlashCommandMenu,
  InlineSlashCommand,
  useInlineSlashCommand,
  DEFAULT_SLASH_COMMANDS,
  type SlashCommandId,
} from '@/components/ui/slash-command-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { AttachmentPreview } from '../AttachmentPreview'
import { MODELS, getModelDisplayName } from '@config/models'
import type { FileAttachment } from '../../../../shared/types'

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
  planModeEnabled?: boolean
  onPlanModeChange?: (enabled: boolean) => void
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
  planModeEnabled = false,
  onPlanModeChange,
  inputValue,
  onInputChange,
  unstyled = false,
  onHeightChange,
  onFocusChange,
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
  const [isFocused, setIsFocused] = React.useState(false)

  const dragCounterRef = React.useRef(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Merge refs
  const internalRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalRef

  // Build active commands list for slash command menu
  const activeCommands = React.useMemo(() => {
    const active: SlashCommandId[] = []
    if (planModeEnabled) active.push('plan')
    if (ultrathinkEnabled) active.push('ultrathink')
    if (skipPermissions) active.push('skip-permissions')
    return active
  }, [planModeEnabled, ultrathinkEnabled, skipPermissions])

  // Handle slash command selection
  const handleSlashCommand = React.useCallback((commandId: SlashCommandId) => {
    if (commandId === 'plan') onPlanModeChange?.(!planModeEnabled)
    else if (commandId === 'ultrathink') onUltrathinkChange?.(!ultrathinkEnabled)
    else if (commandId === 'skip-permissions') onSkipPermissionsChange?.(!skipPermissions)
  }, [planModeEnabled, ultrathinkEnabled, skipPermissions, onPlanModeChange, onUltrathinkChange, onSkipPermissionsChange])

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
    // Shift+Tab toggles plan mode
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      onPlanModeChange?.(!planModeEnabled)
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
      handleSubmit(e)
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
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
          <Popover open={slashDropdownOpen} onOpenChange={setSlashDropdownOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-[4px]"
                disabled={disabled}
              >
                <SquareSlash className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" sideOffset={8} className="p-0 w-auto border-0">
              <SlashCommandMenu
                commands={DEFAULT_SLASH_COMMANDS}
                activeCommands={activeCommands}
                onSelect={(commandId) => {
                  handleSlashCommand(commandId)
                  setSlashDropdownOpen(false)
                }}
                showFilter
              />
            </PopoverContent>
          </Popover>

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

          {/* Model Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 gap-0.5 text-[13px] shrink-0 rounded-[6px] hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
              >
                {getModelDisplayName(currentModel)}
                <ChevronDown className="opacity-50" style={{ width: 12, height: 12 }} />
              </Button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent side="top" align="start" sideOffset={8}>
              {MODELS.map((model) => (
                <StyledDropdownMenuItem
                  key={model.id}
                  onClick={() => onModelChange(model.id)}
                  className={cn(currentModel === model.id && 'bg-foreground/10')}
                >
                  {model.name}
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Send/Stop Button */}
          {hasContent || !isProcessing ? (
            <Button
              type="submit"
              size="icon"
              className="h-7 w-7 rounded-full shrink-0"
              disabled={!hasContent || disabled}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 rounded-full shrink-0 hover:bg-foreground/15 active:bg-foreground/20"
              onClick={handleStop}
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
