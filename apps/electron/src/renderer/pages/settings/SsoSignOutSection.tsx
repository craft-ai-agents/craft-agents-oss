import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@/components/settings'

interface SsoSignOutSectionProps {
  onSignOut: () => Promise<void>
}

export function SsoSignOutSection({ onSignOut }: SsoSignOutSectionProps) {
  const { t } = useTranslation()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true)
    try {
      await onSignOut()
    } catch (error) {
      console.error('Failed to sign out:', error)
      setIsSigningOut(false)
    }
  }, [onSignOut])

  return (
    <SettingsSection title={t("settings.account.title")}>
      <SettingsCard>
        <SettingsRow
          label={t("settings.account.ssoSession")}
          description={t("settings.account.ssoSessionDesc")}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? (
              <>
                <Spinner className="mr-1.5" />
                {t("common.signingOut")}
              </>
            ) : (
              <>
                <LogOut className="h-4 w-4" />
                {t("settings.account.signOut")}
              </>
            )}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
