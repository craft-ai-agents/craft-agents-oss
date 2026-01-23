/**
 * WhatsApp Atoms
 *
 * State management for WhatsApp integration.
 * Manages connection status, QR codes, sessions, and error state.
 */

import { atom } from 'jotai'

/**
 * WhatsApp connection status from main process
 */
export interface WhatsAppConnection {
  isConnected: boolean
  isConnecting: boolean
  phoneNumber?: string
  connectedAt?: number
}

/**
 * WhatsApp connection atom
 */
export const whatsappConnectionAtom = atom<WhatsAppConnection>({
  isConnected: false,
  isConnecting: false,
})

/**
 * QR code received from Baileys worker
 */
export const whatsappQRCodeAtom = atom<string | null>(null)

/**
 * Show QR code modal
 */
export const whatsappQRModalOpenAtom = atom(false)

/**
 * WhatsApp session list (for settings display)
 */
export interface WhatsAppSessionInfo {
  phoneNumber: string
  connectedAt: number
}

export const whatsappSessionsAtom = atom<WhatsAppSessionInfo[]>([])

/**
 * WhatsApp error state
 */
export const whatsappErrorAtom = atom<string | null>(null)

/**
 * Phone number input for connecting
 */
export const whatsappPhoneInputAtom = atom('')
