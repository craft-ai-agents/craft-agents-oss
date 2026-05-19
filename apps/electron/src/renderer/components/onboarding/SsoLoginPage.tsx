import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { ContinueButton, StepFormLayout } from './primitives'

interface SsoLoginPageProps {
  onSuccess: () => void
  result?: { success: boolean; error?: string } | null
}

export function SsoLoginPage({ onSuccess, result }: SsoLoginPageProps) {
  const [isWaiting, setIsWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!result) return

    setIsWaiting(false)
    if (result.success) {
      setError(null)
      onSuccess()
    } else {
      setError(result.error ?? 'SSO login failed')
    }
  }, [onSuccess, result])

  const handleLogin = async () => {
    setError(null)
    setIsWaiting(true)

    try {
      const authUrl = await window.electronAPI.startSsoLogin()
      await window.electronAPI.openUrl(authUrl)
    } catch (err) {
      setIsWaiting(false)
      setError(err instanceof Error ? err.message : 'SSO login failed')
    }
  }

  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-6">
      <StepFormLayout
        iconElement={
          <div className="flex size-16 items-center justify-center">
            <CraftAgentsSymbol className="size-10 text-accent" />
          </div>
        }
        title="Sign in to continue"
        description="Use your MDP account to continue."
        actions={
          <ContinueButton
            onClick={handleLogin}
            className="w-full"
            loading={isWaiting}
            loadingText="Waiting for sign-in..."
          >
            Login
          </ContinueButton>
        }
      >
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </StepFormLayout>
    </div>
  )
}
