import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ExternalLink, Maximize2, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'

type BrowserNode = { ref: string; role: string; name: string }
type BrowserSnapshot = { url: string; title: string; nodes: BrowserNode[] }

interface WebBrowserPanelProps {
  open: boolean
  onClose: () => void
}

const interactiveRoles = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab'])

/** A Web UI-only viewport for the persistent VPS agent-browser session. */
export function WebBrowserPanel({ open, onClose }: WebBrowserPanelProps) {
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [address, setAddress] = useState('about:blank')
  const [busy, setBusy] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)

  const refresh = useCallback(async (id: string) => {
    const [shot, tree] = await Promise.all([
      window.electronAPI.browserPane.screenshotImage(id, { format: 'jpeg' }),
      window.electronAPI.browserPane.snapshot(id),
    ])
    setImage(`data:image/${shot.imageFormat};base64,${shot.base64}`)
    setSnapshot(tree)
    setAddress(tree.url)
  }, [])

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      if (instanceId) await refresh(instanceId)
    } catch (error) {
      console.error('[WebBrowserPanel] browser action failed:', error)
    } finally {
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
        await refresh(id)
      } catch (error) {
        console.error('[WebBrowserPanel] failed to open VPS browser:', error)
      }
    })()
    return () => { cancelled = true }
  }, [open, refresh])

  useEffect(() => {
    if (!open || !instanceId) return
    const timer = window.setInterval(() => { void refresh(instanceId).catch(() => undefined) }, 1500)
    return () => window.clearInterval(timer)
  }, [open, instanceId, refresh])

  const navigate = () => {
    if (!instanceId || !address.trim()) return
    void run(async () => { await window.electronAPI.browserPane.navigate(instanceId, address.trim()) })
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
    })
  }

  if (!open) return null

  return (
    <section className="fixed right-0 top-[var(--topbar-height)] bottom-0 z-40 flex w-[min(100vw,900px)] flex-col border-l border-foreground/10 bg-background shadow-2xl">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-foreground/10 px-2">
        <span className="px-2 text-sm font-medium">浏览器</span>
        <Button variant="ghost" size="icon" className="size-8" disabled={busy || !instanceId} onClick={() => void run(async () => { await window.electronAPI.browserPane.goBack(instanceId!) })} title="后退"><ArrowLeft /></Button>
        <Button variant="ghost" size="icon" className="size-8" disabled={busy || !instanceId} onClick={() => void run(async () => { await window.electronAPI.browserPane.goForward(instanceId!) })} title="前进"><ArrowRight /></Button>
        <Button variant="ghost" size="icon" className="size-8" disabled={busy || !instanceId} onClick={() => void run(async () => { await window.electronAPI.browserPane.reload(instanceId!) })} title="刷新"><RefreshCw /></Button>
        <form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); navigate() }}>
          <input value={address} onChange={(event) => setAddress(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-foreground/10 bg-foreground/[0.03] px-2 text-xs outline-none focus:border-foreground/25" placeholder="输入网址" />
        </form>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => window.open(snapshot?.url ?? address, '_blank', 'noopener,noreferrer')} title="在新标签页打开"><ExternalLink /></Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} title="关闭浏览器"><X /></Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="overflow-hidden rounded-md border border-foreground/10 bg-black">
          {image ? <img ref={imageRef} src={image} alt={snapshot?.title || 'Browser'} className={cn('block h-auto w-full cursor-crosshair', busy && 'opacity-70')} onClick={clickViewport} /> : <div className="flex aspect-video items-center justify-center text-xs text-white/60">正在打开浏览器</div>}
        </div>
        {snapshot && <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-foreground/50"><Check className="size-3" />{snapshot.title || snapshot.url}</div>}
        <div className="mt-2 divide-y divide-foreground/10 rounded-md border border-foreground/10">
          {(snapshot?.nodes ?? []).filter(node => interactiveRoles.has(node.role)).map(node => (
            <div key={node.ref} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <button className="shrink-0 font-mono text-[10px] text-blue-500 hover:underline" onClick={() => void run(async () => { await window.electronAPI.browserPane.click(instanceId!, node.ref) })}>{node.ref}</button>
              <span className="min-w-0 flex-1 truncate">{node.name || node.role}</span>
              {(node.role === 'textbox' || node.role === 'combobox') && <input className="h-7 w-40 rounded border border-foreground/10 bg-transparent px-1.5 text-xs" placeholder="填写" onKeyDown={(event) => { if (event.key === 'Enter') { const value = event.currentTarget.value; void run(async () => { await window.electronAPI.browserPane.fill(instanceId!, node.ref, value) }) } }} />}
            </div>
          ))}
        </div>
      </div>
      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-foreground/10 px-3 text-[10px] text-foreground/45"><span>持久化浏览器状态保存在 VPS</span><Maximize2 className="size-3" /></footer>
    </section>
  )
}
