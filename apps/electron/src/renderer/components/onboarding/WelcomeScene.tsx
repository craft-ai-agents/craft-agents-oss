import { motion } from 'motion/react'
import { Sparkles } from 'lucide-react'

// ─── Component ──────────────────────────────────────────────────────────

interface WelcomeSceneProps {
  /** Called when user clicks Get Started */
  onContinue: () => void
  /** Whether the app is loading (e.g., checking Git Bash) */
  isLoading?: boolean
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
}

export function WelcomeScene({
  onContinue,
  isLoading = false,
  isExistingUser = false,
}: WelcomeSceneProps) {
  return (
    <div className="flex flex-col items-center">
      {/* Spacer for the emblem above the glass */}
      <div style={{ height: 4 }} />

      {/* Title */}
      <h1 className="onboarding-mural__title onboarding-mural__title--gradient">
        {isExistingUser ? 'Update Your Studio' : 'Welcome to ARCHstudio'}
      </h1>

      {/* Decorative rule */}
      <div className="onboarding-mural__decorative-rule">
        <span className="onboarding-mural__decorative-rule-text">
          {isExistingUser ? 'Connection Settings' : 'Your Creative AI Studio'}
        </span>
      </div>

      <p className="onboarding-mural__subtitle">
        {isExistingUser
          ? 'Update your API connection to continue using the studio.'
          : 'Connect a provider to start creating with AI agents in a workspace designed for flow.'}
      </p>

      {/* Action */}
      <div className="onboarding-mural__actions onboarding-mural__actions--centered">
        <motion.button
          onClick={onContinue}
          className="onboarding-mural__btn onboarding-mural__btn--primary onboarding-mural__btn--full"
          disabled={isLoading}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
        >
          {isLoading ? (
            <>
              <div
                className="rounded-full animate-spin"
                style={{
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                }}
              />
              Loading…
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              {isExistingUser ? 'Continue' : 'Get Started'}
            </>
          )}
        </motion.button>
      </div>
    </div>
  )
}
