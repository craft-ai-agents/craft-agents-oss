import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowUp, Camera, Check, CircleAlert, Copy, CornerDownLeft, ExternalLink, Image as ImageIcon, X } from 'lucide-react'
import { Markdown, Spinner } from '@craft-agent/ui'
import { Button, IconButton } from '@/components/ui/button'
import type { FileAttachment, StoredAttachment } from '../../shared/types'
import type {
  CraftyCreateSessionResult,
  CraftyEvent,
  CraftyFollowStrategy,
  CraftyInvocation,
  CraftyPoint,
  CraftyProvenance,
  CraftyRecentScreenshot,
  CraftyScreenshot,
  CraftySelectionResult,
  CraftySessionModel,
  CraftySessionSummary,
  CraftyTransform,
} from '../../shared/crafty'
import {
  buildCraftyMessage,
  DEFAULT_QUESTION,
  FORWARD_QUESTION,
  markSent,
  newTurn,
  presetQuestion,
  reduceTurn,
  sessionBusyAfter,
  withoutPermission,
  type CraftyTurn,
} from './session'
import { useCompanionFollow } from './useCompanionFollow'
import { EDGE, PanelAnchor } from './PanelAnchor'
import { ContextChip, ContextDetails } from './ContextDetails'
import { CraftyModelMenu } from './CraftyModelMenu'
import { CraftyTargetMenu } from './CraftyTargetMenu'
import { useCraftyModel } from './useCraftyModel'
import { sessionTitle, targetSession } from './target'
import { OneShotCard, type OneShot } from './OneShotCard'
import { CraftyPie, type PieRelease } from './pie/CraftyPie'
import type { PieAction } from './pie/slots'

const crafty = window.electronAPI.crafty!

const PANEL_WIDTH = 400
const PANEL_GAP = 10
/** Open the panel at the cursor if the selection hasn't arrived by then. */
const SELECTION_WAIT_MS = 350
/** Matches the exit animation (--dur-exit). */
const EXIT_MS = 110
/** How long a notice by the cursor stays: a confirmation, and an error you need time to read. */
const NOTE_MS = 1800
const NOTE_ERROR_MS = 4000

/**
 * - `companion` → `panel`: the panel surface (Settings → Crafty → Opens).
 * - `pie`, then what its pick shows: `panel`, `capturing` (macOS's region picker runs), `preview`
 *   (a Rewrite or Translate), or `notice` (a line by the cursor after Send to or Replace).
 * - `closing`: whatever was up animates out (`closingFrom`).
 */
type Phase = 'hidden' | 'companion' | 'pie' | 'capturing' | 'panel' | 'preview' | 'notice' | 'closing'

interface CursorNote {
  text: string
  tone: 'progress' | 'success' | 'error'
}

/** An answer the panel sent to a permission prompt: on its way (`error` null), or why it failed. */
interface PermissionAnswer {
  requestId: string
  error: string | null
}

interface Placement {
  x: number
  y: number
  above: boolean
  originX: number
  originY: number
}

/**
 * Below the selection when it's known, else below-right of `origin`; flipped up near the bottom.
 * It blooms out of `origin`: the companion at the cursor, or the pie's hub. `PanelAnchor` sizes it
 * to the space at its spot, also after you drag it.
 */
function placePanel(invocation: CraftyInvocation, selection: CraftySelectionResult | null, origin: CraftyPoint): Placement {
  const { width, height } = invocation.windowSize
  const bounds = selection?.selection?.bounds ?? null
  const anchorX = bounds ? bounds.x : origin.x + 14
  const belowY = bounds ? bounds.y + bounds.height + PANEL_GAP : origin.y + 14
  const aboveY = bounds ? bounds.y - PANEL_GAP : origin.y - 14
  const x = Math.min(Math.max(anchorX, EDGE), Math.max(EDGE, width - PANEL_WIDTH - EDGE))
  const spaceBelow = height - belowY - EDGE
  const spaceAbove = aboveY - EDGE
  const above = spaceBelow < 320 && spaceAbove > spaceBelow
  const y = above ? aboveY : belowY
  return { x, y, above, originX: origin.x - x, originY: origin.y - y }
}

/** The panel's frame (also the one-shot preview's): its width, height cap and bloom origin. */
function frameStyle(placement: Placement): CSSProperties {
  return {
    width: PANEL_WIDTH,
    maxHeight: 'var(--crafty-max-height)',
    '--crafty-origin-x': `${placement.originX}px`,
    '--crafty-origin-y': placement.above ? `calc(100% + ${placement.originY}px)` : `${placement.originY}px`,
  } as CSSProperties
}

/** Screenshots ready for `sendMessage`: stored in the session, as App.tsx sends them. */
async function attachScreenshots(sessionId: string, screenshots: CraftyScreenshot[]): Promise<{ attachments?: FileAttachment[]; stored?: StoredAttachment[] }> {
  if (screenshots.length === 0) return {}
  const stored = await Promise.all(screenshots.map(shot => window.electronAPI.storeAttachment(sessionId, shot.attachment)))
  // The stored path for the agent, the normalized image for the model
  const attachments = screenshots.map((shot, i) => ({
    ...shot.attachment,
    storedPath: stored[i].storedPath,
    mimeType: stored[i].mimeType,
    base64: stored[i].resizedBase64 ?? shot.attachment.base64,
  }))
  return { attachments, stored }
}

