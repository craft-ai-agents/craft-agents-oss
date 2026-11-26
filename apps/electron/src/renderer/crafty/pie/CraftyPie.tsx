import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  CraftyInvocation,
  CraftyPoint,
  CraftyProvenance,
  CraftyRecentScreenshot,
  CraftySelectionResult,
  CraftySessionSummary,
} from '../../../shared/crafty'
import { hitTest, layoutRing, layoutSubRing, type Point, type Ring } from './geometry'
import {
  DRAW_DELAY_MS,
  DWELL_MS,
  hubPress,
  pieClick,
  pieKey,
  pieMove,
  pieRelease,
  pieTick,
  startGesture,
  toSticky,
  type PieCancel,
  type PieGesture,
  type PieHow,
  type PieMode,
  type PieOutput,
} from './gesture'
import { translateLanguages, type TranslateLanguage } from './languages'
import { PieView, type PieExit } from './Pie'
import {
  BACK_ITEM,
  captureHub,
  hubClick,
  itemHub,
  mainItems,
  refusedHub,
  rewriteItems,
  sendItems,
  SUB_PIE_MAX,
  translateItems,
  type HubClick,
  type HubText,
  type PieAction,
  type PieCapture,
  type PieItem,
  type PieSub,
} from './slots'

const crafty = window.electronAPI.crafty!

/** The picked slot shows (or flashes) this long before its result takes over. */
const PICK_MS = 140
/** A pick waits this long for the capture, then the slot counts as unavailable. */
const CAPTURE_WAIT_MS = 3000
/**
 * The window takes the keyboard once the selection is read (the ⌘C fallback copies from the app
 * that's key), or after this if the read never reports back. A double-tap's pie also waits for ⌘
 * to come up: a key pressed while it's held is a ⌘ shortcut, which belongs to the app.
 */
const FOCUS_FALLBACK_MS = 1500
/** The hub's notch only needs the direction to a couple of degrees: fewer renders while moving. */
const AIM_STEP = Math.PI / 90

const SUB_TITLES: Record<PieSub, string> = { rewrite: 'Rewrite', translate: 'Translate into', send: 'Send to' }

/** The `pie:pick` metric's slot for a press on the hub: ask, unless the hub did something else. */
const HUB_SLOT: Partial<Record<PieAction['kind'], string>> = { 'open-craft': 'craft', 'allow-accessibility': 'allow-accessibility' }

/** A sub-pie, or the main pie (`sub` null). */
interface Level {
  sub: PieSub | null
  ring: Ring
  /** For a sub-pie: the main pie's ring and the slot that opened it, to go back to. */
  parent: { ring: Ring; index: number } | null
}

interface View {
  mode: PieMode
  active: number | null
  aim: number | null
}

export interface PieRelease {
  heldMs: number
  interrupted: boolean
}

export interface CraftyPieProps {
  invocation: CraftyInvocation
  /** Where Crafty sends: the panel's, which a remote target's check updates after the invocation. */
  target: CraftySessionSummary | null
  selection: CraftySelectionResult | null
  provenance: CraftyProvenance | null
  recentScreenshot: CraftyRecentScreenshot | null
  /** The double-tap's release (main's `trigger-release`), once it came. ⌃⌥Space's shows in the DOM. */
  release: PieRelease | null
  /** The window is closing (the trigger again, Esc): animate out. */
  closing: boolean
  /** A pick to carry out; `hub` is where the pie was, for what grows out of it. */
  onAction: (action: PieAction, hub: CraftyPoint) => void
  onCancel: (reason: PieCancel) => void
}

/** Where Send to goes: the target, and the workspace a new session would be in. */
interface SendDestinations {
  target: CraftySessionSummary | null
  workspaceLabel: string | null
}

function itemsFor(sub: PieSub | null, capture: PieCapture, send: SendDestinations, languages: TranslateLanguage[]): PieItem[] {
  switch (sub) {
    case null:
      return mainItems(capture)
    case 'rewrite':
      return [...rewriteItems(), BACK_ITEM]
    case 'translate':
      return [...translateItems(languages), BACK_ITEM]
    case 'send':
      return [...sendItems(send.target, capture.sessions ?? [], send.workspaceLabel), BACK_ITEM]
  }
}

