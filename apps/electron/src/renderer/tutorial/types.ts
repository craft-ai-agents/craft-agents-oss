/**
 * Tutorial system types
 *
 * A modular tutorial system for game-like onboarding experiences.
 * Supports spotlight overlays, positioned tooltips, and step-by-step guidance.
 */

/**
 * Position for tooltip relative to target element
 */
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'

/**
 * Event that completes a tutorial step
 * - click: User clicks the target element
 * - appear: Step auto-advances when target element appears in DOM
 * - focus: User focuses the target element
 * - hover: User hovers over target element
 * - input_match: Step auto-advances when input matches expected text
 * - custom: Manual advancement via API
 */
export type CompletionEvent = 'click' | 'appear' | 'focus' | 'hover' | 'input_match' | 'custom'

/**
 * Tutorial step definition - the core building block
 */
export interface TutorialStep {
  /** Unique identifier for this step */
  id: string
  /** CSS selector to target element (use data-tutorial attributes) */
  target: string
  /** Tooltip title */
  title: string
  /** Tooltip description */
  description: string
  /** Where to position tooltip relative to target */
  position: TooltipPosition
  /** Event that completes this step */
  completionEvent: CompletionEvent
  /** Show arrow pointing from tooltip to target */
  showArrow?: boolean
  /** Padding around spotlight (default: 8px) */
  spotlightPadding?: number
  /** Border radius for spotlight (default: 8px) */
  spotlightRadius?: number
  /** Delay before showing this step in ms */
  delay?: number
  /** Disable send action in chat input during this step */
  disableSend?: boolean
  /** Expected input text for 'input_match' completion (case-insensitive contains match) */
  expectedInput?: string
  /** Delay in ms after input matches before auto-advancing (default: 2000) */
  inputMatchDelay?: number
  /** Delay in ms after element appears before auto-advancing for 'appear' events (default: 1500) */
  appearDelay?: number
  /** Show a button in the tooltip to manually advance (e.g., "Got it"). If set, disables spotlight click advancement */
  nextButton?: string
  /** Wait indefinitely for target element (no timeout). Use for steps that depend on external events like agent responses. */
  waitForElement?: boolean
  /** Optional callback when step completes */
  onComplete?: () => void | Promise<void>
}

/**
 * Trigger conditions for showing tutorial prompt
 */
export type TutorialTrigger =
  | { type: 'condition'; check: () => boolean }
  | { type: 'manual' } // Only via explicit API call
  | { type: 'firstVisit'; key: string } // First time visiting a view

/**
 * Tutorial definition - a sequence of steps
 */
export interface TutorialDefinition {
  /** Unique identifier for this tutorial */
  id: string
  /** Display name for the tutorial */
  name: string
  /** Condition to trigger tutorial prompt */
  trigger: TutorialTrigger
  /** Steps in order */
  steps: TutorialStep[]
  /** Called when tutorial completes successfully */
  onComplete?: () => void
  /** Called if user skips tutorial */
  onSkip?: () => void
}

/**
 * Tutorial execution status
 */
export type TutorialStatus = 'idle' | 'prompting' | 'running' | 'completed' | 'skipped'

/**
 * Auto-advance timer state (for circular progress indicator)
 */
export interface TimerState {
  /** Duration of the timer in ms */
  duration: number
  /** Timestamp when timer started */
  startedAt: number
}

/**
 * Runtime state for active tutorial
 */
export interface TutorialState {
  /** Currently active tutorial ID */
  activeTutorialId: string | null
  /** Current step index within the tutorial */
  currentStepIndex: number
  /** Current execution status */
  status: TutorialStatus
  /** Bounding rect of target element (for positioning) */
  targetRect: DOMRect | null
  /** Auto-advance timer state (for progress indicator) */
  autoAdvanceTimer: TimerState | null
}

/**
 * Persisted tutorial progress
 */
export interface TutorialProgress {
  /** IDs of tutorials user has completed */
  completedTutorials: string[]
  /** IDs of tutorials user has skipped */
  skippedTutorials: string[]
}

/**
 * Tutorial context value exposed to consumers
 */
export interface TutorialContextValue {
  /** Current tutorial state */
  state: TutorialState
  /** Current step definition (if running) */
  currentStep: TutorialStep | null
  /** Current tutorial definition (if active) */
  currentTutorial: TutorialDefinition | null
  /** Start a specific tutorial by ID */
  startTutorial: (tutorialId: string) => void
  /** Move to next step */
  nextStep: () => void
  /** Complete current step (triggers nextStep) */
  completeStep: () => void
  /** Skip/dismiss current tutorial */
  skipTutorial: () => void
  /** Show prompt for a tutorial */
  promptTutorial: (tutorialId: string) => void
  /** Dismiss prompt without starting tutorial */
  dismissPrompt: () => void
  /** Check if a tutorial was completed */
  isTutorialCompleted: (tutorialId: string) => boolean
  /** Check if a tutorial was skipped */
  isTutorialSkipped: (tutorialId: string) => boolean
  /** Reset progress for a tutorial (for testing) */
  resetTutorial: (tutorialId: string) => void
  /** Dismiss completion celebration and return to idle */
  dismissCompletion: () => void
}
