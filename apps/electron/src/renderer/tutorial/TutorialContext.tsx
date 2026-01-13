/**
 * Tutorial Context
 *
 * React context providing tutorial state management and control.
 * Handles:
 * - Tutorial state machine (idle → prompting → running → completed/skipped)
 * - Target element positioning and tracking
 * - localStorage persistence for completed/skipped tutorials
 * - Auto-triggering based on conditions
 * - Re-triggering when workspace changes
 */

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import * as storage from '@/lib/local-storage'
import type {
  TutorialState,
  TutorialProgress,
  TutorialContextValue,
  TutorialStep,
  TutorialDefinition,
  TimerState,
} from './types'
import { getTutorial } from './registry'

const STORAGE_KEY = storage.KEYS.tutorialProgress

/**
 * Default tutorial progress
 */
const defaultProgress: TutorialProgress = {
  completedTutorials: [],
  skippedTutorials: [],
}

/**
 * Default tutorial state
 */
const defaultState: TutorialState = {
  activeTutorialId: null,
  currentStepIndex: 0,
  status: 'idle',
  targetRect: null,
  autoAdvanceTimer: null,
}

const TutorialContext = createContext<TutorialContextValue | null>(null)

interface TutorialProviderProps {
  children: ReactNode
  /** Current workspace ID - triggers re-evaluation when changed */
  workspaceId?: string | null
  /** Number of sources in the workspace (for auto-trigger conditions) */
  sourcesCount?: number
  /** Disable auto-triggering (for testing) */
  disableAutoTrigger?: boolean
}

