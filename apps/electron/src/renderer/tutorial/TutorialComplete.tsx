/**
 * Tutorial Complete
 *
 * Celebration popup shown when a tutorial is completed.
 * Displays a congratulations message with confetti-like animations.
 */

import { motion, AnimatePresence } from 'motion/react'
import { PartyPopper, Sparkles } from 'lucide-react'
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
 * Get completion title based on tutorial ID
 */
function getCompletionTitle(tutorialId: string): string {
  switch (tutorialId) {
    case 'source-creation':
      return 'Congratulations! 🎉'
    default:
      return 'Well done!'
  }
}

/**
 * Get completion description based on tutorial ID
 */
function getCompletionDescription(tutorialId: string): string {
  switch (tutorialId) {
    case 'source-creation':
      return "You've completed the Craft Agent source creation tutorial with flying colors! Your Gmail source is now connected and ready to help you manage your emails."
    default:
      return "You've successfully completed the tutorial. You're all set to go!"
  }
}

export function TutorialComplete() {
  const { state, dismissCompletion } = useTutorial()

  // Only show when completed
  if (state.status !== 'completed' || !state.activeTutorialId) {
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

        {/* Floating sparkles animation */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute"
              initial={{
                x: `${20 + Math.random() * 60}%`,
                y: '100%',
                scale: 0.5 + Math.random() * 0.5,
                opacity: 0,
              }}
              animate={{
                y: '-20%',
                opacity: [0, 1, 1, 0],
                rotate: Math.random() * 360,
              }}
              transition={{
                duration: 2 + Math.random() * 2,
                delay: Math.random() * 0.5,
                ease: 'easeOut',
              }}
            >
              <Sparkles className="w-4 h-4 text-accent/60" />
            </motion.div>
          ))}
        </div>

        {/* Dialog */}
        <motion.div
          className="relative bg-background border border-border/50 rounded-xl shadow-2xl p-6 max-w-sm mx-4"
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={springTransition}
        >
          {/* Icon with celebration animation */}
          <motion.div
            className="w-16 h-16 bg-gradient-to-br from-accent/20 to-success/20 rounded-full flex items-center justify-center mb-4 mx-auto"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...springTransition, delay: 0.1 }}
          >
            <motion.div
              animate={{
                y: [0, -4, 0],
              }}
              transition={{
                duration: 0.6,
                repeat: 2,
                ease: 'easeInOut',
              }}
            >
              <PartyPopper className="w-8 h-8 text-accent" />
            </motion.div>
          </motion.div>

          {/* Content */}
          <motion.h2
            className="text-xl font-semibold mb-2 text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {getCompletionTitle(tutorialId)}
          </motion.h2>
          <motion.p
            className="text-sm text-foreground/60 mb-6 leading-relaxed text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            {getCompletionDescription(tutorialId)}
          </motion.p>

          {/* Action */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Button
              onClick={dismissCompletion}
              className="w-full"
              size="lg"
            >
              Let's go!
            </Button>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
