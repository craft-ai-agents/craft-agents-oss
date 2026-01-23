/**
 * WhatsApp QR Code Modal
 *
 * Displays QR code for WhatsApp Web authentication.
 * Users scan this with their phone's WhatsApp app.
 */

import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { X, Smartphone, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import {
  whatsappQRCodeAtom,
  whatsappQRModalOpenAtom,
  whatsappConnectionAtom,
  whatsappErrorAtom,
} from '@/atoms/whatsapp'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function QRCodeModal() {
  const [qrCode] = useAtom(whatsappQRCodeAtom)
  const [isOpen, setIsOpen] = useAtom(whatsappQRModalOpenAtom)
  const [connection] = useAtom(whatsappConnectionAtom)
  const [error] = useAtom(whatsappErrorAtom)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Render QR code to canvas when qrCode changes
  useEffect(() => {
    if (qrCode && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrCode, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).catch((err) => {
        console.error('Failed to render QR code:', err)
      })
    }
  }, [qrCode])

  // Close modal when connected
  useEffect(() => {
    if (connection.isConnected) {
      setIsOpen(false)
    }
  }, [connection.isConnected, setIsOpen])

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Connect WhatsApp
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {error ? (
            <div className="text-center space-y-4">
              <div className="text-destructive text-sm">{error}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Trigger reconnect
                  setIsOpen(false)
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </div>
          ) : qrCode ? (
            <>
              <div className="bg-white p-4 rounded-lg shadow-sm">
                <canvas ref={canvasRef} />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Scan this QR code with WhatsApp on your phone
                </p>
                <ol className="text-xs text-muted-foreground text-left list-decimal list-inside space-y-1">
                  <li>Open WhatsApp on your phone</li>
                  <li>Tap Menu or Settings &rarr; Linked Devices</li>
                  <li>Tap "Link a Device"</li>
                  <li>Point your phone at this screen</li>
                </ol>
              </div>
            </>
          ) : connection.isConnecting ? (
            <div className="text-center space-y-4 py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
              <p className="text-sm text-muted-foreground">
                Connecting to WhatsApp...
              </p>
            </div>
          ) : (
            <div className="text-center space-y-4 py-8">
              <p className="text-sm text-muted-foreground">
                Waiting for QR code...
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