/** Over something of the window's (the panel, its menus), not the empty page around it. */
function isOverContent(target: EventTarget | null): boolean {
  return target instanceof Element && target !== document.documentElement && target !== document.body && target.id !== 'root'
}

/** Two frames: the frame with the new state has been committed to the screen. */
function afterPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * macOS's own prompt, which also adds Craft Agents to the Accessibility list so there's a switch to
 * turn on, and the list itself. Call it with the window out of the way: it floats above System Settings.
 */
async function askForAccessibility(): Promise<void> {
  await crafty.requestAccessibility()
  await crafty.openPermissionSettings('accessibility')
}

/** What the answer area says before the answer's text: where the question is, or what the agent does. */
function pendingLabel(turn: CraftyTurn, where: string | null): string {
  const inWhere = where ? ` in “${where}”` : ''
  if (turn.delivery === 'queued') return `Queued${inWhere}: it answers once the current turn is done`
  if (turn.activity) return turn.activity
  if (turn.delivery === 'steered') return `Added to the turn running${inWhere}…`
  return 'Thinking…'
}

export function CraftyApp() {
  const [phase, setPhaseState] = useState<Phase>('hidden')
  const [invocation, setInvocation] = useState<CraftyInvocation | null>(null)
  const [selection, setSelection] = useState<CraftySelectionResult | null>(null)
  const [provenance, setProvenance] = useState<CraftyProvenance | null>(null)
  const [recentScreenshot, setRecentScreenshot] = useState<CraftyRecentScreenshot | null>(null)
  const [screenshots, setScreenshots] = useState<CraftyScreenshot[]>([])
  /** Where the next question goes: an existing session, or null for a new one ("Send Crafty here"). */
  const [target, setTarget] = useState<CraftySessionSummary | null>(null)
  /** The session this panel's conversation is in, once it asked: the one it created, or the target. */
  const [session, setSession] = useState<CraftyCreateSessionResult | null>(null)
  const [turn, setTurn] = useState<CraftyTurn | null>(null)
  /** The panel's answer to a permission prompt: on its way, or why it didn't arrive. Keyed by request. */
  const [permissionAnswer, setPermissionAnswer] = useState<PermissionAnswer | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [follow, setFollow] = useState<CraftyFollowStrategy>('off')
  /** The capture's details under the header (closed by default: you know what you selected). */
  const [detailsOpen, setDetailsOpen] = useState(false)
  /** The answer was just copied: the Copy button shows a tick for a moment. */
  const [copied, setCopied] = useState(false)
  /** What was up when `closing` started, so it can animate out. */
  const [closingFrom, setClosingFrom] = useState<Phase | null>(null)
  /** The double-tap's release, for the pie (it can arrive before the pie's first render). */
  const [triggerRelease, setTriggerRelease] = useState<PieRelease | null>(null)
  /** Whether the source app's focused element takes text: a one-shot's Replace, or only Copy. */
  const [editable, setEditable] = useState<boolean | null>(null)
  /** Where the pie's hub was: what a pick shows grows out of it (the panel, the preview, a notice). */
  const [hubPoint, setHubPoint] = useState<CraftyPoint | null>(null)
  const [oneShot, setOneShot] = useState<OneShot | null>(null)
  const [cursorNote, setCursorNote] = useState<CursorNote | null>(null)
  const detailsId = useId()

  const invocationRef = useRef<CraftyInvocation | null>(null)
  const phaseRef = useRef<Phase>('hidden')
  /** The session whose events the panel follows: the conversation's, else the target's. */
  const sessionIdRef = useRef<string | null>(null)
  /** Whether that session is running a turn (see `sessionBusyAfter`). */
  const sessionBusyRef = useRef(false)
  /** Set from the first question on: the conversation stays where it started. */
  const askedRef = useRef(false)
  const sentAtRef = useRef(0)
  const firstTokenRef = useRef(false)
  const companionRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const openTimerRef = useRef<number | null>(null)
  const noteTimerRef = useRef<number | null>(null)

  /**
   * Every phase change goes through here, so the ref is current at once: main's events can
   * arrive back to back (`invoke`, then `selection`) before React renders the first change.
   */
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const moveCompanion = useCallback((point: CraftyPoint) => {
    const el = companionRef.current
    if (el) el.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`
  }, [])

  /** Follow this target's events until the first question (a busy target's turn must be known). */
  const followTarget = useCallback((next: CraftySessionSummary | null) => {
    setTarget(next)
    sessionIdRef.current = next?.sessionId ?? null
    sessionBusyRef.current = next?.isProcessing ?? false
  }, [])

  const reset = useCallback(() => {
    setSelection(null)
    setProvenance(null)
    setRecentScreenshot(null)
    setScreenshots([])
    setSession(null)
    setTurn(null)
    setInput('')
    setBusy(null)
    setNotice(null)
    setDetailsOpen(false)
    setCopied(false)
    setClosingFrom(null)
    setTriggerRelease(null)
    setEditable(null)
    setHubPoint(null)
    setOneShot(null)
    setCursorNote(null)
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current)
    noteTimerRef.current = null
    followTarget(null)
    askedRef.current = false
  }, [followTarget])

  const openPanel = useCallback(() => {
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current)
    openTimerRef.current = null
    if (phaseRef.current !== 'companion') return
    setPhase('panel')
    const inv = invocationRef.current
    if (inv) void crafty.metric({ kind: 'panel-open', invocationId: inv.id, ms: Date.now() - inv.at })
  }, [setPhase])

  /** Animate out, clear the frame (so the next show can't flash this one), then let main hide. */
  const close = useCallback(async (reason: string) => {
    const from = phaseRef.current
    if (from === 'hidden' || from === 'closing') return
    const closing = invocationRef.current?.id
    if (from === 'pie') void crafty.metric({ kind: 'pie:cancel', invocationId: closing, reason })
    setClosingFrom(from)
    setPhase('closing')
    await new Promise(resolve => setTimeout(resolve, EXIT_MS))
    // Called again while this one animated out: the new invocation owns the window now
    if (invocationRef.current?.id !== closing) return
    setPhase('hidden')
    reset()
    await afterPaint()
    await crafty.setInteractive(false)
    await crafty.hide(reason)
  }, [reset, setPhase])

  // ---- Events from main (long poll) ----
  const handleEvent = useCallback((event: CraftyEvent) => {
    switch (event.type) {
      case 'invoke': {
        const inv = event.invocation
        invocationRef.current = inv
        reset()
        followTarget(inv.target)
        setInvocation(inv)
        if (openTimerRef.current) window.clearTimeout(openTimerRef.current)
        openTimerRef.current = null
        if (inv.surface === 'pie') {
          setPhase('pie')
        } else {
          setPhase('companion')
          moveCompanion(inv.cursor)
          openTimerRef.current = window.setTimeout(openPanel, SELECTION_WAIT_MS)
        }
        const receivedMs = Date.now() - inv.at
        void afterPaint().then(() => {
          const ms = Date.now() - inv.at
          void crafty.metric({ kind: 'first-frame', invocationId: inv.id, ms, receivedMs, reloaded: inv.reloaded, surface: inv.surface })
        })
        break
      }
      case 'selection':
        if (event.invocationId !== invocationRef.current?.id) return
        setSelection(event.result)
        openPanel()
        break
      case 'provenance':
        if (event.invocationId !== invocationRef.current?.id) return
        setProvenance(event.provenance)
        setRecentScreenshot(event.recentScreenshot)
        break
      case 'dismiss':
        void close(event.reason)
        break
      case 'follow':
        setFollow(event.strategy)
        break
      case 'target':
        // Changed in Craft while the panel is open; a conversation already started stays where it is
        if (!askedRef.current) followTarget(event.target)
        break
      case 'trigger-release':
        if (event.invocationId === invocationRef.current?.id) setTriggerRelease({ heldMs: event.heldMs, interrupted: event.interrupted })
        break
      case 'editable':
        if (event.invocationId === invocationRef.current?.id) setEditable(event.editable)
        break
    }
  }, [close, followTarget, moveCompanion, openPanel, reset, setPhase])

  const handleEventRef = useRef(handleEvent)
  handleEventRef.current = handleEvent
  useEffect(() => {
    let stopped = false
    void (async () => {
      while (!stopped) {
        try {
          const event = await crafty.nextEvent()
          if (!stopped) handleEventRef.current(event)
        } catch {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    })()
    return () => { stopped = true }
  }, [])

  // ---- Session events (filtered to this panel's session, or its target before the question) ----
  useEffect(() => {
    return window.electronAPI.onSessionEvent((event) => {
      if (!sessionIdRef.current || event.sessionId !== sessionIdRef.current) return
      const busyBefore = sessionBusyRef.current
      sessionBusyRef.current = sessionBusyAfter(busyBefore, event)
      setTurn(current => (current ? reduceTurn(current, event, busyBefore) : current))
    })
  }, [])

  // ---- Timings: to the answer's first text, to the end of its turn, and where the question went ----
  const turnRef = useRef(turn)
  turnRef.current = turn
  const answerShown = !!turn?.answer
  const answerStreaming = turn?.streaming ?? false
  const delivery = turn?.delivery ?? null
  useEffect(() => {
    if (!answerShown || firstTokenRef.current) return
    firstTokenRef.current = true
    void crafty.metric({ kind: 'first-token', invocationId: invocationRef.current?.id, ms: Date.now() - sentAtRef.current, delivery: turnRef.current?.delivery })
  }, [answerShown])
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const was = wasStreamingRef.current
    wasStreamingRef.current = answerStreaming
    const current = turnRef.current
    if (!was || answerStreaming || !current) return
    void crafty.metric({
      kind: 'answer-complete',
      invocationId: invocationRef.current?.id,
      ms: Date.now() - sentAtRef.current,
      delivery: current.delivery,
      answered: !!current.answer,
      error: !!current.error,
    })
  }, [answerStreaming])
  useEffect(() => {
    if (delivery === 'queued' || delivery === 'steered') {
      void crafty.metric({ kind: 'delivery', invocationId: invocationRef.current?.id, delivery, ms: Date.now() - sentAtRef.current })
    }
  }, [delivery])

  // ---- Focus: make the panel key once it blooms, then focus the input ----
  // From the pie the window is already key: the input takes focus in the same commit, so keys typed
  // right after the first one (type-to-ask) land in it, after the text the pie passed on
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (phase !== 'panel' || !textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [phase])
  // The panel and a one-shot's preview (↵ replaces) take the keyboard; the pie hands over with ⌘ up
  useEffect(() => {
    if ((phase !== 'panel' && phase !== 'preview') || !invocation) return
    void crafty.focusPanel(invocation.id).then(() => textareaRef.current?.focus())
  }, [phase, invocation])

  // ---- Mouse: the window takes it only over its content, so clicks elsewhere reach the app ----
  // Read from the pointer's target, which also counts the panel's menus (portals outside it). The
  // pie takes the whole window instead, so a pick hands over with the window interactive: the first
  // move sets it right.
  useEffect(() => {
    if (phase !== 'panel' && phase !== 'preview') return
    let over: boolean | null = null
    const onMove = (e: PointerEvent) => {
      const next = isOverContent(e.target)
      if (next === over) return
      over = next
      void crafty.setInteractive(next)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [phase])

  // ---- Esc closes ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu that took the Esc (the model menu) has already closed itself
      const phaseNow = phaseRef.current
      if (e.key === 'Escape' && (phaseNow === 'panel' || phaseNow === 'preview') && !e.defaultPrevented) {
        e.preventDefault()
        void close('escape')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // ---- Cursor follow (spike item 3; switched in Settings) ----
  const following = follow !== 'off' && (phase === 'hidden' || phase === 'companion')
  useCompanionFollow(follow, following, moveCompanion)

  // ---- Connection, model and thinking level (the composer's model menu) ----
  // An existing target shows its own model, and a change there is that session's alone
  const targetModel = useMemo(() => (target ? targetSession(target) : null), [target])
  const updateSessionModel = useCallback((change: CraftySessionModel) => {
    setSession(current => current && { ...current, ...change })
    setTarget(current => current && { ...current, ...change })
  }, [])
  const { menu: modelMenu, sessionOptions } = useCraftyModel({
    workspaceId: invocation?.workspaceId ?? null,
    invocationId: invocation?.id ?? null,
    session: session ?? targetModel,
    rememberPicks: !target,
    onSessionChange: updateSessionModel,
  })

  // ---- Target: a pick sends the next question there, and every later one ----
  const pickTarget = useCallback(async (next: CraftySessionSummary | null) => {
    try {
      await crafty.setTarget(next && { workspaceId: next.workspaceId, sessionId: next.sessionId })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      return
    }
    // Already where the conversation is (the session this panel just created): nothing moves
    if (next && session?.sessionId === next.sessionId) {
      setTarget(next)
      return
    }
    // Elsewhere: start over there, with the same capture
    setSession(null)
    setTurn(null)
    askedRef.current = false
    followTarget(next)
    textareaRef.current?.focus()
  }, [followTarget, session?.sessionId])

  // ---- Sending ----
  /** `preset`: a question the pie picked (Summarize, Explain, Reply) instead of the input's. */
  const send = useCallback(async (preset?: string) => {
    const inv = invocationRef.current
    if (!inv || busy || turn?.streaming) return
    const question = (preset ?? input).trim() || DEFAULT_QUESTION
    const isFirst = !session
    // A session the panel didn't just create may be busy: tag the message to find its turn
    const existing = session ?? (target ? targetSession(target) : null)
    const messageId = existing ? `crafty-${crypto.randomUUID()}` : null
    askedRef.current = true
    if (preset === undefined) setInput('')
    setNotice(null)
    setCopied(false)
    setTurn(newTurn(question, messageId))
    firstTokenRef.current = false
    sentAtRef.current = Date.now()
    const busyAtSend = existing ? sessionBusyRef.current : false
    try {
      let destination = existing
      if (!destination) {
        destination = await crafty.createSession(inv.id, sessionOptions())
        sessionBusyRef.current = false
      }
      if (isFirst) setSession(destination)
      sessionIdRef.current = destination.sessionId
      const sessionId = destination.sessionId
      const message = isFirst ? buildCraftyMessage(question, selection?.selection ?? null, provenance, screenshots.length) : question
      const { attachments, stored } = isFirst ? await attachScreenshots(sessionId, screenshots) : {}
      await window.electronAPI.sendMessage(sessionId, message, attachments, stored, messageId ? { optimisticMessageId: messageId } : undefined)
      setTurn(current => current && markSent(current))
      void crafty.metric({
        kind: 'send',
        invocationId: inv.id,
        firstMessage: isFirst,
        attached: !!target,
        busyAtSend,
        questionLength: question.length,
        selectionLength: selection?.selection?.text.length ?? 0,
        screenshots: isFirst ? screenshots.length : 0,
        msSinceInvoke: Date.now() - inv.at,
        sendMs: Date.now() - sentAtRef.current,
      })
    } catch (error) {
      setTurn(current => current && { ...current, streaming: false, activity: null, error: error instanceof Error ? error.message : String(error) })
    }
  }, [busy, input, provenance, screenshots, selection, session, sessionOptions, target, turn?.streaming])

  // ---- Answer actions ----
  const insert = useCallback(async () => {
    const inv = invocationRef.current
    const text = turn?.answer.trim()
    if (!inv || !text) return
    void crafty.metric({ kind: 'insert-click', invocationId: inv.id })
    // Clear the frame first: main hides the window before typing into the app underneath
    setPhase('hidden')
    await afterPaint()
    const result = await crafty.insert({ invocationId: inv.id, text, mode: 'auto' })
    if (result.ok) {
      reset()
    } else {
      setNotice(`Couldn't insert (${result.mode}): ${result.error ?? 'unknown error'}`)
      setPhase('panel')
    }
  }, [reset, setPhase, turn?.answer])

  const copy = useCallback(async () => {
    if (!turn?.answer) return
    await navigator.clipboard.writeText(turn.answer.trim())
    setCopied(true)
  }, [turn?.answer])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  /** The conversation's session, else the target before the first question. */
  const openable = session ?? targetModel
  const openInCraft = useCallback(async () => {
    if (!openable) return
    setPhase('hidden')
    await afterPaint()
    reset()
    await crafty.openInCraft(openable.workspaceId, openable.sessionId)
  }, [openable, reset, setPhase])

  const captureRegion = useCallback(async () => {
    const inv = invocationRef.current
    if (!inv) return
    setBusy('Select a region…')
    try {
      const shot = await crafty.captureRegion(inv.id)
      if (shot) setScreenshots(current => [...current, shot])
    } finally {
      setBusy(null)
      void crafty.focusPanel(inv.id).then(() => textareaRef.current?.focus())
    }
  }, [])

  const addRecentScreenshot = useCallback(async () => {
    const inv = invocationRef.current
    if (!inv) return
    const shot = await crafty.useRecentScreenshot(inv.id)
    if (shot) {
      setScreenshots(current => [...current, shot])
      setRecentScreenshot(null)
    }
  }, [])

  const openAccessibilitySettings = useCallback(async () => {
    // Out of the way first: the panel floats above System Settings
    await close('open-settings')
    await askForAccessibility()
  }, [close])

  /** The permission prompt on show: the oldest one still waiting. */
  const shownPermission = turn?.permissions[0] ?? null

  const respondToPermission = useCallback(async (allowed: boolean) => {
    const request = shownPermission
    if (!request || !session) return
    // Only this prompt's answer: a later prompt may have one on its way by the time this settles
    const settle = (next: PermissionAnswer | null) =>
      setPermissionAnswer(current => (current?.requestId === request.requestId ? next : current))
    setPermissionAnswer({ requestId: request.requestId, error: null })
    try {
      // false: it was answered somewhere else first, and that answer stands
      await window.electronAPI.respondToPermission(session.sessionId, request.requestId, allowed, false)
      setTurn(current => current && withoutPermission(current, request.requestId))
      settle(null)
    } catch (error) {
      // The card stays up so it can be answered again; without it the agent would wait for nothing
      const message = error instanceof Error ? error.message : String(error)
      settle({ requestId: request.requestId, error: `Your answer didn't reach the session: ${message}` })
    }
  }, [session, shownPermission])

  // ---- The pie's results ----
  /** A line by the hub for `ms` (null: until replaced), click-through; then the window closes. */
  const showCursorNote = useCallback((note: CursorNote, ms: number | null) => {
    const id = invocationRef.current?.id
    setCursorNote(note)
    setPhase('notice')
    void crafty.setInteractive(false)
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current)
    noteTimerRef.current = ms === null ? null : window.setTimeout(() => {
      noteTimerRef.current = null
      if (invocationRef.current?.id === id) void close('notice')
    }, ms)
  }, [close, setPhase])

  const pieResult = useCallback((fields: Record<string, unknown>) => {
    void crafty.metric({ kind: 'pie:result', invocationId: invocationRef.current?.id, ...fields })
  }, [])

  const runTransform = useCallback(async (transform: CraftyTransform, title: string, languageCode?: string) => {
    const inv = invocationRef.current
    const text = selection?.selection?.text
    if (!inv || !text) return
    setOneShot({ transform, title, languageCode, status: 'running', result: null, error: null })
    setCopied(false)
    try {
      const result = await crafty.transform({ invocationId: inv.id, transform, text, model: sessionOptions(), languageCode })
      if (invocationRef.current?.id !== inv.id) return
      setOneShot(current => current?.transform === transform ? { ...current, status: 'done', result: result.text } : current)
    } catch (error) {
      if (invocationRef.current?.id !== inv.id) return
      const message = error instanceof Error ? error.message : String(error)
      setOneShot(current => current?.transform === transform ? { ...current, status: 'error', error: message } : current)
    }
  }, [selection, sessionOptions])

  /** Paste the result over the selection, which is still selected: the pie swallowed every click. */
  const replaceSelection = useCallback(async () => {
    const inv = invocationRef.current
    const text = oneShot?.status === 'done' ? oneShot.result : null
    if (!inv || !text) return
    // Clear the frame first: main hides the window before pasting into the app underneath
    setPhase('hidden')
    await afterPaint()
    const result = await crafty.insert({ invocationId: inv.id, text, mode: 'paste', confirm: true })
    pieResult({ result: 'replace', ok: result.ok, editable, mode: result.mode, reactivated: result.reactivated ?? null, ms: result.durationMs, error: result.error ?? null })
    if (invocationRef.current?.id !== inv.id) return
    if (result.ok) {
      showCursorNote({ text: 'Replaced · ⌘Z undoes it', tone: 'success' }, NOTE_MS)
      return
    }
    setOneShot(current => current && { ...current, error: `Couldn't replace (${result.mode}): ${result.error ?? 'unknown error'}` })
    setPhase('preview')
  }, [editable, oneShot, pieResult, setPhase, showCursorNote])

  const copyOneShot = useCallback(async () => {
    if (!oneShot?.result) return
    await navigator.clipboard.writeText(oneShot.result)
    setCopied(true)
    pieResult({ result: 'copy', editable })
  }, [editable, oneShot?.result, pieResult])

  /** Send to: the capture as a message, like a forward. The session answers; Craft notifies. */
  const sendCapture = useCallback(async (destination: CraftySessionSummary | null) => {
    const inv = invocationRef.current
    if (!inv) return
    const started = Date.now()
    // Typing goes back to the app at once; the notice stays up, click-through
    showCursorNote({ text: 'Sending…', tone: 'progress' }, null)
    void crafty.resignKey(inv.id)
    const captured = selection?.selection?.text.trim() ? selection.selection : null
    try {
      const sessionId = destination?.sessionId ?? (await crafty.createSession(inv.id, sessionOptions())).sessionId
      // Without selected text, Send to carries the recent screenshot
      const shot = captured ? null : await crafty.useRecentScreenshot(inv.id)
      const shots = shot ? [shot] : []
      const { attachments, stored } = await attachScreenshots(sessionId, shots)
      const message = buildCraftyMessage(FORWARD_QUESTION, captured, provenance, shots.length)
      await window.electronAPI.sendMessage(sessionId, message, attachments, stored)
      pieResult({ result: 'send', ok: true, newSession: !destination, screenshot: shots.length > 0, ms: Date.now() - started })
      if (invocationRef.current?.id !== inv.id) return
      showCursorNote({ text: destination ? `Sent to “${sessionTitle(destination)}”` : 'Sent to a new session', tone: 'success' }, NOTE_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pieResult({ result: 'send', ok: false, newSession: !destination, error: message })
      if (invocationRef.current?.id !== inv.id) return
      showCursorNote({ text: `Couldn't send: ${message}`, tone: 'error' }, NOTE_ERROR_MS)
    }
  }, [pieResult, provenance, selection, sessionOptions, showCursorNote])

  const onPieAction = useCallback((action: PieAction, hub: CraftyPoint) => {
    const inv = invocationRef.current
    if (!inv || phaseRef.current !== 'pie') return
    setHubPoint(hub)
    switch (action.kind) {
      case 'ask':
        setInput(action.text)
        setPhase('panel')
        pieResult({ result: 'panel', action: 'ask', typed: action.text.length > 0 })
        return
      case 'question':
        setPhase('panel')
        void send(presetQuestion(action.slot, !!selection?.selection?.text.trim()))
        pieResult({ result: 'panel', action: action.slot })
        return
      case 'screenshot':
        setPhase('capturing')
        void crafty.captureRegion(inv.id).catch(() => null).then(shot => {
          if (invocationRef.current?.id !== inv.id || phaseRef.current !== 'capturing') return
          pieResult({ result: 'panel', action: 'screenshot', captured: !!shot })
          if (!shot) {
            void close('screenshot-cancelled')
            return
          }
          setScreenshots([shot])
          setPhase('panel')
        })
        return
      case 'transform':
        setPhase('preview')
        void runTransform(action.transform, action.title, action.languageCode)
        return
      case 'send':
        void sendCapture(action.session)
        return
      case 'open-craft':
        // As the panel's Open in Craft: out of sight first, then main brings Craft forward
        pieResult({ result: 'open-craft' })
        setPhase('hidden')
        void afterPaint().then(() => {
          reset()
          return crafty.openCraft(inv.id)
        })
        return
      case 'allow-accessibility':
        // As the panel's Open Accessibility settings, without an exit that would log a cancel: out of
        // sight first (the window floats above System Settings)
        pieResult({ result: 'allow-accessibility' })
        setPhase('hidden')
        void afterPaint().then(async () => {
          reset()
          await crafty.hide('open-settings')
          await askForAccessibility()
        })
        return
    }
  }, [close, pieResult, reset, runTransform, selection, send, sendCapture, setPhase])

  const onPieCancel = useCallback((reason: string) => void close(reason), [close])

  // ---- Layout ----
  const placement = useMemo(
    () => (invocation ? placePanel(invocation, selection, hubPoint ?? invocation.cursor) : null),
    [hubPoint, invocation, selection],
  )
  const bounds = selection?.selection?.bounds ?? null
  /** Up, or animating out after being up. */
  const shows = (surface: Phase) => phase === surface || (phase === 'closing' && closingFrom === surface)
  const panelVisible = shows('panel') && !!placement
  const noAccess = invocation?.accessibility === false && !selection?.selection
  // A screenshot can only go along with the first question
  const offerScreenshot = !!recentScreenshot && !session
  // The panel's answer to the prompt on show (one to an earlier prompt doesn't count)
  const shownAnswer = shownPermission && permissionAnswer?.requestId === shownPermission.requestId ? permissionAnswer : null
  const answerSending = !!shownAnswer && !shownAnswer.error

  useLayoutEffect(() => {
    if (invocation && (phase === 'companion' || phase === 'panel')) moveCompanion(invocation.cursor)
  }, [invocation, moveCompanion, phase])

  const showCompanion = phase === 'companion' || phase === 'panel' || (phase === 'hidden' && follow !== 'off')
  const companionState = phase === 'panel' ? 'bloomed' : phase === 'hidden' ? 'idle' : 'active'

  const notePoint = hubPoint ?? invocation?.cursor ?? null

  return (
    <div className="crafty-layer">
      {showCompanion && (
        <div ref={companionRef} className="crafty-companion" data-state={companionState}>
          <div className="crafty-companion-dot bg-accent-solid shadow-elev-2" />
        </div>
      )}

      {shows('pie') && invocation && (
        <CraftyPie
          key={invocation.id}
          invocation={invocation}
          selection={selection}
          provenance={provenance}
          recentScreenshot={recentScreenshot}
          release={triggerRelease}
          closing={phase === 'closing'}
          onAction={onPieAction}
          onCancel={onPieCancel}
        />
      )}

      {shows('preview') && placement && oneShot && (
        <PanelAnchor key={`${invocation?.id}-preview`} x={placement.x} y={placement.y} above={placement.above}>
          <OneShotCard
            oneShot={oneShot}
            editable={editable}
            copied={copied}
            closing={phase === 'closing'}
            frameStyle={frameStyle(placement)}
            onReplace={() => void replaceSelection()}
            onCopy={() => void copyOneShot()}
            onRetry={() => void runTransform(oneShot.transform, oneShot.title, oneShot.languageCode)}
            onClose={() => void close('close-button')}
          />
        </PanelAnchor>
      )}

      {shows('notice') && cursorNote && notePoint && (
        <div className="crafty-notice" data-state={phase === 'closing' ? 'closing' : 'open'} style={{ transform: `translate(${notePoint.x}px, ${notePoint.y}px)` }}>
          <div role="status" className="flex max-w-96 items-center gap-1.5 rounded-full bg-floating py-1.5 pl-2.5 pr-3 text-label shadow-elev-2">
            {cursorNote.tone === 'progress' && <Spinner className="shrink-0 text-secondary" />}
            {cursorNote.tone === 'success' && <Check className="size-4 shrink-0 text-success" />}
            {cursorNote.tone === 'error' && <CircleAlert className="size-4 shrink-0 text-destructive" />}
            <span className="truncate">{cursorNote.text}</span>
          </div>
        </div>
      )}

      {panelVisible && bounds && (
        <div className="crafty-bounds" style={{ transform: `translate(${bounds.x}px, ${bounds.y}px)`, width: bounds.width, height: bounds.height }} />
      )}

      {panelVisible && placement && (
        // Keyed by invocation: a new one starts where the selection is, not where you dragged the last
        <PanelAnchor key={invocation?.id} x={placement.x} y={placement.y} above={placement.above}>
          <div
            className="crafty-panel popover-styled flex flex-col overflow-hidden text-foreground"
            data-state={phase === 'closing' ? 'closing' : 'open'}
            style={frameStyle(placement)}
          >
            {/* Header: what goes along, where it goes. Drag it to move the panel. */}
            <div data-drag-handle className="flex cursor-grab select-none items-center gap-1 py-2 pl-card-pad pr-2 active:cursor-grabbing">
              <div className="flex min-w-0 flex-1 items-center">
                {noAccess ? (
                  <span className="truncate text-label-sm text-tertiary">Can't read the selection</span>
                ) : selection === null ? (
                  <span className="flex min-w-0 items-center gap-2 text-label-sm text-tertiary"><Spinner /> Reading the selection…</span>
                ) : (
                  <ContextChip
                    selection={selection}
                    provenance={provenance}
                    open={detailsOpen}
                    onToggle={() => setDetailsOpen(open => !open)}
                    detailsId={detailsId}
                  />
                )}
              </div>
              {invocation && (
                <CraftyTargetMenu invocationId={invocation.id} target={target} disabled={!!turn?.streaming} onPick={next => void pickTarget(next)} />
              )}
              {openable && (
                <IconButton aria-label="Open in Craft" tooltip size="sm" icon={<ExternalLink />} onClick={() => void openInCraft()} />
              )}
              <IconButton aria-label="Close" size="sm" icon={<X />} onClick={() => void close('close-button')} />
            </div>

            {/* Only when there's something to say: no Accessibility, the opened details, screenshots */}
            {(noAccess || (detailsOpen && selection) || screenshots.length > 0 || offerScreenshot) && (
              <div className="flex flex-col gap-1.5 px-card-pad pb-2">
                {noAccess && invocation ? (
                  <div className="rounded-lg bg-info-tint px-2.5 py-2 text-label-sm">
                    {invocation.packaged
                      ? 'Crafty can\'t read your selection until Craft Agents has Accessibility access.'
                      : 'Crafty can\'t read your selection until the app that started this dev build (your terminal) has Accessibility access.'}
                    <div className="mt-1.5">
                      <Button size="sm" variant="secondary" onClick={() => void openAccessibilitySettings()}>Open Accessibility settings</Button>
                    </div>
                  </div>
                ) : detailsOpen && selection ? (
                  <ContextDetails id={detailsId} selection={selection} provenance={provenance} />
                ) : null}

                {(screenshots.length > 0 || offerScreenshot) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {screenshots.map(shot => (
                      <div key={shot.path} className="flex items-center gap-1.5 rounded-md bg-sunken p-1 pr-2 text-caption text-secondary">
                        {shot.thumbnailDataUrl
                          ? <img src={shot.thumbnailDataUrl} alt="" className="h-7 w-auto max-w-16 rounded-sm object-cover" />
                          : <ImageIcon className="size-4" />}
                        <span className="max-w-32 truncate">{shot.name}</span>
                      </div>
                    ))}
                    {offerScreenshot && recentScreenshot && (
                      <Button variant="secondary" size="sm" onClick={() => void addRecentScreenshot()}>
                        <ImageIcon /> Screenshot from {recentScreenshot.ageSeconds}s ago
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* The answer */}
            {turn && (
              <div className="min-h-0 flex-1 overflow-y-auto border-t border-subtle px-card-pad py-2">
                <div className="mb-1 text-caption text-tertiary">{turn.question}</div>
                {turn.answer ? (
                  <Markdown mode="minimal" className="text-label">{turn.answer}</Markdown>
                ) : turn.streaming ? (
                  <div className="flex items-center gap-2 text-label-sm text-secondary">
                    <Spinner /> {pendingLabel(turn, target ? sessionTitle(target) : null)}
                  </div>
                ) : null}
                {turn.answer && turn.streaming && turn.activity && (
                  <div className="mt-1 flex items-center gap-2 text-caption text-tertiary"><Spinner /> {turn.activity}</div>
                )}
                {shownPermission && (
                  <div className="mt-2 rounded-lg bg-info-tint px-2.5 py-2 text-label-sm">
                    <div className="font-medium">Allow {shownPermission.toolName}?</div>
                    <div className="mt-0.5 text-secondary">{shownPermission.description}</div>
                    {shownPermission.command && (
                      <div className="mt-1 truncate font-mono text-caption text-secondary">{shownPermission.command}</div>
                    )}
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" disabled={answerSending} onClick={() => void respondToPermission(true)}>Allow once</Button>
                      <Button size="sm" variant="ghost" disabled={answerSending} onClick={() => void respondToPermission(false)}>Deny</Button>
                    </div>
                    {shownAnswer?.error && <div role="alert" className="mt-1.5 text-caption text-destructive">{shownAnswer.error}</div>}
                  </div>
                )}
                {turn.error && <div className="mt-2 text-label-sm text-destructive">{turn.error}</div>}
              </div>
            )}

            {turn && !turn.streaming && turn.answer && (
              <div className="flex items-center gap-1 border-t border-subtle px-card-pad py-2">
                <Button size="sm" onClick={() => void insert()}><CornerDownLeft /> Insert at cursor</Button>
                <IconButton
                  aria-label={copied ? 'Copied' : 'Copy'}
                  tooltip
                  size="sm"
                  icon={copied ? <Check className="text-success" /> : <Copy />}
                  onClick={() => void copy()}
                />
              </div>
            )}

            {/* Input */}
            <div className="flex items-end gap-1.5 border-t border-subtle px-card-pad py-2">
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                placeholder={session ? 'Ask a follow-up…' : 'Ask about this…'}
                className="max-h-28 min-h-control flex-1 resize-none rounded-md bg-sunken px-2.5 py-1.5 text-label outline-none placeholder:text-tertiary"
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  // Enter sends; not while an input method composes (dead keys, IME)
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              {modelMenu && <CraftyModelMenu {...modelMenu} />}
              {!session && (
                <IconButton aria-label="Capture a region" icon={<Camera />} onClick={() => void captureRegion()} disabled={!!busy} />
              )}
              <IconButton aria-label="Send" icon={<ArrowUp />} onClick={() => void send()} disabled={!!busy || !!turn?.streaming} />
            </div>
            {(busy || notice) && <div className="px-card-pad pb-2 text-caption text-secondary">{busy ?? notice}</div>}
          </div>
        </PanelAnchor>
      )}
    </div>
  )
}
