import * as React from 'react'
import type { ComponentEntry } from './types'
import { motion, AnimatePresence, animate } from 'motion/react'
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
  Shield,
  Check,
  RefreshCw,
  MessageCircleQuestion,
  SkipForward,
  ClipboardList,
  MessageSquare,
  Wrench,
  Type,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { MODELS, getModelDisplayName } from '@config/models'

// ============================================================================
// Playground-specific Input Components
// These are simplified versions that don't require window.electronAPI
// ============================================================================

// --- FreeFormInput (Playground Version) ---

interface FreeFormInputPlaygroundProps {
  placeholder?: string
  disabled?: boolean
  isProcessing?: boolean
  currentModel: string
  ultrathinkEnabled?: boolean
  skipPermissions?: boolean
  planModeEnabled?: boolean
  // Controlled input (optional - for persisting across mode switches)
  inputValue?: string
  onInputChange?: (value: string) => void
  /** When true, removes container styling - used when wrapped by animated container */
  unstyled?: boolean
}

function FreeFormInputPlayground({
  placeholder = 'Message...',
  disabled = false,
  isProcessing = false,
  currentModel,
  ultrathinkEnabled = false,
  skipPermissions = false,
  planModeEnabled = false,
  inputValue,
  onInputChange,
  unstyled = false,
}: FreeFormInputPlaygroundProps) {
  // Support both controlled and uncontrolled modes
  const [internalInput, setInternalInput] = React.useState('')
  const isControlled = inputValue !== undefined
  const input = isControlled ? inputValue : internalInput
  const setInput = isControlled ? (onInputChange ?? (() => {})) : setInternalInput
  const [slashDropdownOpen, setSlashDropdownOpen] = React.useState(false)
  const [ultrathink, setUltrathink] = React.useState(ultrathinkEnabled)
  const [skipPerms, setSkipPerms] = React.useState(skipPermissions)
  const [planMode, setPlanMode] = React.useState(planModeEnabled)
  const [model, setModel] = React.useState(currentModel)

  React.useEffect(() => {
    setUltrathink(ultrathinkEnabled)
  }, [ultrathinkEnabled])

  React.useEffect(() => {
    setSkipPerms(skipPermissions)
  }, [skipPermissions])

  React.useEffect(() => {
    setPlanMode(planModeEnabled)
  }, [planModeEnabled])

  React.useEffect(() => {
    setModel(currentModel)
  }, [currentModel])

  const SLASH_COMMANDS = [
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

  const hasContent = input.trim().length > 0

  return (
    <div
      className={cn(
        'bg-background overflow-hidden transition-all',
        !unstyled && 'rounded-[8px] shadow-middle'
      )}
    >
      {/* Textarea */}
      <div className="relative">
        <textarea
          className="w-full min-h-[72px] pl-5 pr-4 pt-4 pb-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
                (cmd.id === 'plan' && planMode) ||
                (cmd.id === 'ultrathink' && ultrathink) ||
                (cmd.id === 'skip-permissions' && skipPerms)
              return (
                <StyledDropdownMenuItem
                  key={cmd.id}
                  onClick={() => {
                    if (cmd.id === 'plan') setPlanMode(!planMode)
                    else if (cmd.id === 'ultrathink') setUltrathink(!ultrathink)
                    else if (cmd.id === 'skip-permissions') setSkipPerms(!skipPerms)
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
              {getModelDisplayName(model)}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent side="top" align="start" sideOffset={8}>
            {MODELS.map((m) => (
              <StyledDropdownMenuItem
                key={m.id}
                onClick={() => setModel(m.id)}
                className={cn(model === m.id && 'bg-foreground/10')}
              >
                {m.name}
              </StyledDropdownMenuItem>
            ))}
          </StyledDropdownMenuContent>
        </DropdownMenu>

        {/* Active Options Badges */}
        {planMode && (
          <button
            type="button"
            onClick={() => setPlanMode(false)}
            className="h-6 px-2 text-[11px] font-medium rounded-[4px] flex items-center gap-1 transition-all bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20"
          >
            <Brain className="h-3 w-3" />
            <span>Plan</span>
            <X className="h-3 w-3 ml-0.5 opacity-60 hover:opacity-100" />
          </button>
        )}

        {ultrathink && (
          <button
            type="button"
            onClick={() => setUltrathink(false)}
            className="h-6 px-2 text-[11px] font-medium rounded-[4px] flex items-center gap-1 transition-all bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20 text-fuchsia-500 border border-fuchsia-500/30 shadow-[0_0_12px_rgba(217,70,239,0.2)] hover:from-violet-500/30 hover:via-fuchsia-500/30 hover:to-pink-500/30"
          >
            <Zap className="h-3 w-3 fill-fuchsia-500" />
            <span>Ultrathink</span>
            <X className="h-3 w-3 ml-0.5 opacity-60 hover:opacity-100" />
          </button>
        )}

        {skipPerms && (
          <button
            type="button"
            onClick={() => setSkipPerms(false)}
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
            type="button"
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
          >
            <Square className="h-3 w-3 fill-current" />
          </Button>
        )}
      </div>
    </div>
  )
}

// --- PermissionRequest (Playground Version) ---

interface PermissionRequestPlaygroundProps {
  toolName?: string
  description?: string
  command?: string
  onAction?: () => void
  unstyled?: boolean
}

function PermissionRequestPlayground({
  toolName = 'Bash',
  description = 'Execute a shell command to list files in the current directory',
  command = 'ls -la /Users/demo/projects',
  onAction,
  unstyled = false,
}: PermissionRequestPlaygroundProps) {
  return (
    <div className={cn(
      'bg-[#fffcf5] dark:bg-[#1a1608] overflow-hidden h-full flex flex-col',
      unstyled ? 'border-0' : 'border border-amber-500/30 rounded-[8px] shadow-middle'
    )}>
      {/* Content - grows to fill available space */}
      <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col">
        {/* Header with shield icon */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <Shield className="h-5 w-5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Permission Required</span>
              <span className="text-xs text-muted-foreground">({toolName})</span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>

        {/* Command preview */}
        {command && (
          <div className="bg-foreground/5 rounded-md p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
            {command}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5"
          onClick={onAction}
        >
          <Check className="h-3.5 w-3.5" />
          Allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
          onClick={onAction}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Always Allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-red-600 dark:text-red-400 hover:text-red-600 dark:hover:text-red-400 border border-dashed border-red-500/50 hover:bg-red-500/10 hover:border-red-500/70 active:bg-red-500/20"
          onClick={onAction}
        >
          <X className="h-3.5 w-3.5" />
          Deny
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tip text */}
        <span className="text-[10px] text-muted-foreground">
          "Always Allow" remembers this command for the session
        </span>
      </div>
    </div>
  )
}

// --- ClarificationQuestion (Playground Version) ---

interface ClarificationOption {
  label: string
  description: string
}

interface ClarificationQuestionPlaygroundProps {
  header?: string
  question?: string
  options?: ClarificationOption[]
  multiSelect?: boolean
  onAction?: () => void
  unstyled?: boolean
}

function ClarificationQuestionPlayground({
  header = 'Budget',
  question = "What's your budget for this trip?",
  options = [
    { label: 'Under €500', description: 'Budget-friendly options' },
    { label: '€500-1000', description: 'Mid-range options' },
    { label: '€1000+', description: 'Premium options' },
  ],
  multiSelect = false,
  onAction,
  unstyled = false,
}: ClarificationQuestionPlaygroundProps) {
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(new Set())

  const handleOptionClick = (index: number) => {
    if (multiSelect) {
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
      // Single select - trigger action immediately
      setSelectedIndices(new Set([index]))
      onAction?.()
    }
  }

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
            {header && (
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {header}
              </div>
            )}
            <p className="text-sm font-medium text-foreground">{question}</p>
          </div>
        </div>

        {/* Options */}
        <div className="grid gap-2">
          {options.map((option, index) => {
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
          {multiSelect ? (
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
          onClick={onAction}
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip
        </Button>

        {multiSelect && (
          <Button
            size="sm"
            variant="default"
            className="h-7"
            disabled={selectedIndices.size === 0}
            onClick={onAction}
          >
            Submit
          </Button>
        )}
      </div>
    </div>
  )
}

// --- PlanReview (Playground Version) ---

interface PlanStep {
  description: string
  tools?: string[]
}

interface PlanReviewPlaygroundProps {
  title?: string
  summary?: string
  steps?: PlanStep[]
  questions?: string[]
  onAction?: () => void
  unstyled?: boolean
}

function PlanReviewPlayground({
  title = 'Trip Planning Workflow',
  summary = 'Search for flights and hotels, compare options, and create a detailed itinerary document.',
  steps = [
    { description: 'Search for available flights to Barcelona', tools: ['WebSearch', 'WebFetch'] },
    { description: 'Compare hotel options near the city center', tools: ['WebSearch'] },
    { description: 'Create itinerary document in Craft', tools: ['mcp__craft__documents_create', 'mcp__craft__blocks_add'] },
    { description: 'Add flight and hotel details to the document' },
  ],
  questions = [],
  onAction,
  unstyled = false,
}: PlanReviewPlaygroundProps) {
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
            <ClipboardList className="h-5 w-5 text-green-600 dark:text-green-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">{title}</div>
            <p className="text-xs text-muted-foreground">{summary}</p>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {steps.map((step, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
            >
              {/* Step number */}
              <div className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                {index + 1}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="text-sm">{step.description}</div>
                {step.tools && step.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {step.tools.map((tool, toolIndex) => (
                      <span
                        key={toolIndex}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-foreground/5 text-muted-foreground"
                      >
                        <Wrench className="h-2.5 w-2.5" />
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Questions (if any) */}
        {questions && questions.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Questions</span>
            </div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground/50">•</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/50">
        {/* Left side: step count */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{steps.length} steps</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side: actions */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5"
          onClick={onAction}
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 border border-foreground/10"
          onClick={onAction}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Refine
        </Button>

        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5"
          onClick={onAction}
        >
          <Check className="h-3.5 w-3.5" />
          Approve
          <kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd>
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// Shared constants for input animations
// ============================================================================

// Crossfade duration - synced with container height animation
const TRANSITION_DURATION = 0.25
const TRANSITION_EASE = [0.4, 0, 0.2, 1] as const

// ============================================================================
// Input Transitions - Full app-like layout for testing animations
// ============================================================================

// Placeholder message bubbles to simulate real chat
const PLACEHOLDER_MESSAGES = [
  { role: 'user', content: 'Can you help me plan a trip to Barcelona?' },
  { role: 'assistant', content: 'Of course! I\'d be happy to help you plan a trip to Barcelona. Let me gather some information first. Barcelona is a beautiful city with amazing architecture, beaches, and cuisine.' },
  { role: 'user', content: 'I want to focus on Gaudi\'s architecture and good food.' },
  { role: 'assistant', content: 'Great choices! Barcelona is famous for Gaudí\'s masterpieces like Sagrada Família, Park Güell, and Casa Batlló. The food scene is incredible too - from traditional tapas to Michelin-starred restaurants. Let me create a plan for you.' },
]

// Mode options for the switcher
const MODE_OPTIONS = [
  { id: 'freeform', label: 'Input', color: null },
  { id: 'permission', label: 'Permission', color: 'bg-amber-500' },
  { id: 'clarification', label: 'Clarification', color: 'bg-primary' },
  { id: 'plan', label: 'Plan Review', color: 'bg-green-500' },
]

// Fallback heights (used on first render before measurement)
const FALLBACK_HEIGHTS: Record<string, number> = {
  freeform: 120,
  permission: 200,
  clarification: 280,
  plan: 300,
}

type HeightMode = 'freeform' | 'permission' | 'clarification' | 'plan'

function InputTransitions() {
  const [heightMode, setHeightMode] = React.useState<HeightMode>('freeform')
  const [inputValue, setInputValue] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const measureRef = React.useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = React.useState<number | null>(null)
  const prevHeightRef = React.useRef<number>(FALLBACK_HEIGHTS.freeform)
  const hasInitializedRef = React.useRef(false)

  // Use ResizeObserver to continuously watch content height via hidden measuring div
  React.useEffect(() => {
    const measureEl = measureRef.current
    if (!measureEl) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        if (height > 0) {
          setMeasuredHeight(height)
          // Mark as initialized after first measurement
          if (!hasInitializedRef.current) {
            requestAnimationFrame(() => {
              hasInitializedRef.current = true
            })
          }
        }
      }
    })

    observer.observe(measureEl)
    return () => observer.disconnect()
  }, [heightMode])

  // Use measured height, or fallback if not yet measured
  const currentHeight = measuredHeight ?? FALLBACK_HEIGHTS[heightMode] ?? FALLBACK_HEIGHTS.freeform

  // Total space the input takes including margin
  const inputTotalHeight = currentHeight + 16 // 16px = mb-4

  // Animate scroll position in sync with height changes
  React.useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const heightDelta = currentHeight - prevHeightRef.current
    if (heightDelta !== 0) {
      const startScroll = scrollEl.scrollTop
      const targetScroll = startScroll + heightDelta

      // Animate scrollTop in sync with the layout animation
      animate(startScroll, targetScroll, {
        duration: TRANSITION_DURATION,
        ease: TRANSITION_EASE,
        onUpdate: (value) => {
          scrollEl.scrollTop = value
        },
      })
    }
    prevHeightRef.current = currentHeight
  }, [currentHeight])

  // Render the current content (used for both measuring and display)
  const renderContent = (forMeasuring: boolean) => {
    if (heightMode === 'freeform') {
      return (
        <FreeFormInputPlayground
          currentModel="claude-sonnet-4-20250514"
          inputValue={forMeasuring ? inputValue : inputValue}
          onInputChange={forMeasuring ? () => {} : setInputValue}
          unstyled
        />
      )
    }
    if (heightMode === 'permission') {
      return (
        <PermissionRequestPlayground
          toolName="Bash"
          description="Execute a shell command to install dependencies"
          command="npm install && npm run build"
          onAction={forMeasuring ? () => {} : () => setHeightMode('freeform')}
          unstyled
        />
      )
    }
    if (heightMode === 'clarification') {
      return (
        <ClarificationQuestionPlayground
          header="Budget"
          question="What's your budget for this trip?"
          options={[
            { label: 'Under €500', description: 'Budget-friendly options' },
            { label: '€500-1000', description: 'Mid-range options' },
            { label: '€1000+', description: 'Premium options' },
          ]}
          onAction={forMeasuring ? () => {} : () => setHeightMode('freeform')}
          unstyled
        />
      )
    }
    return (
      <PlanReviewPlayground
        title="Trip Planning Workflow"
        summary="Search for flights and hotels, then create an itinerary."
        steps={[
          { description: 'Search for flights to Barcelona', tools: ['WebSearch'] },
          { description: 'Compare hotel options', tools: ['WebSearch'] },
          { description: 'Create itinerary in Craft', tools: ['mcp__craft__blocks_add'] },
        ]}
        onAction={forMeasuring ? () => {} : () => setHeightMode('freeform')}
        unstyled
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top: Height Switcher */}
      <div className="shrink-0 p-4 border-b border-border/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-foreground/80">Height + Crossfade Test</h2>
          <div className="text-xs text-muted-foreground">
            Dynamic height via ResizeObserver ({currentHeight}px)
          </div>
        </div>
        <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit">
          {MODE_OPTIONS.map((h) => (
            <button
              key={h.id}
              onClick={() => setHeightMode(h.id as HeightMode)}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                heightMode === h.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              )}
            >
              {h.color && <div className={cn('w-3 h-3 rounded-sm', h.color)} />}
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content area: positioned container for messages + input */}
      <div className="flex-1 min-h-0 relative">
        {/* Messages: absolute positioned, bottom offset animated to make room for input */}
        <motion.div
          ref={scrollRef}
          className="absolute inset-x-0 top-0 overflow-y-auto p-4 space-y-4"
          animate={{ bottom: inputTotalHeight }}
          transition={{ duration: TRANSITION_DURATION, ease: TRANSITION_EASE }}
        >
          {PLACEHOLDER_MESSAGES.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[80%] p-3 rounded-lg text-sm',
                msg.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              )}
            >
              {msg.content}
            </div>
          ))}
          <div className="h-4" />
        </motion.div>

        {/* Hidden measuring div - renders content off-screen to measure natural height */}
        <div
          ref={measureRef}
          className="absolute top-0 left-4 right-4 invisible pointer-events-none"
          aria-hidden="true"
        >
          <div className="rounded-[8px] bg-background overflow-hidden">
            {renderContent(true)}
          </div>
        </div>

        {/* Input: absolute positioned at bottom, height animated */}
        <motion.div
          className="absolute inset-x-4 bottom-4 rounded-[8px] bg-background shadow-middle overflow-hidden"
          initial={false}
          animate={{ height: currentHeight }}
          transition={{ duration: hasInitializedRef.current && measuredHeight !== null ? TRANSITION_DURATION : 0, ease: TRANSITION_EASE }}
        >
          {/* Crossfading content - all children absolute positioned */}
          <AnimatePresence mode="sync" initial={false}>
            <motion.div
              key={heightMode}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: TRANSITION_DURATION, ease: TRANSITION_EASE }}
            >
              {renderContent(false)}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}


// ============================================================================
// Component Registry Entries
// ============================================================================

export const inputComponents: ComponentEntry[] = [
  {
    id: 'input-transitions',
    name: 'Input Transitions',
    category: 'Chat Inputs',
    description: 'Full app-like layout for testing input animations with messages above and input at bottom',
    component: InputTransitions,
    layout: 'full',
    props: [],
    variants: [],
    mockData: () => ({}),
  },
  {
    id: 'freeform-input',
    name: 'FreeFormInput',
    category: 'Chat Inputs',
    description: 'Main text input with model selector, slash commands, and attachments',
    component: FreeFormInputPlayground,
    props: [
      {
        name: 'placeholder',
        description: 'Placeholder text',
        control: { type: 'string', placeholder: 'Message...' },
        defaultValue: 'Message Chat...',
      },
      {
        name: 'disabled',
        description: 'Disable the input',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isProcessing',
        description: 'Show stop button instead of send',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'currentModel',
        description: 'Currently selected model',
        control: {
          type: 'select',
          options: MODELS.map(m => ({ label: m.name, value: m.id })),
        },
        defaultValue: 'claude-sonnet-4-20250514',
      },
      {
        name: 'planModeEnabled',
        description: 'Plan mode badge active',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'ultrathinkEnabled',
        description: 'Ultrathink badge active',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'skipPermissions',
        description: 'Skip permissions badge active',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Default', props: { currentModel: 'claude-sonnet-4-20250514' } },
      { name: 'With Badges', props: { currentModel: 'claude-sonnet-4-20250514', planModeEnabled: true, ultrathinkEnabled: true } },
      { name: 'Processing', props: { currentModel: 'claude-sonnet-4-20250514', isProcessing: true } },
      { name: 'Disabled', props: { currentModel: 'claude-sonnet-4-20250514', disabled: true } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'permission-request',
    name: 'PermissionRequest',
    category: 'Chat Inputs',
    description: 'Structured input for approving tool execution permissions',
    component: PermissionRequestPlayground,
    props: [
      {
        name: 'toolName',
        description: 'Name of the tool requesting permission',
        control: { type: 'string', placeholder: 'Bash' },
        defaultValue: 'Bash',
      },
      {
        name: 'description',
        description: 'Description of what the tool wants to do',
        control: { type: 'textarea', placeholder: 'Description...', rows: 2 },
        defaultValue: 'Execute a shell command to list files in the current directory',
      },
      {
        name: 'command',
        description: 'The command or action being requested',
        control: { type: 'textarea', placeholder: 'Command preview...', rows: 2 },
        defaultValue: 'ls -la /Users/demo/projects',
      },
    ],
    variants: [
      { name: 'Bash Command', props: { toolName: 'Bash', description: 'Execute a shell command', command: 'npm install && npm run build' } },
      { name: 'Read File', props: { toolName: 'Read', description: 'Read file contents', command: '/etc/passwd' } },
      { name: 'Write File', props: { toolName: 'Write', description: 'Create or overwrite a file', command: '/tmp/output.txt' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'clarification-question',
    name: 'ClarificationQuestion',
    category: 'Chat Inputs',
    description: 'Structured input for answering clarification questions with options',
    component: ClarificationQuestionPlayground,
    props: [
      {
        name: 'header',
        description: 'Optional header label above the question',
        control: { type: 'string', placeholder: 'Header' },
        defaultValue: 'Budget',
      },
      {
        name: 'question',
        description: 'The question to ask',
        control: { type: 'textarea', placeholder: 'Question...', rows: 2 },
        defaultValue: "What's your budget for this trip?",
      },
      {
        name: 'multiSelect',
        description: 'Allow multiple selections',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Single Select', props: { header: 'Budget', question: "What's your budget?", multiSelect: false } },
      { name: 'Multi Select', props: { header: 'Features', question: 'Which features do you need?', multiSelect: true } },
    ],
    mockData: () => ({
      options: [
        { label: 'Option A', description: 'First option' },
        { label: 'Option B', description: 'Second option' },
        { label: 'Option C', description: 'Third option' },
      ],
    }),
  },
  {
    id: 'plan-review',
    name: 'PlanReview',
    category: 'Chat Inputs',
    description: 'Structured input for reviewing and approving execution plans',
    component: PlanReviewPlayground,
    props: [
      {
        name: 'title',
        description: 'Plan title',
        control: { type: 'string', placeholder: 'Plan title...' },
        defaultValue: 'Trip Planning Workflow',
      },
      {
        name: 'summary',
        description: 'Brief summary of the plan',
        control: { type: 'textarea', placeholder: 'Summary...', rows: 2 },
        defaultValue: 'Search for flights and hotels, compare options, and create a detailed itinerary.',
      },
    ],
    variants: [
      { name: 'Simple Plan', props: { title: 'Simple Task', summary: 'A straightforward task with few steps.' } },
      { name: 'Complex Plan', props: { title: 'Complex Workflow', summary: 'A multi-step workflow involving multiple tools and APIs.' } },
    ],
    mockData: () => ({
      steps: [
        { description: 'First step', tools: ['WebSearch'] },
        { description: 'Second step', tools: ['Read', 'Write'] },
        { description: 'Third step' },
      ],
      questions: [],
    }),
  },
]
