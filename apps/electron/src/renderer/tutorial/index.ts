/**
 * Tutorial System
 *
 * A modular, game-like tutorial system for onboarding users.
 *
 * Usage:
 * 1. Wrap app with TutorialProvider
 * 2. Add TutorialOverlay and TutorialPrompt components
 * 3. Register tutorials at startup
 * 4. Add data-tutorial attributes to target elements
 *
 * @example
 * ```tsx
 * import { TutorialProvider, TutorialOverlay, TutorialPrompt, registerTutorial } from '@/tutorial'
 * import { sourceCreationTutorial } from '@/tutorial/tutorials/source-creation'
 *
 * registerTutorial(sourceCreationTutorial)
 *
 * function App() {
 *   return (
 *     <TutorialProvider>
 *       <YourApp />
 *       <TutorialOverlay />
 *       <TutorialPrompt />
 *     </TutorialProvider>
 *   )
 * }
 * ```
 */

// Types
export type {
  TutorialStep,
  TutorialDefinition,
  TutorialTrigger,
  TutorialState,
  TutorialProgress,
  TutorialContextValue,
  TutorialStatus,
  TooltipPosition,
  CompletionEvent,
} from './types'

// Registry
export {
  registerTutorial,
  getTutorial,
  getAllTutorials,
  hasTutorial,
  unregisterTutorial,
  clearTutorials,
} from './registry'

// Context
export { TutorialProvider, useTutorial, useIsTutorialActive } from './TutorialContext'

// Components
export { TutorialOverlay } from './TutorialOverlay'
export { TutorialPrompt } from './TutorialPrompt'
export { TutorialComplete } from './TutorialComplete'

// Tutorials
export { sourceCreationTutorial } from './tutorials/source-creation'
