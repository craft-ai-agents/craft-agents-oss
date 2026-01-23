/**
 * WhatsApp Settings Section
 *
 * Workspace-level WhatsApp integration settings.
 * Allows connecting/disconnecting WhatsApp and viewing connected sessions.
 */

import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { MessageCircle, LogOut, Phone, Plus } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  whatsappConnectionAtom,
  whatsappQRModalOpenAtom,
  whatsappSessionsAtom,
  whatsappErrorAtom,
  whatsappPhoneInputAtom,
  whatsappQRCodeAtom,
} from '@/atoms/whatsapp'

export function WhatsAppSettingsSection() {
  const { activeWorkspaceId: workspaceId } = useAppShellContext()
  const [connection, setConnection] = useAtom(whatsappConnectionAtom)
  const [, setQRModalOpen] = useAtom(whatsappQRModalOpenAtom)
  const [sessions, setSessions] = useAtom(whatsappSessionsAtom)
  const [, setError] = useAtom(whatsappErrorAtom)
  const [phoneInput, setPhoneInput] = useAtom(whatsappPhoneInputAtom)
  const [, setQRCode] = useAtom(whatsappQRCodeAtom)
  const [isLoading, setIsLoading] = useState(false)

  // Load WhatsApp sessions when component mounts
  useEffect(() => {
    const loadSessions = async () => {
      if (!workspaceId) return
      try {
        const result = await window.electronAPI.whatsappListSessions(workspaceId)
        if (result.success && result.sessions) {
          setSessions(result.sessions)
          // If we have sessions, check connection status
          if (result.sessions.length > 0) {
            const statusResult = await window.electronAPI.whatsappGetStatus(workspaceId)
            if (statusResult.success && statusResult.status?.connection === 'open') {
              setConnection({
                isConnected: true,
                isConnecting: false,
                phoneNumber: result.sessions[0].phoneNumber,
                connectedAt: result.sessions[0].connectedAt,
              })
            }
          }
        }
      } catch (error) {
        console.error('Failed to load WhatsApp sessions:', error)
      }
    }

    loadSessions()
  }, [workspaceId, setSessions, setConnection])

  // Set up WhatsApp event listeners
  useEffect(() => {
    // QR code received
    const cleanupQR = window.electronAPI.onWhatsAppQRCode((data) => {
      if (data.workspaceId === workspaceId) {
        setQRCode(data.qrCode)
        setConnection((prev) => ({ ...prev, isConnecting: true }))
      }
    })

    // Authenticated
    const cleanupAuth = window.electronAPI.onWhatsAppAuthenticated((data) => {
      if (data.workspaceId === workspaceId) {
        setConnection({
          isConnected: true,
          isConnecting: false,
          phoneNumber: data.phoneNumber,
          connectedAt: Date.now(),
        })
        setQRCode(null)
        // Refresh sessions list
        window.electronAPI.whatsappListSessions(workspaceId).then((result) => {
          if (result.success && result.sessions) {
            setSessions(result.sessions)
          }
        })
      }
    })

    // Disconnected
    const cleanupDisconnect = window.electronAPI.onWhatsAppDisconnected((data) => {
      if (data.workspaceId === workspaceId) {
        setConnection({
          isConnected: false,
          isConnecting: false,
        })
        // Refresh sessions list
        window.electronAPI.whatsappListSessions(workspaceId).then((result) => {
          if (result.success && result.sessions) {
            setSessions(result.sessions)
          }
        })
      }
    })

    // Error
    const cleanupError = window.electronAPI.onWhatsAppError((data) => {
      if (data.workspaceId === workspaceId) {
        setError(data.message)
        setConnection((prev) => ({ ...prev, isConnecting: false }))
      }
    })

    return () => {
      cleanupQR()
      cleanupAuth()
      cleanupDisconnect()
      cleanupError()
    }
  }, [workspaceId, setQRCode, setConnection, setSessions, setError])

  const handleConnect = async () => {
    if (!workspaceId || !phoneInput.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      // Format phone number (ensure it starts with +)
      const phone = phoneInput.startsWith('+') ? phoneInput : `+${phoneInput}`

      const result = await window.electronAPI.whatsappConnect(workspaceId, phone)

      if (result.success) {
        setConnection({ isConnected: false, isConnecting: true })
        setQRModalOpen(true)
      } else {
        setError(result.error || 'Failed to connect')
      }
    } catch (error) {
      console.error('Failed to connect WhatsApp:', error)
      setError('Failed to connect')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisconnect = async (phoneNumber?: string) => {
    if (!workspaceId) return

    const confirmed = confirm(
      'Disconnect WhatsApp? This will delete your session and you will need to scan QR code again.'
    )
    if (!confirmed) return

    setIsLoading(true)

    try {
      const result = await window.electronAPI.whatsappDisconnect(workspaceId, phoneNumber)

      if (result.success) {
        setConnection({ isConnected: false, isConnecting: false })
        setPhoneInput('')
        // Refresh sessions
        const sessionsResult = await window.electronAPI.whatsappListSessions(workspaceId)
        if (sessionsResult.success && sessionsResult.sessions) {
          setSessions(sessionsResult.sessions)
        }
      } else {
        setError(result.error || 'Failed to disconnect')
      }
    } catch (error) {
      console.error('Failed to disconnect WhatsApp:', error)
      setError('Failed to disconnect')
    } finally {
      setIsLoading(false)
    }
  }

  const formatPhoneNumber = (phone: string) => {
    // Basic formatting: +1234567890 -> +1 234 567 890
    if (phone.startsWith('+')) {
      const digits = phone.slice(1)
      if (digits.length >= 10) {
        return `+${digits.slice(0, -9)} ${digits.slice(-9, -6)} ${digits.slice(-6, -3)} ${digits.slice(-3)}`
      }
    }
    return phone
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <SettingsSection title="WhatsApp Integration">
      <SettingsCard>
        {sessions.length > 0 ? (
          <>
            {/* Connected sessions */}
            {sessions.map((session) => (
              <SettingsRow
                key={session.phoneNumber}
                label={formatPhoneNumber(session.phoneNumber)}
                description={`Connected ${formatDate(session.connectedAt)}`}
                action={
                  <div className="flex items-center gap-2">
                    {connection.isConnected &&
                    connection.phoneNumber === session.phoneNumber ? (
                      <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <div className="w-2 h-2 rounded-full bg-green-600 dark:bg-green-400" />
                        Active
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        Saved
                      </div>
                    )}
                  </div>
                }
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
              </SettingsRow>
            ))}

            {/* Disconnect button */}
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDisconnect(sessions[0]?.phoneNumber)}
                disabled={isLoading}
                className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect WhatsApp
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Not connected - show connect form */}
            <div className="p-4 space-y-4">
              <div>
                <h4 className="text-sm font-medium">Connect WhatsApp</h4>
                <p className="text-xs text-muted-foreground">
                  Link your WhatsApp account to receive and respond to messages via Vespr
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Phone Number</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="+1234567890"
                        className="pl-9 font-mono text-sm"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      disabled={!phoneInput.trim() || isLoading}
                    >
                      {isLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Connect
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter your phone number with country code (e.g., +1 for US)
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </SettingsCard>

      {/* How it works */}
      <SettingsCard>
        <div className="p-4 space-y-3">
          <h4 className="text-sm font-medium">How WhatsApp Integration Works</h4>
          <ul className="text-xs text-muted-foreground space-y-2">
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">1.</span>
              Add Vespr to your WhatsApp group chats
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">2.</span>
              Mention @vespr in a message to trigger the agent
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">3.</span>
              Use directives for permission control:
              <code className="bg-muted px-1 rounded">@vespr /safe</code> (read-only),
              <code className="bg-muted px-1 rounded">@vespr /ask</code> (prompt),
              <code className="bg-muted px-1 rounded">@vespr /allow-all</code> (auto)
            </li>
            <li className="flex items-start gap-2">
              <span className="font-medium text-foreground">4.</span>
              Results are sent back to the group (large results link to desktop)
            </li>
          </ul>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