export function TutorialProvider({
  children,
  workspaceId,
  sourcesCount = 0,
  disableAutoTrigger = false,
}: TutorialProviderProps) {

  // Tutorial state
  const [state, setState] = useState<TutorialState>(defaultState)

  // Whether tutorials are enabled for this workspace (loaded from settings)
  const [tutorialsEnabled, setTutorialsEnabled] = useState(true)

  // Track previous workspace ID to detect changes
  const prevWorkspaceIdRef = useRef<string | null | undefined>(workspaceId)

  // Load progress from localStorage
  const [progress, setProgress] = useState<TutorialProgress>(() => {
    return storage.get(STORAGE_KEY, defaultProgress)
  })

  // Persist progress changes
  useEffect(() => {
    storage.set(STORAGE_KEY, progress)
  }, [progress])

  // Load tutorials enabled setting when workspace changes
  useEffect(() => {
    if (!workspaceId) {
      setTutorialsEnabled(true) // Default to enabled
      return
    }
    window.electronAPI.getWorkspaceSettings(workspaceId).then((settings) => {
      setTutorialsEnabled(settings?.tutorialsEnabled ?? true)
    })
  }, [workspaceId])

  // Track target element position with ResizeObserver
  const observerRef = useRef<ResizeObserver | null>(null)

  // Get current tutorial and step from state
  const currentTutorial = state.activeTutorialId
    ? getTutorial(state.activeTutorialId) ?? null
    : null
  const currentStep = currentTutorial?.steps[state.currentStepIndex] ?? null

  /**
   * Reset tutorial state when workspace changes
   * This allows the auto-trigger to re-evaluate for the new workspace
   */
  useEffect(() => {
    if (prevWorkspaceIdRef.current !== workspaceId && workspaceId !== undefined) {
      // Workspace changed - reset to idle so auto-trigger can re-evaluate
      // Only reset if we're not in the middle of running a tutorial
      if (state.status === 'prompting' || state.status === 'idle') {
        setState(defaultState)
      }
      prevWorkspaceIdRef.current = workspaceId
    }
  }, [workspaceId, state.status])

  /**
   * Start a tutorial by ID
   */
  const startTutorial = useCallback((tutorialId: string) => {
    const tutorial = getTutorial(tutorialId)
    if (!tutorial) {
      console.warn(`[Tutorial] Tutorial "${tutorialId}" not found`)
      return
    }

    setState({
      activeTutorialId: tutorialId,
      currentStepIndex: 0,
      status: 'running',
      targetRect: null,
      autoAdvanceTimer: null,
    })
  }, [])

  /**
   * Move to next step
   */
  const nextStep = useCallback(() => {
    if (!currentTutorial || !state.activeTutorialId) return

    const nextIndex = state.currentStepIndex + 1

    console.log('[Tutorial] nextStep:', {
      currentStep: state.currentStepIndex,
      nextIndex,
      totalSteps: currentTutorial.steps.length,
      willComplete: nextIndex >= currentTutorial.steps.length,
      stepIds: currentTutorial.steps.map((s) => s.id),
    })

    if (nextIndex >= currentTutorial.steps.length) {
      // Tutorial complete - show celebration
      setProgress((p) => ({
        ...p,
        completedTutorials: [...p.completedTutorials, state.activeTutorialId!],
      }))
      currentTutorial.onComplete?.()
      // Transition to completed status to show celebration popup
      setState((s) => ({ ...s, status: 'completed', targetRect: null, autoAdvanceTimer: null }))
    } else {
      // Clear timer state when moving to next step
      setState((s) => ({ ...s, currentStepIndex: nextIndex, targetRect: null, autoAdvanceTimer: null }))
    }
  }, [currentTutorial, state.currentStepIndex, state.activeTutorialId])

  /**
   * Complete current step
   */
  const completeStep = useCallback(() => {
    currentStep?.onComplete?.()
    nextStep()
  }, [currentStep, nextStep])

  // Track if we've already triggered auto-advance for 'appear' and 'input_match' steps
  const appearTriggeredRef = useRef(false)
  const inputMatchTriggeredRef = useRef(false)
  const inputMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Watch for input changes to validate 'input_match' completion events
   */
  useEffect(() => {
    // Only watch for input_match steps
    if (state.status !== 'running' || !currentStep) return
    if (currentStep.completionEvent !== 'input_match') return
    if (!currentStep.expectedInput) return

    // Capture step ID to prevent race conditions - only complete if still on same step
    const targetStepId = currentStep.id

    // Reset the triggered ref when step changes
    inputMatchTriggeredRef.current = false
    if (inputMatchTimerRef.current) {
      clearTimeout(inputMatchTimerRef.current)
      inputMatchTimerRef.current = null
    }

    // Track the actual element we attached the listener to (for proper cleanup)
    let activeTarget: HTMLTextAreaElement | HTMLInputElement | null = null

    const handleInput = () => {
      if (inputMatchTriggeredRef.current) return

      const target = document.querySelector(currentStep.target) as HTMLTextAreaElement | HTMLInputElement | null
      if (!target) return

      const inputValue = target.value.toLowerCase().trim()
      const expectedValue = currentStep.expectedInput!.toLowerCase().trim()

      // Check if input contains the expected text
      if (inputValue.includes(expectedValue)) {
        inputMatchTriggeredRef.current = true
        const delay = currentStep.inputMatchDelay ?? 2000

        console.log('[Tutorial] Input matches expected text, advancing in', delay, 'ms')
        // Set timer state for circular progress indicator
        setState((s) => ({
          ...s,
          autoAdvanceTimer: { duration: delay, startedAt: Date.now() },
        }))
        inputMatchTimerRef.current = setTimeout(() => {
          // Guard: only advance if still on the same step (prevents race with click handlers)
          if (currentStep?.id === targetStepId) {
            console.log('[Tutorial] Input match delay complete, advancing step')
            setState((s) => ({ ...s, autoAdvanceTimer: null }))
            completeStep()
          } else {
            console.log('[Tutorial] Input match timer fired but step already changed, ignoring')
          }
        }, delay)
      }
    }

    // Find the target element and add input listener
    const target = document.querySelector(currentStep.target) as HTMLTextAreaElement | HTMLInputElement | null
    if (target) {
      activeTarget = target
      target.addEventListener('input', handleInput)
      // Also check immediately in case input already has content
      handleInput()
    }

    // Use MutationObserver if target doesn't exist yet
    let mutationObserver: MutationObserver | null = null
    if (!target) {
      mutationObserver = new MutationObserver(() => {
        const newTarget = document.querySelector(currentStep.target) as HTMLTextAreaElement | HTMLInputElement | null
        if (newTarget) {
          activeTarget = newTarget
          newTarget.addEventListener('input', handleInput)
          handleInput()
          mutationObserver?.disconnect()
        }
      })
      mutationObserver.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      if (inputMatchTimerRef.current) {
        clearTimeout(inputMatchTimerRef.current)
        inputMatchTimerRef.current = null
      }
      // Use tracked element for cleanup (handles dynamically-added elements)
      activeTarget?.removeEventListener('input', handleInput)
      mutationObserver?.disconnect()
    }
  }, [currentStep, state.status, completeStep])

  /**
   * Update target rect when step changes or during running state
   */
  useEffect(() => {
    // Only track position when running
    if (state.status !== 'running' || !currentStep) {
      setState((s) => ({ ...s, targetRect: null }))
      appearTriggeredRef.current = false
      return
    }

    // Reset appear trigger when step changes
    appearTriggeredRef.current = false
    console.log('[Tutorial] Step started:', currentStep.id, 'looking for:', currentStep.target)

    // Track if we've already scrolled to target for this step
    let hasScrolledToTarget = false

    const updateTargetRect = () => {
      const target = document.querySelector(currentStep.target) as HTMLElement | null
      if (target) {
        // Scroll target into view if this is the first time we found it
        // Use smooth scrolling and center the element in view
        if (!hasScrolledToTarget) {
          hasScrolledToTarget = true
          target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
          console.log('[Tutorial] Scrolled target into view:', currentStep.target)
          // Wait for scroll to complete before getting rect (400ms + 200ms re-check)
          setTimeout(() => {
            const rect = target.getBoundingClientRect()
            setState((s) => ({ ...s, targetRect: rect }))
            // Schedule another update in case scroll was still in progress
            setTimeout(() => {
              const finalRect = target.getBoundingClientRect()
              if (finalRect.top !== rect.top || finalRect.left !== rect.left) {
                console.log('[Tutorial] Scroll position updated after re-check')
                setState((s) => ({ ...s, targetRect: finalRect }))
              }
            }, 200)
          }, 400)
        } else {
          const rect = target.getBoundingClientRect()
          setState((s) => ({ ...s, targetRect: rect }))
        }

        // Auto-advance for 'appear' completion events (unless nextButton is set)
        if (currentStep.completionEvent === 'appear' && !appearTriggeredRef.current) {
          appearTriggeredRef.current = true
          // If nextButton is set, don't auto-advance - wait for button click
          if (currentStep.nextButton) {
            console.log('[Tutorial] Element appeared:', currentStep.target, '- waiting for button click')
          } else {
            const appearDelay = currentStep.appearDelay ?? 1500
            const targetSelector = currentStep.target
            console.log('[Tutorial] Element appeared:', targetSelector, '- advancing in', appearDelay, 'ms')
            // Set timer state for circular progress indicator
            setState((s) => ({
              ...s,
              autoAdvanceTimer: { duration: appearDelay, startedAt: Date.now() },
            }))
            setTimeout(() => {
              // Clear timer state and verify element still exists before advancing
              setState((s) => ({ ...s, autoAdvanceTimer: null }))
              const stillExists = document.querySelector(targetSelector)
              if (stillExists) {
                console.log('[Tutorial] Element still present, advancing step')
                completeStep()
              } else {
                console.warn('[Tutorial] Element disappeared, advancing anyway:', targetSelector)
                completeStep() // Still advance to not block tutorial
              }
            }, appearDelay)
          }
        }
      } else {
        // Target not found - could be not rendered yet
        setState((s) => ({ ...s, targetRect: null }))
      }
    }

    // Apply step delay if specified
    const delay = currentStep.delay ?? 0
    const delayTimer = setTimeout(() => {
      updateTargetRect()

      // Observe for size/position changes
      const target = document.querySelector(currentStep.target)
      if (target) {
        const observer = new ResizeObserver(updateTargetRect)
        observer.observe(target)
        observerRef.current = observer
      }

      // Use MutationObserver to detect when target appears in DOM
      // This is important for steps that wait for dynamic elements
      let pollInterval: ReturnType<typeof setInterval> | null = null

      if (!target) {
        console.log('[Tutorial] Target not found, setting up MutationObserver and polling for:', currentStep.target)

        // Wait indefinitely for:
        // - 'appear' steps (they depend on external events like permissions, OAuth, etc.)
        // - Steps with waitForElement flag (explicitly marked to wait for agent responses)
        // For other steps (click, etc.), use a timeout as fallback for broken selectors
        const shouldTimeout = currentStep.completionEvent !== 'appear' && !currentStep.waitForElement
        const ELEMENT_TIMEOUT = 10000
        let elementFound = false
        let elementTimeoutId: ReturnType<typeof setTimeout> | null = null

        if (shouldTimeout) {
          elementTimeoutId = setTimeout(() => {
            if (!elementFound) {
              console.warn('[Tutorial] Element not found after 10s, auto-advancing:', currentStep.target)
              mutationObserver.disconnect()
              if (pollInterval) clearInterval(pollInterval)
              completeStep()
            }
          }, ELEMENT_TIMEOUT)
        }

        const mutationObserver = new MutationObserver(() => {
          const newTarget = document.querySelector(currentStep.target)
          if (newTarget) {
            elementFound = true
            if (elementTimeoutId) clearTimeout(elementTimeoutId)
            console.log('[Tutorial] MutationObserver found target:', currentStep.target)
            updateTargetRect()
            mutationObserver.disconnect()
            if (pollInterval) clearInterval(pollInterval)
          }
        })
        mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
        })

        // Fallback polling every 500ms in case MutationObserver misses the element
        pollInterval = setInterval(() => {
          const newTarget = document.querySelector(currentStep.target)
          if (newTarget) {
            elementFound = true
            if (elementTimeoutId) clearTimeout(elementTimeoutId)
            console.log('[Tutorial] Polling found target:', currentStep.target)
            updateTargetRect()
            mutationObserver.disconnect()
            if (pollInterval) clearInterval(pollInterval)
          }
        }, 500)

        // Store for cleanup
        const existingObserver = observerRef.current
        observerRef.current = {
          disconnect: () => {
            existingObserver?.disconnect()
            mutationObserver.disconnect()
            if (pollInterval) clearInterval(pollInterval)
            if (elementTimeoutId) clearTimeout(elementTimeoutId)
          },
        } as ResizeObserver
      }
    }, delay)

    // Also update on scroll/resize
    window.addEventListener('scroll', updateTargetRect, true)
    window.addEventListener('resize', updateTargetRect)

    return () => {
      clearTimeout(delayTimer)
      observerRef.current?.disconnect()
      window.removeEventListener('scroll', updateTargetRect, true)
      window.removeEventListener('resize', updateTargetRect)
    }
  }, [currentStep, state.status, completeStep])

  /**
   * Auto-trigger tutorials based on conditions
   * Re-evaluates when sourcesCount changes or workspace changes
   */
  useEffect(() => {
    if (disableAutoTrigger) return
    // Don't trigger if tutorials are disabled in settings
    if (!tutorialsEnabled) return
    // Don't trigger if already in a tutorial or prompting
    if (state.status !== 'idle') return
    // Need a valid workspace
    if (!workspaceId) return

    // Check source creation tutorial trigger
    const isSourceCreationCompleted = progress.completedTutorials.includes('source-creation')
    const isSourceCreationSkipped = progress.skippedTutorials.includes('source-creation')

    if (sourcesCount === 0 && !isSourceCreationCompleted && !isSourceCreationSkipped) {
      // Delay prompt slightly to let UI settle after workspace load
      const timer = setTimeout(() => {
        setState((s) => ({
          ...s,
          activeTutorialId: 'source-creation',
          status: 'prompting',
        }))
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [sourcesCount, progress, state.status, disableAutoTrigger, workspaceId, tutorialsEnabled])

  /**
   * Skip/dismiss current tutorial
   */
  const skipTutorial = useCallback(() => {
    if (state.activeTutorialId) {
      setProgress((p) => ({
        ...p,
        skippedTutorials: [...p.skippedTutorials, state.activeTutorialId!],
      }))
      currentTutorial?.onSkip?.()
    }
    setState(defaultState)
  }, [state.activeTutorialId, currentTutorial])

  /**
   * Show prompt for a tutorial
   */
  const promptTutorial = useCallback((tutorialId: string) => {
    setState({
      activeTutorialId: tutorialId,
      currentStepIndex: 0,
      status: 'prompting',
      targetRect: null,
      autoAdvanceTimer: null,
    })
  }, [])

  /**
   * Dismiss prompt without action
   */
  const dismissPrompt = useCallback(() => {
    setState(defaultState)
  }, [])

  /**
   * Check if tutorial was completed
   */
  const isTutorialCompleted = useCallback(
    (tutorialId: string) => {
      return progress.completedTutorials.includes(tutorialId)
    },
    [progress]
  )

  /**
   * Check if tutorial was skipped
   */
  const isTutorialSkipped = useCallback(
    (tutorialId: string) => {
      return progress.skippedTutorials.includes(tutorialId)
    },
    [progress]
  )

  /**
   * Reset progress for a tutorial (for testing/development)
   */
  const resetTutorial = useCallback((tutorialId: string) => {
    setProgress((p) => ({
      completedTutorials: p.completedTutorials.filter((id) => id !== tutorialId),
      skippedTutorials: p.skippedTutorials.filter((id) => id !== tutorialId),
    }))
  }, [])

  /**
   * Dismiss completion celebration and return to idle
   */
  const dismissCompletion = useCallback(() => {
    setState(defaultState)
  }, [])

  const value: TutorialContextValue = {
    state,
    currentStep,
    currentTutorial,
    startTutorial,
    nextStep,
    completeStep,
    skipTutorial,
    promptTutorial,
    dismissPrompt,
    isTutorialCompleted,
    isTutorialSkipped,
    resetTutorial,
    dismissCompletion,
  }

  return (
    <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>
  )
}

/**
 * Default context value for when hook is used outside provider
 * (e.g., in playground or other isolated contexts)
 */
const defaultContextValue: TutorialContextValue = {
  state: { activeTutorialId: null, currentStepIndex: 0, status: 'idle', targetRect: null, autoAdvanceTimer: null },
  currentStep: null,
  currentTutorial: null,
  startTutorial: () => {},
  nextStep: () => {},
  completeStep: () => {},
  skipTutorial: () => {},
  promptTutorial: () => {},
  dismissPrompt: () => {},
  isTutorialCompleted: () => false,
  isTutorialSkipped: () => false,
  resetTutorial: () => {},
  dismissCompletion: () => {},
}

/**
 * Hook to access tutorial context
 * Returns safe defaults if used outside TutorialProvider
 */
export function useTutorial(): TutorialContextValue {
  const context = useContext(TutorialContext)
  // Return safe default if no provider (e.g., playground, isolated components)
  return context ?? defaultContextValue
}

/**
 * Hook to check if in tutorial mode (for conditional rendering)
 */
export function useIsTutorialActive(): boolean {
  const { state } = useTutorial()
  return state.status === 'running' || state.status === 'prompting'
}
