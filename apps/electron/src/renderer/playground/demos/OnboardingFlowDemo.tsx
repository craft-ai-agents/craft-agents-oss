/**
 * OnboardingFlowDemo — Interactive walkthrough of the new onboarding flow.
 *
 * Manages its own state so you can click through the entire sequence
 * in the playground without needing real IPC.
 *
 * Flow: WelcomeStep -> CredentialsStep -> CompletionStep
 */
import { useState, useCallback, useEffect } from 'react'
import { ensureMockElectronAPI } from '../mock-utils'
import { WelcomeStep } from '@/components/onboarding/WelcomeStep'
import { CredentialsStep } from '@/components/onboarding/CredentialsStep'
import { CompletionStep } from '@/components/onboarding/CompletionStep'
import type { ApiSetupMethod } from '@/components/onboarding/setup-types'
import type { CredentialStatus } from '@/components/onboarding/CredentialsStep'

type DemoStep = 'welcome' | 'credentials' | 'complete'

export function OnboardingFlowDemo() {
  useEffect(() => { ensureMockElectronAPI() }, [])

  const [step, setStep] = useState<DemoStep>('welcome')
  const [method, setMethod] = useState<ApiSetupMethod>('pi_api_key')
  const [credStatus, setCredStatus] = useState<CredentialStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

  const handleBack = useCallback(() => {
    switch (step) {
      case 'credentials':
        setStep('welcome')
        setCredStatus('idle')
        setErrorMessage(undefined)
        break
    }
  }, [step])

  const simulateApiKeySubmit = useCallback(() => {
    setCredStatus('validating')
    setTimeout(() => {
      setCredStatus('success')
      setTimeout(() => setStep('complete'), 600)
    }, 1200)
  }, [])

  const handleRestart = useCallback(() => {
    setStep('welcome')
    setMethod('pi_api_key')
    setCredStatus('idle')
    setErrorMessage(undefined)
  }, [])

  // Step labels for the breadcrumb
  const STEP_ORDER: { key: DemoStep; label: string }[] = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'credentials', label: 'Credentials' },
    { key: 'complete', label: 'Done' },
  ]

  const currentIndex = STEP_ORDER.findIndex(s => s.key === step)

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-foreground/[0.03] border-b border-border">
        <div className="flex items-center gap-1 text-xs">
          {STEP_ORDER.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/40 mx-1">→</span>}
              <span
                className={
                  i === currentIndex
                    ? 'font-semibold text-foreground'
                    : i < currentIndex
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/40'
                }
              >
                {s.label}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={handleRestart}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-foreground/5"
        >
          Restart
        </button>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center p-8 bg-foreground-2 overflow-auto">
        {step === 'welcome' && (
          <WelcomeStep
            isExistingUser={false}
            onContinue={() => setStep('credentials')}
          />
        )}

        {step === 'credentials' && (
          <CredentialsStep
            apiSetupMethod={method}
            status={credStatus}
            errorMessage={errorMessage}
            onSubmit={simulateApiKeySubmit}
            onBack={handleBack}
          />
        )}

        {step === 'complete' && (
          <CompletionStep
            status="complete"
            onFinish={handleRestart}
          />
        )}
      </div>
    </div>
  )
}