const quantize = (aim: number | null) => (aim === null ? null : Math.round(aim / AIM_STEP) * AIM_STEP)

/**
 * The pie around the pointer: what the trigger opens (Settings → Crafty → Opens). The gesture's
 * rules are in `gesture.ts` and the slots in `slots.ts`; this wires them to the window's pointer,
 * keys and the trigger's release. While it's open the whole window takes the mouse, so every click
 * lands here: a click outside closes the pie without reaching the app (the selection stays).
 */
export function CraftyPie({ invocation, target, selection, provenance, recentScreenshot, release, closing, onAction, onCancel }: CraftyPieProps) {
  const listboxId = useId()
  const optionId = useCallback((index: number) => `${listboxId}-option-${index}`, [listboxId])
  const stage = invocation.windowSize
  const mainRing = useMemo(() => layoutRing(invocation.cursor, stage, 8), [invocation.cursor, stage])

  const [level, setLevel] = useState<Level>({ sub: null, ring: mainRing, parent: null })
  const [view, setView] = useState<View>({ mode: 'held', active: null, aim: null })
  const [drawn, setDrawn] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  /** A slot picked while the capture was still coming: it runs once that's known. */
  const [waiting, setWaiting] = useState<{ index: number; how: PieHow; at: Point } | null>(null)
  /** The last pick that couldn't run, and why: the hub says so until another slot is aimed at. */
  const [refused, setRefused] = useState<{ index: number; reason: string } | null>(null)
  const [sessions, setSessions] = useState<CraftySessionSummary[] | null>(null)
  /** Whether the trigger's keys are up (⌃⌥Space's release isn't always seen: it doesn't wait). */
  const [keysUp, setKeysUp] = useState(invocation.trigger !== 'double-tap')

  // The direction reads from where the trigger was pressed (a pie moved in from an edge moves it
  // to the hub once the pointer is there: `warpToHub`)
  const gestureRef = useRef<PieGesture>(startGesture(mainRing, invocation.cursor))
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const openedAtRef = useRef(performance.now())
  const dwellRef = useRef<{ timer: number; due: number } | null>(null)
  const focusedRef = useRef(false)
  const doneRef = useRef(false)

  const capture = useMemo<PieCapture>(() => ({
    selection,
    provenance,
    accessibility: invocation.accessibility,
    recentScreenshot: !!recentScreenshot,
    sessions,
  }), [invocation.accessibility, provenance, recentScreenshot, selection, sessions])
  const languages = useMemo(() => translateLanguages(invocation.languages, SUB_PIE_MAX), [invocation.languages])
  const send = useMemo<SendDestinations>(() => ({ target, workspaceLabel: invocation.workspaceLabel }), [invocation.workspaceLabel, target])
  const items = useMemo(() => itemsFor(level.sub, capture, send, languages), [capture, languages, level.sub, send])

  // The handlers below run from window listeners: they read the current state through refs
  const latest = useRef({ items, level, capture, languages, drawn, waiting, onAction, onCancel })
  latest.current = { items, level, capture, languages, drawn, waiting, onAction, onCancel }
  /** What a click on the hub does other than ask (set with the hub below), e.g. the Craft mark's. */
  const hubClickRef = useRef<HubClick | null>(null)

  const metric = useCallback((kind: string, fields: Record<string, unknown>) => {
    void crafty.metric({ kind, invocationId: invocation.id, ...fields })
  }, [invocation.id])

  const apply = useCallback((gesture: PieGesture) => {
    gestureRef.current = gesture
    const aim = quantize(gesture.aim)
    setView(current => (current.mode === gesture.mode && current.active === gesture.active && current.aim === aim
      ? current
      : { mode: gesture.mode, active: gesture.active, aim }))
    if (gesture.mode === 'sticky') setDrawn(true)
  }, [])

  /**
   * A held pie moved in from an edge: take the pointer to its hub, so every direction has room to
   * flick. Directions read from the hub only once the pointer is there; until then (or if the warp
   * fails) from where it was, and the slots past the edge take a click or a key.
   */
  const warpToHub = useCallback((ring: Ring) => {
    void crafty.warp(invocation.id, ring.center).then(ok => {
      const g = gestureRef.current
      if (!ok || g.ring !== ring || g.mode !== 'held' || doneRef.current) return
      const keyed = g.activeBy === 'key'
      apply({ ...g, origin: ring.center, pointer: ring.center, active: keyed ? g.active : null, activeBy: keyed ? 'key' : null, aim: null, rest: null })
    })
  }, [apply, invocation.id])

  const slotPoint = useCallback((index: number): Point => {
    const { ring } = latest.current.level
    const slot = ring.slots[index]
    return slot ? { x: ring.center.x + slot.x, y: ring.center.y + slot.y } : ring.center
  }, [])

  // ---- Running a pick ----

  const run = useCallback((action: PieAction, index: number | null, how: PieHow | 'typing') => {
    if (doneRef.current) return
    doneRef.current = true
    const { level: current, drawn: wasDrawn } = latest.current
    const hub = current.ring.center
    metric('pie:pick', {
      slot: index === null ? HUB_SLOT[action.kind] ?? 'ask' : latest.current.items[index]?.id,
      sub: current.sub,
      how,
      ms: Math.round(performance.now() - openedAtRef.current),
      drawn: wasDrawn,
      mode: gestureRef.current.mode,
    })
    // Typed text goes on at once: the panel's input takes the next keys
    if (how === 'typing' || index === null) {
      latest.current.onAction(action, hub)
      return
    }
    setPicked(index)
    window.setTimeout(() => latest.current.onAction(action, hub), PICK_MS)
  }, [metric])

  const refuse = useCallback((index: number, reason: string) => {
    setRefused({ index, reason })
    apply({ ...toSticky(gestureRef.current), active: index, activeBy: 'key' })
    metric('pie:pick', { slot: latest.current.items[index]?.id, sub: latest.current.level.sub, refused: reason })
  }, [apply, metric])

  const openSub = useCallback((sub: PieSub, index: number, at: Point, held: boolean, how: PieHow | 'dwell') => {
    const { level: current, capture: c, languages: langs } = latest.current
    const parent = current.parent ?? { ring: current.ring, index }
    const count = itemsFor(sub, c, send, langs).length
    const ring = layoutSubRing(at, stage, count, parent.ring.center)
    setLevel({ sub, ring, parent: { ring: parent.ring, index } })
    setRefused(null)
    setDrawn(true)
    apply(held ? { ...startGesture(ring, at, 'held'), pointer: at } : { ...startGesture(ring, ring.center, 'sticky'), pointer: at })
    if (held && ring.shifted) warpToHub(ring)
    metric('pie:sub', { sub, how, shifted: ring.shifted })
  }, [apply, metric, send, stage, warpToHub])

  const goBack = useCallback(() => {
    const { parent } = latest.current.level
    if (!parent) return
    setLevel({ sub: null, ring: parent.ring, parent: null })
    setRefused(null)
    // The slot you came from stays highlighted until the pointer points elsewhere
    apply({ ...startGesture(parent.ring, parent.ring.center, 'sticky'), pointer: gestureRef.current.pointer, active: parent.index, activeBy: 'key' })
  }, [apply])

  const pick = useCallback((index: number, how: PieHow, at: Point) => {
    const item = latest.current.items[index]
    if (!item || doneRef.current) return
    setWaiting(null)
    if (item.back) {
      goBack()
      return
    }
    const { availability } = item
    if (availability.state === 'off') {
      refuse(index, availability.reason)
      return
    }
    if (availability.state === 'pending') {
      // Runs once the capture is known (the effect below); the pie stays open meanwhile
      setWaiting({ index, how, at })
      apply({ ...toSticky(gestureRef.current), active: index, activeBy: 'key' })
      return
    }
    if (item.sub) {
      openSub(item.sub, index, how === 'key' ? slotPoint(index) : at, false, how)
      return
    }
    if (item.action) run(item.action, index, how)
  }, [apply, goBack, openSub, refuse, run, slotPoint])

  const handle = useCallback((output: PieOutput | null, at: Point) => {
    if (!output || doneRef.current) return
    switch (output.type) {
      case 'cancel':
        doneRef.current = true
        latest.current.onCancel(output.reason)
        return
      case 'hub': {
        const press = hubPress({ inSub: latest.current.level.sub !== null, how: output.how, click: hubClickRef.current })
        if (press === 'back') goBack()
        else run(press === 'ask' ? { kind: 'ask', text: '' } : { kind: press }, null, output.how)
        return
      }
      case 'back':
        goBack()
        return
      case 'pick':
        pick(output.index, output.how, at)
        return
      case 'dwell': {
        const item = latest.current.items[output.index]
        if (item?.sub && item.availability.state === 'ready') openSub(item.sub, output.index, at, true, 'dwell')
        return
      }
    }
  }, [goBack, openSub, pick, run])

  /** The trigger let go: run what's aimed at, else stay open. Reads the pointer from main first. */
  const releaseTrigger = useCallback(async (interrupted: boolean, known: Point | null) => {
    if (gestureRef.current.mode !== 'held' || doneRef.current) return
    // A fast flick can beat the window's first pointermove; main knows where the pointer is
    const p = known ?? await crafty.cursor().catch(() => null)
    let g = gestureRef.current
    if (g.mode !== 'held' || doneRef.current) return
    if (p) g = pieMove(g, p, performance.now())
    const step = pieRelease(g, interrupted)
    apply(step.gesture)
    handle(step.output, g.pointer ?? g.origin)
  }, [apply, handle])

  // ---- Lifecycle: interactive at once, key once the selection is read, warp, timers ----

  useEffect(() => {
    void crafty.setInteractive(true)
    inputRef.current?.focus()
    metric('pie:open', { trigger: invocation.trigger, shifted: mainRing.shifted, msSinceInvoke: Date.now() - invocation.at })
    if (mainRing.shifted) warpToHub(mainRing)
    // Once per pie: the invocation and its ring don't change while it's open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusWindow = useCallback(() => {
    // A pick that's running takes the keyboard itself (the panel), or leaves it with the app (Send to)
    if (focusedRef.current || doneRef.current) return
    focusedRef.current = true
    void crafty.focusPanel(invocation.id).then(() => inputRef.current?.focus())
  }, [invocation.id])
  useEffect(() => {
    if (keysUp && selection !== null) focusWindow()
  }, [focusWindow, keysUp, selection])
  useEffect(() => {
    if (!keysUp) return
    const timer = window.setTimeout(focusWindow, FOCUS_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [focusWindow, keysUp])

  useEffect(() => {
    let cancelled = false
    crafty.listSessions(invocation.id).then(
      list => { if (!cancelled) setSessions(list) },
      () => { if (!cancelled) setSessions([]) },
    )
    return () => { cancelled = true }
  }, [invocation.id])

  useEffect(() => {
    const timer = window.setTimeout(() => setDrawn(true), DRAW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // The double-tap's release (it can come before the pie's first render)
  useEffect(() => {
    if (!release) return
    // After the release is handled: a pick it ran takes the keyboard itself (or leaves it with the app)
    void releaseTrigger(release.interrupted, null).then(() => {
      if (!release.interrupted) setKeysUp(true)
    })
  }, [release, releaseTrigger])

  // A pick that waited for the capture: run it, or say why it can't
  useEffect(() => {
    if (!waiting) return
    const availability = items[waiting.index]?.availability
    if (availability?.state === 'pending') {
      const timer = window.setTimeout(() => {
        setWaiting(null)
        refuse(waiting.index, availability.late)
      }, CAPTURE_WAIT_MS)
      return () => window.clearTimeout(timer)
    }
    pick(waiting.index, waiting.how, waiting.at)
    return undefined
  }, [items, pick, refuse, waiting])

  // ---- Pointer and keys (the whole window takes them while the pie is open) ----

  const listening = !closing && picked === null
  useEffect(() => {
    if (!listening) return
    const hasSub = (index: number) => {
      const item = latest.current.items[index]
      return !!item?.sub && item.availability.state === 'ready'
    }
    const clearDwell = () => {
      if (dwellRef.current) window.clearTimeout(dwellRef.current.timer)
      dwellRef.current = null
    }
    /** Due when the rest on a ▸ slot began plus the dwell; a jitter inside the slop keeps the rest. */
    const scheduleDwell = () => {
      const g = gestureRef.current
      const due = g.mode === 'held' && g.active !== null && g.rest && hasSub(g.active) ? g.rest.since + DWELL_MS : null
      if (due === (dwellRef.current?.due ?? null)) return
      clearDwell()
      if (due === null) return
      const timer = window.setTimeout(() => {
        dwellRef.current = null
        const current = gestureRef.current
        handle(pieTick(current, performance.now(), hasSub), current.pointer ?? current.origin)
      }, Math.max(0, due - performance.now()) + 5)
      dwellRef.current = { timer, due }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (latest.current.waiting) return
      // ⌃⌥Space let go while the app had the keys (its keyup went there), which this move shows.
      // The keys went up before the move: read the pick from where the pointer was, so a move
      // toward a slot to click it after a tap doesn't pick it.
      const g = gestureRef.current
      if (invocation.trigger === 'shortcut' && g.mode === 'held' && (!e.ctrlKey || !e.altKey)) {
        clearDwell()
        void releaseTrigger(false, g.pointer ?? g.origin)
        return
      }
      const p = { x: e.clientX, y: e.clientY }
      apply(pieMove(g, p, e.timeStamp))
      scheduleDwell()
      // A hub with a click of its own (the Craft mark, "Click to allow Accessibility") is a button
      const overButton = hubClickRef.current !== null && hitTest(latest.current.level.ring, p).kind === 'hub'
      document.documentElement.style.cursor = overButton ? 'pointer' : ''
    }
    const onPointerDown = (e: PointerEvent) => {
      // Every click lands on the window while the pie is open; none reaches the app underneath
      e.preventDefault()
      if (e.button !== 0) return
      const p = { x: e.clientX, y: e.clientY }
      const step = pieClick(gestureRef.current, p)
      apply(step.gesture)
      handle(step.output, p)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // An input method composing (dead keys, IME) owns the keys
      if (e.isComposing) return
      const step = pieKey(gestureRef.current, e.key, e.code, e.shiftKey)
      if (!step) {
        // ⌘V or ⌃A would paste or select in the hidden input: only plain typing asks
        if (e.metaKey || e.ctrlKey) e.preventDefault()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      apply(step.gesture)
      const g = step.gesture
      handle(step.output, g.active !== null ? slotPoint(g.active) : latest.current.level.ring.center)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (invocation.trigger === 'shortcut' && (e.key === 'Control' || e.key === 'Alt')) void releaseTrigger(false, null)
    }
    const onContextMenu = (e: MouseEvent) => e.preventDefault()
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      clearDwell()
      document.documentElement.style.cursor = ''
    }
  }, [apply, handle, invocation.trigger, listening, releaseTrigger, slotPoint])

  /** Typing asks: the text goes to the panel's input. */
  const typed = useCallback((input: HTMLTextAreaElement, composing: boolean) => {
    if (composing) return
    const text = input.value
    if (!text.trim()) {
      input.value = ''
      return
    }
    run({ kind: 'ask', text }, null, 'typing')
  }, [run])

  // ---- What the hub says ----

  const hub = useMemo<HubText>(() => {
    if (waiting && items[waiting.index]) return itemHub(items[waiting.index])
    if (refused && items[refused.index] && (view.active === null || view.active === refused.index)) {
      return refusedHub(items[refused.index], refused.reason)
    }
    if (view.active !== null && items[view.active]) return itemHub(items[view.active])
    if (level.sub) return { primary: SUB_TITLES[level.sub], secondary: null }
    return captureHub(capture)
  }, [capture, items, level.sub, refused, view.active, waiting])
  hubClickRef.current = hubClick(hub)

  const exit: PieExit | null = closing ? { kind: 'cancel' } : picked !== null ? { kind: 'pick', index: picked } : null

  return (
    <>
      <PieView
        ring={level.ring}
        items={items}
        active={picked ?? view.active}
        aim={view.aim}
        drawn={drawn}
        hub={hub}
        exit={exit}
        listboxId={listboxId}
        optionId={optionId}
      />
      <textarea
        ref={inputRef}
        className="crafty-pie-input"
        style={{ transform: `translate(${level.ring.center.x}px, ${level.ring.center.y}px)` }}
        role="combobox"
        aria-label="Type a question, or pick an action"
        aria-expanded
        aria-controls={listboxId}
        aria-activedescendant={view.active !== null && drawn ? optionId(view.active) : undefined}
        rows={1}
        defaultValue=""
        onChange={e => typed(e.currentTarget, (e.nativeEvent as InputEvent).isComposing)}
        onCompositionEnd={e => typed(e.currentTarget, false)}
      />
    </>
  )
}
