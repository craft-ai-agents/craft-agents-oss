/**
 * Tutorial Prompt
 *
 * Dialog asking if user wants help with a tutorial.
 * Shows when tutorial trigger conditions are met but before starting.
 */

import { motion, AnimatePresence } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTutorial } from './TutorialContext'

/**
 * Spring animation preset for snappy UI
 */
const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

/**
 * Get prompt title based on tutorial ID
 */
function getPromptTitle(tutorialId: string): string {
  switch (tutorialId) {
    case 'source-creation':
      return "Let's get you connected!"
    default:
      return 'Need a hand?'
  }
}

/**
 * Get prompt description based on tutorial ID
 */
function getPromptDescription(tutorialId: string): string {
  switch (tutorialId) {
    case 'source-creation':
      return "Looks like you're just getting started. Want me to walk you through connecting your first service? It only takes a minute!"
    default:
      return "I'd be happy to show you around. It'll only take a moment!"
  }
}

export function TutorialPrompt() {
  const { state, startTutorial, skipTutorial } = useTutorial()

  // Only show when prompting
  if (state.status !== 'prompting' || !state.activeTutorialId) {
    return null
  }

  const tutorialId = state.activeTutorialId

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9997] flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        {/* Dialog */}
        <motion.div
          className="relative bg-background border border-border/50 rounded-xl shadow-2xl p-6 max-w-sm mx-4"
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={springTransition}
        >
          {/* Icon */}
          <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mb-4">
            <Sparkles className="w-6 h-6 text-accent" />
          </div>

          {/* Content */}
          <h2 className="text-lg font-semibold mb-2">
            {getPromptTitle(tutorialId)}
          </h2>
          <p className="text-sm text-foreground/60 mb-6 leading-relaxed">
            {getPromptDescription(tutorialId)}
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={skipTutorial}
              className="flex-1"
            >
              I'll explore on my own
            </Button>
            <Button
              onClick={() => startTutorial(tutorialId)}
              className="flex-1"
            >
              Show me!
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
