import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'

type BrowserSnapshot = { url: string; title: string }

interface WebBrowserPanelProps {
  open: boolean
  onClose: () => void
}

// Keep the remote browser itself at a mobile viewport size, not just a mobile
// looking shell. This makes responsive sites render their mobile layout too.
const MOBILE_VIEWPORT = { width: 390, height: 720 }

/** A mobile-style viewport for the persistent VPS agent-browser session. */
export function WebBrowserPanel({ open, onClose }: WebBrowserPanelProps) {
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [address, setAddress] = useState('about:blank')
  const [busy, setBusy] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const busyRef = useRef(false)

  const refresh = useCallback(async (id: string, syncAddress = false) => {
    const [shot, tree] = await Promise.all([
      window.electronAPI.browserPane.screenshotImage(id, { format: 'jpeg' }),
      window.electronAPI.browserPane.snapshot(id),
    ])
    setImage(`data:image/${shot.imageFormat};base64,${shot.base64}`)
    setSnapshot(tree)

    // The polling refresh must not write into the address field: doing that
    // used to erase a URL while the user was typing it.
    if (syncAddress) setAddress(tree.url)
  }, [])

  const run = useCallback(async (action: () => Promise<void>, syncAddress = true) => {
    const id = instanceId
    if (!id) return

    busyRef.current = true
    setBusy(true)
    try {
      await action()
      await refresh(id, syncAddress)
    } catch (error) {
      console.error('[WebBrowserPanel] browser action failed:', error)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [instanceId, refresh])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    void (async () => {
      try {
        const instances = await window.electronAPI.browserPane.list()
        const id = instances[0]?.id ?? await window.electronAPI.browserPane.create({ show: true })
        if (cancelled) return

        setInstanceId(id)
        await window.electronAPI.browserPane.resize(id, MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height)
        // The VPS agent applies viewport changes asynchronously. Give it a
        // moment before capturing, otherwise the first frame can still be a
        // desktop-sized screenshot.
        await new Promise((resolve) => window.setTimeout(resolve, 250))
        if (!cancelled) await refresh(id, true)
      } catch (error) {
        console.error('[WebBrowserPanel] failed to open VPS browser:', error)
      }
    })()

    return () => { cancelled = true }
  }, [open, refresh])

  useEffect(() => {
    if (!open || !instanceId) return
    const timer = window.setInterval(() => {
      if (!busyRef.current) void refresh(instanceId).catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [open, instanceId, refresh])

  const navigate = () => {
    const url = address.trim()
    if (!instanceId || !url) return
    void run(async () => {
      await window.electronAPI.browserPane.navigate(instanceId, url)
    })
  }

  const clickViewport = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!instanceId || !imageRef.current) return
    const rect = imageRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const scaleX = imageRef.current.naturalWidth / rect.width
    const scaleY = imageRef.current.naturalHeight / rect.height
    void run(async () => {
      await window.electronAPI.browserPane.clickAt(
        instanceId,
        (event.clientX - rect.left) * scaleX,
        (event.clientY - rect.top) * scaleY,
      )
    }, false)
  }

  if (!open) return null

  return (
    <section className="fixed inset-x-0 bottom-0 top-[var(--topbar-height)] z-40 flex flex-col bg-[#f4f5f7] shadow-2xl">
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-black/[0.08] bg-background/95 px-2 backdrop-blur sm:px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          disabled={busy || !instanceId}
          onClick={() => void run(async () => { await window.electronAPI.browserPane.goBack(instanceId!) })}
          title="后退"
          aria-label="后退"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          disabled={busy || !instanceId}
          onClick={() => void run(async () => { await window.electronAPI.browserPane.goForward(instanceId!) })}
          title="前进"
          aria-label="前进"
        >
          <ArrowRight className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          disabled={busy || !instanceId}
          onClick={() => void run(async () => { await window.electronAPI.browserPane.reload(instanceId!) })}
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw className={cn('size-5', busy && 'animate-spin')} />
        </Button>

        <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 w-full rounded-xl border border-black/[0.12] bg-black/[0.04] px-3 text-[14px] outline-none transition focus:border-black/25 focus:bg-background"
            placeholder="输入网址或搜索内容"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="网址"
          />
        </form>

        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          disabled={!snapshot?.url && !address}
          onClick={() => window.open(snapshot?.url ?? address, '_blank', 'noopener,noreferrer')}
          title="在新标签页打开"
          aria-label="在新标签页打开"
        >
          <ExternalLink className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" onClick={onClose} title="关闭浏览器" aria-label="关闭浏览器">
          <X className="size-5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-5 sm:py-5">
        <div className="mx-auto flex min-h-full w-full max-w-[430px] items-start justify-center overflow-hidden rounded-[26px] border border-black/[0.12] bg-black shadow-[0_12px_40px_rgba(0,0,0,0.16)]">
          <div className="relative w-full overflow-hidden bg-black">
            {image ? (
              <img
                ref={imageRef}
                src={image}
                alt={snapshot?.title || '浏览器页面'}
                className={cn('block h-auto w-full cursor-crosshair', busy && 'opacity-70')}
                onClick={clickViewport}
              />
            ) : (
              <div className="flex aspect-[390/720] items-center justify-center text-white/60">
                <LoaderCircle className="size-6 animate-spin" />
              </div>
            )}
            {busy && image && <div className="pointer-events-none absolute inset-0 bg-white/10" />}
          </div>
        </div>
      </div>
    </section>
  )
}
