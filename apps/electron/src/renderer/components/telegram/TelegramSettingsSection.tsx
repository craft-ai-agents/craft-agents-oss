/**
 * Telegram Settings Section
 *
 * Workspace-level Telegram integration settings.
 * Allows connecting/disconnecting Telegram bot and viewing bot status.
 */

import { useEffect, useState } from 'react'
import { Bot, LogOut } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TelegramConnectionStatus {
  isConnected: boolean
  isConnecting: boolean
  botUsername?: string
  botId?: number
}

export function TelegramSettingsSection() {
  const { activeWorkspaceId: workspaceId } = useAppShellContext()
  const [connection, setConnection] = useState<TelegramConnectionStatus>({
    isConnected: false,
    isConnecting: false
  })
  const [botToken, setBotToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Load connection status when component mounts
  useEffect(() => {
    const loadStatus = async () => {
      if (!workspaceId) return
      try {
        const result = await window.electronAPI.telegramGetStatus(workspaceId)
        if (result.success && result.status) {
          setConnection(result.status)
        }

        // Try to load saved token for auto-display
        const tokenResult = await window.electronAPI.telegramGetSavedToken(workspaceId)
        if (tokenResult.success && tokenResult.token) {
          // Don't show the full token, just indicate it's saved
          setBotToken('••••••••••')
        }
      } catch (error) {
        console.error('Failed to load Telegram status:', error)
      }
    }

    loadStatus()
  }, [workspaceId])

  // Set up Telegram event listeners
  useEffect(() => {
    if (!workspaceId) return

    // Connection status updates
    const cleanupStatus = window.electronAPI.onTelegramConnectionStatus?.((data) => {
      if (data.workspaceId === workspaceId && data.status) {
        setConnection(data.status)
      }
    })

    // Error events
    const cleanupError = window.electronAPI.onTelegramError?.((data) => {
      if (data.workspaceId === workspaceId) {
        setError(data.message)
        setConnection((prev) => ({ ...prev, isConnecting: false }))
      }
    })

    return () => {
      cleanupStatus?.()
      cleanupError?.()
    }
  }, [workspaceId])

  const handleConnect = async () => {
    if (!workspaceId || !botToken.trim() || botToken === '••••••••••') {
      setError('Please enter a valid bot token from @BotFather')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.telegramConnect(workspaceId, botToken)

      if (result.success) {
        setConnection({ isConnected: false, isConnecting: true })
      } else {
        setError(result.error || 'Failed to connect')
      }
    } catch (error) {
      console.error('Failed to connect Telegram:', error)
      setError('Failed to connect')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!workspaceId) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.telegramDisconnect(workspaceId)

      if (result.success) {
        setConnection({
          isConnected: false,
          isConnecting: false
        })
        setBotToken('')
      } else {
        setError(result.error || 'Failed to disconnect')
      }
    } catch (error) {
      console.error('Failed to disconnect Telegram:', error)
      setError('Failed to disconnect')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <SettingsSection
      title="Telegram Integration"
      description="Connect a Telegram bot to interact with Vesper through Telegram messages"
    >
      {connection.isConnected ? (
        <SettingsCard>
          <SettingsRow
            icon={<Bot className="h-4 w-4" />}
            title="Connected Bot"
            description={connection.botUsername ? `@${connection.botUsername}` : 'Connected'}
          >
            <Button
              onClick={handleDisconnect}
              variant="destructive"
              size="sm"
              disabled={isLoading}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          </SettingsRow>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bot-token">Bot Token</Label>
              <Input
                id="bot-token"
                type="password"
                placeholder="Enter bot token from @BotFather"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConnect()
                  }
                }}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Create a bot using @BotFather on Telegram and paste the token here
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              onClick={handleConnect}
              disabled={isLoading || !botToken.trim() || botToken === '••••••••••'}
              className="w-full"
            >
              {isLoading ? 'Connecting...' : 'Connect'}
            </Button>

            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium mb-2">How it works:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Create a bot via @BotFather on Telegram</li>
                <li>Copy the bot token and paste it above</li>
                <li>Send messages to your bot with commands like /safe, /ask, or /allow_all</li>
                <li>Vesper will process your messages and respond through the bot</li>
              </ul>
            </div>
          </div>
        </SettingsCard>
      )}
    </SettingsSection>
  )
}
