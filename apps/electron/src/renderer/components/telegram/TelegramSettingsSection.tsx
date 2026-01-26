/**
 * Telegram Settings Section
 *
 * Workspace-level Telegram integration settings.
 * Allows connecting/disconnecting Telegram bot and viewing bot status.
 */

import { useEffect, useState } from 'react'
import { Bot, LogOut, Shield, Users, MessageSquare } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TelegramConnectionStatus {
  isConnected: boolean
  isConnecting: boolean
  botUsername?: string
  botId?: number
}

interface AccessControlConfig {
  dmPolicy: 'disabled' | 'pairing' | 'allowlist' | 'open'
  groupPolicy: 'disabled' | 'allowlist' | 'open'
  allowedUsers: string[]
  allowedChats: string[]
  requireMention?: boolean
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
  const [accessControl, setAccessControl] = useState<AccessControlConfig>({
    dmPolicy: 'open',
    groupPolicy: 'open',
    allowedUsers: [],
    allowedChats: [],
    requireMention: false
  })
  const [newUserId, setNewUserId] = useState('')
  const [newChatId, setNewChatId] = useState('')

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

        // Load access control config
        const accessControlResult = await window.electronAPI.telegramGetAccessControl(workspaceId)
        if (accessControlResult.success && accessControlResult.accessControl) {
          setAccessControl(accessControlResult.accessControl)
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

  const saveAccessControl = async (newConfig: AccessControlConfig) => {
    if (!workspaceId) return
    try {
      const result = await window.electronAPI.telegramSetAccessControl(workspaceId, newConfig)
      if (!result.success) {
        console.error('Failed to save access control config:', result.error)
        setError(result.error || 'Failed to save access control config')
      }
    } catch (error) {
      console.error('Failed to save access control config:', error)
      setError('Failed to save access control config')
    }
  }

  const handleDMPolicyChange = async (value: string) => {
    const newConfig = { ...accessControl, dmPolicy: value as any }
    setAccessControl(newConfig)
    await saveAccessControl(newConfig)
  }

  const handleGroupPolicyChange = async (value: string) => {
    const newConfig = { ...accessControl, groupPolicy: value as any }
    setAccessControl(newConfig)
    await saveAccessControl(newConfig)
  }

  const handleAddUser = async () => {
    if (!newUserId.trim()) return
    const newConfig = {
      ...accessControl,
      allowedUsers: [...accessControl.allowedUsers, newUserId.trim()]
    }
    setAccessControl(newConfig)
    setNewUserId('')
    await saveAccessControl(newConfig)
  }

  const handleRemoveUser = async (userId: string) => {
    const newConfig = {
      ...accessControl,
      allowedUsers: accessControl.allowedUsers.filter(id => id !== userId)
    }
    setAccessControl(newConfig)
    await saveAccessControl(newConfig)
  }

  const handleAddChat = async () => {
    if (!newChatId.trim()) return
    const newConfig = {
      ...accessControl,
      allowedChats: [...accessControl.allowedChats, newChatId.trim()]
    }
    setAccessControl(newConfig)
    setNewChatId('')
    await saveAccessControl(newConfig)
  }

  const handleRemoveChat = async (chatId: string) => {
    const newConfig = {
      ...accessControl,
      allowedChats: accessControl.allowedChats.filter(id => id !== chatId)
    }
    setAccessControl(newConfig)
    await saveAccessControl(newConfig)
  }

  const handleRequireMentionChange = async (checked: boolean) => {
    const newConfig = { ...accessControl, requireMention: checked }
    setAccessControl(newConfig)
    await saveAccessControl(newConfig)
  }

  return (
    <SettingsSection
      title="Telegram Integration"
      description="Connect a Telegram bot to interact with Vesper through Telegram messages"
    >
      {connection.isConnected ? (
        <>
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

          <SettingsCard>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <h3 className="font-medium">Access Control</h3>
              </div>

              <div className="space-y-4">
                {/* DM Policy */}
                <div className="space-y-2">
                  <Label htmlFor="dm-policy">
                    <MessageSquare className="inline h-3 w-3 mr-1" />
                    Direct Message Policy
                  </Label>
                  <Select value={accessControl.dmPolicy} onValueChange={handleDMPolicyChange}>
                    <SelectTrigger id="dm-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">Disabled - Block all DMs</SelectItem>
                      <SelectItem value="pairing">Pairing - Require approval code</SelectItem>
                      <SelectItem value="allowlist">Allowlist - Only allowed users</SelectItem>
                      <SelectItem value="open">Open - Accept all DMs</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {accessControl.dmPolicy === 'disabled' && 'Bot will not respond to direct messages'}
                    {accessControl.dmPolicy === 'pairing' && 'New users receive a pairing code to share with you'}
                    {accessControl.dmPolicy === 'allowlist' && 'Only users in the allowlist can send DMs'}
                    {accessControl.dmPolicy === 'open' && 'Anyone can send direct messages'}
                  </p>
                </div>

                {/* Group Policy */}
                <div className="space-y-2">
                  <Label htmlFor="group-policy">
                    <Users className="inline h-3 w-3 mr-1" />
                    Group Message Policy
                  </Label>
                  <Select value={accessControl.groupPolicy} onValueChange={handleGroupPolicyChange}>
                    <SelectTrigger id="group-policy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disabled">Disabled - Block all groups</SelectItem>
                      <SelectItem value="allowlist">Allowlist - Only allowed groups</SelectItem>
                      <SelectItem value="open">Open - Accept all groups</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {accessControl.groupPolicy === 'disabled' && 'Bot will not respond in groups'}
                    {accessControl.groupPolicy === 'allowlist' && 'Only groups/users in the allowlist can interact'}
                    {accessControl.groupPolicy === 'open' && 'Anyone in any group can interact'}
                  </p>
                </div>

                {/* Require Mention in Groups */}
                {accessControl.groupPolicy !== 'disabled' && (
                  <div className="flex items-center justify-between space-x-2 rounded-md border p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="require-mention">Require @mention in Groups</Label>
                      <p className="text-xs text-muted-foreground">
                        Bot only responds when mentioned, replied to, or receiving commands
                      </p>
                    </div>
                    <Switch
                      id="require-mention"
                      checked={accessControl.requireMention || false}
                      onCheckedChange={handleRequireMentionChange}
                    />
                  </div>
                )}

                {/* Allowed Users */}
                {(accessControl.dmPolicy === 'allowlist' || accessControl.dmPolicy === 'pairing' || accessControl.groupPolicy === 'allowlist') && (
                  <div className="space-y-2">
                    <Label>Allowed User IDs</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter Telegram user ID"
                        value={newUserId}
                        onChange={(e) => setNewUserId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddUser()
                          }
                        }}
                      />
                      <Button onClick={handleAddUser} size="sm">
                        Add
                      </Button>
                    </div>
                    {accessControl.allowedUsers.length > 0 && (
                      <div className="space-y-1">
                        {accessControl.allowedUsers.map((userId) => (
                          <div
                            key={userId}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                          >
                            <span className="font-mono">{userId}</span>
                            <Button
                              onClick={() => handleRemoveUser(userId)}
                              variant="ghost"
                              size="sm"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Allowed Chats */}
                {accessControl.groupPolicy === 'allowlist' && (
                  <div className="space-y-2">
                    <Label>Allowed Chat IDs</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter Telegram chat ID"
                        value={newChatId}
                        onChange={(e) => setNewChatId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddChat()
                          }
                        }}
                      />
                      <Button onClick={handleAddChat} size="sm">
                        Add
                      </Button>
                    </div>
                    {accessControl.allowedChats.length > 0 && (
                      <div className="space-y-1">
                        {accessControl.allowedChats.map((chatId) => (
                          <div
                            key={chatId}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                          >
                            <span className="font-mono">{chatId}</span>
                            <Button
                              onClick={() => handleRemoveChat(chatId)}
                              variant="ghost"
                              size="sm"
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </SettingsCard>
        </>
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
