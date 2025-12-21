import * as React from 'react'
import {
  Paperclip,
  ArrowUp,
  Square,
  ChevronDown,
  Zap,
  ShieldOff,
  SquareSlash,
  Brain,
  FileCheck,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { AttachmentPreview } from '../AttachmentPreview'
import { MODELS, getModelDisplayName } from '@config/models'
import type { FileAttachment } from '../../../../shared/types'

/** Slash command options */
type SlashCommandOption = 'plan' | 'ultrathink' | 'skip-permissions'

interface SlashCommandConfig {
  id: SlashCommandOption
  label: string
  description: string
  icon: React.ReactNode
  activeStyle: string
}

const SLASH_COMMANDS: SlashCommandConfig[] = [
  {
    id: 'plan',
    label: 'Plan Mode',
    description: 'Enter planning mode for complex tasks',
    icon: <Brain className="h-3.5 w-3.5" />,
    activeStyle: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  },
  {
    id: 'ultrathink',
    label: 'Ultrathink',
    description: 'Extended reasoning for complex problems',
    icon: <Zap className="h-3.5 w-3.5" />,
    activeStyle: 'bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20 text-fuchsia-500 border-fuchsia-500/30 shadow-[0_0_12px_rgba(217,70,239,0.2)]',
  },
  {
    id: 'skip-permissions',
    label: 'Skip Permissions',
    description: 'Auto-approve all permission prompts',
    icon: <ShieldOff className="h-3.5 w-3.5" />,
    activeStyle: 'bg-red-500/10 text-red-500 border-red-500/30',
  },
]

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

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
    }
  }, [])
  const [isDraggingOver, setIsDraggingOver] = React.useState(false)
  const [loadingCount, setLoadingCount] = React.useState(0)
  const [slashMenuOpen, setSlashMenuOpen] = React.useState(false)
  const [slashDropdownOpen, setSlashDropdownOpen] = React.useState(false)
  const [slashFilter, setSlashFilter] = React.useState('')

  const dragCounterRef = React.useRef(0)

  // Merge refs
  const internalRef = React.useRef<HTMLTextAreaElement>(null)
  const textareaRef = externalTextareaRef || internalRef

  // File attachment handlers
  const handleAttachClick = async () => {
    if (disabled) return
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
        try {
          const thumb = await window.electronAPI.generateThumbnail(base64, mimeType)
          if (thumb) thumbnailBase64 = thumb
        } catch (err) {
          console.log('[FreeFormInput] Thumbnail generation failed:', err)
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
      if (filePath) {
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit(e)
    }
    if (e.key === 'Escape') {
      if (isProcessing) {
        handleStop()
      } else {
        textareaRef.current?.blur()
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let value = e.target.value

    // Check for slash command trigger
    const slashMatch = value.match(/(?:^|\s)\/(\w*)$/)
    if (slashMatch) {
      setSlashMenuOpen(true)
      setSlashFilter(slashMatch[1] || '')
    } else if (slashMenuOpen) {
      setSlashMenuOpen(false)
      setSlashFilter('')
    }

    // Auto-capitalize first letter (but not for slash commands)
    if (value.length > 0 && value.charAt(0) !== '/') {
      value = value.charAt(0).toUpperCase() + value.slice(1)
    }

    setInput(value)
    syncToParent(value) // Debounced sync to parent for draft persistence
  }

  const hasContent = input.trim() || attachments.length > 0

  return (
    <form onSubmit={handleSubmit}>
      <div
        className={cn(
          'overflow-hidden transition-all',
          // Container styling - only when not wrapped by InputContainer
          !unstyled && 'rounded-[8px] bg-background shadow-middle',
          isDraggingOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5'
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Slash Command Autocomplete Menu */}
        <DropdownMenu open={slashMenuOpen} onOpenChange={(open) => {
          setSlashMenuOpen(open)
          if (!open) {
            setSlashFilter('')
            textareaRef.current?.focus()
          }
        }}>
          <DropdownMenuTrigger asChild>
            <div className="absolute bottom-full left-4 w-0 h-0" />
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="w-72 p-1">
            {SLASH_COMMANDS.filter(cmd =>
              !slashFilter || cmd.label.toLowerCase().includes(slashFilter.toLowerCase()) || cmd.id.includes(slashFilter.toLowerCase())
            ).map((cmd) => {
              const isActive =
                (cmd.id === 'plan' && planModeEnabled) ||
                (cmd.id === 'ultrathink' && ultrathinkEnabled) ||
                (cmd.id === 'skip-permissions' && skipPermissions)
              return (
                <StyledDropdownMenuItem
                  key={cmd.id}
                  onClick={() => {
                    if (cmd.id === 'plan') onPlanModeChange?.(!planModeEnabled)
                    else if (cmd.id === 'ultrathink') onUltrathinkChange?.(!ultrathinkEnabled)
                    else if (cmd.id === 'skip-permissions') onSkipPermissionsChange?.(!skipPermissions)
                    const newValue = input.replace(/(?:^|\s)\/\w*$/, '').trim()
                    setInput(newValue)
                    syncToParent(newValue)
                  }}
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 cursor-pointer',
                    isActive && 'bg-foreground/5'
                  )}
                >
                  <div className="mt-0.5 shrink-0">{cmd.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{cmd.label}</div>
                    <div className="text-xs text-muted-foreground whitespace-normal">{cmd.description}</div>
                  </div>
                  {isActive && <FileCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />}
                </StyledDropdownMenuItem>
              )
            })}
            {SLASH_COMMANDS.filter(cmd =>
              !slashFilter || cmd.label.toLowerCase().includes(slashFilter.toLowerCase()) || cmd.id.includes(slashFilter.toLowerCase())
            ).length === 0 && (
              <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                No matching commands
              </div>
            )}
          </StyledDropdownMenuContent>
        </DropdownMenu>

        {/* Attachment Preview */}
        <AttachmentPreview
          attachments={attachments}
          onRemove={handleRemoveAttachment}
          disabled={disabled}
          loadingCount={loadingCount}
        />

        {/* Textarea */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            className="w-full min-h-[72px] pl-5 pr-4 pt-4 pb-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
            placeholder={placeholder}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            disabled={disabled}
            rows={1}
          />
        </div>

        {/* Bottom Row: Controls */}
        <div className="flex items-center gap-1 px-2 py-2 border-t border-border/50">
          {/* Slash Command Button */}
          <DropdownMenu open={slashDropdownOpen} onOpenChange={setSlashDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={disabled}
              >
                <SquareSlash className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent side="top" align="start" sideOffset={8} className="w-72 p-1">
              {SLASH_COMMANDS.map((cmd) => {
                const isActive =
                  (cmd.id === 'plan' && planModeEnabled) ||
                  (cmd.id === 'ultrathink' && ultrathinkEnabled) ||
                  (cmd.id === 'skip-permissions' && skipPermissions)
                return (
                  <StyledDropdownMenuItem
                    key={cmd.id}
                    onClick={() => {
                      if (cmd.id === 'plan') onPlanModeChange?.(!planModeEnabled)
                      else if (cmd.id === 'ultrathink') onUltrathinkChange?.(!ultrathinkEnabled)
                      else if (cmd.id === 'skip-permissions') onSkipPermissionsChange?.(!skipPermissions)
                    }}
                    className={cn(
                      'flex items-start gap-3 px-3 py-2.5 cursor-pointer',
                      isActive && 'bg-foreground/5'
                    )}
                  >
                    <div className="mt-0.5 shrink-0">{cmd.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{cmd.label}</div>
                      <div className="text-xs text-muted-foreground whitespace-normal">{cmd.description}</div>
                    </div>
                    {isActive && <FileCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />}
                  </StyledDropdownMenuItem>
                )
              })}
            </StyledDropdownMenuContent>
          </DropdownMenu>

          {/* Attach File Button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
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
                className="h-7 gap-1 text-xs shrink-0 hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
              >
                {getModelDisplayName(currentModel)}
                <ChevronDown className="h-3 w-3 opacity-50" />
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

          {/* Active Options Badges */}
          {planModeEnabled && (
            <button
              type="button"
              onClick={() => onPlanModeChange?.(false)}
              className="h-6 px-2 text-[11px] font-medium rounded-[4px] flex items-center gap-1 transition-all bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20"
            >
              <Brain className="h-3 w-3" />
              <span>Plan</span>
              <X className="h-3 w-3 ml-0.5 opacity-60 hover:opacity-100" />
            </button>
          )}

          {ultrathinkEnabled && (
            <button
              type="button"
              onClick={() => onUltrathinkChange?.(false)}
              className="h-6 px-2 text-[11px] font-medium rounded-[4px] flex items-center gap-1 transition-all bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20 text-fuchsia-500 border border-fuchsia-500/30 shadow-[0_0_12px_rgba(217,70,239,0.2)] hover:from-violet-500/30 hover:via-fuchsia-500/30 hover:to-pink-500/30"
            >
              <Zap className="h-3 w-3 fill-fuchsia-500" />
              <span>Ultrathink</span>
              <X className="h-3 w-3 ml-0.5 opacity-60 hover:opacity-100" />
            </button>
          )}

          {skipPermissions && (
            <button
              type="button"
              onClick={() => onSkipPermissionsChange?.(false)}
              className="h-6 px-2 text-[11px] font-medium rounded-[4px] flex items-center gap-1 transition-all bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
            >
              <ShieldOff className="h-3 w-3" />
              <span>Skip Perms</span>
              <X className="h-3 w-3 ml-0.5 opacity-60 hover:opacity-100" />
            </button>
          )}

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
