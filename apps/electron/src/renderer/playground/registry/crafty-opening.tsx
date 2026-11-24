/**
 * Playground: ways for the Crafty panel to open out of the pointer. Design examples only; the
 * Crafty window still runs "Today" (renderer/crafty/crafty.css).
 *
 * Every opening starts the way Crafty's panel does: the trigger pops the companion dot at the
 * pointer, and the panel opens when the selection arrives (SELECTION_S here; CraftyApp waits up to
 * 350 ms). Motion follows the repo's rules: transform and opacity (plus a clip-path for Reveal),
 * the named springs and tweens, and only the content-less material is ever scaled.
 */

import * as React from 'react'
import { RotateCcw } from 'lucide-react'
import { animate, motion, useMotionValue, useTransform, type MotionValue, type Transition } from 'motion/react'
import { DURATION, EASE, SPRING, TWEEN, prefersReducedMotion } from '@craft-agent/ui/motion'
import { Button } from '@/components/ui/button'
import { CraftyGlow } from '@/components/crafty/CraftyGlow'
import type { ComponentEntry } from './types'
import {
  CraftyStage,
  DOT_SIZE,
  PANEL_WIDTH,
  SPEED_OPTIONS,
  SimulatedPointer,
  panelRows,
  placePanel,
  schedule,
  slowed,
  useStageGeometry,
  type DemoTurn,
  type PanelPlacement,
  type PanelRow,
  type Point,
  type StageGeometry,
} from './crafty-stage'

export type OpeningStyle = 'today' | 'morph' | 'fly' | 'reveal' | 'fade'

/** The selection arrives about this long after the trigger; the panel opens then. */
const SELECTION_S = 0.08
/** Fly: the dot's trip from the pointer to the panel's corner. */
const FLY_S = 0.13
/** Morph: the height follows the width this much later, so the dot stretches into a pill first. */
const PILL_S = 0.05
/** Rows rising in one after another. */
const STAGGER_S = 0.035
/** Fly: where the dot lands, on the header's context label (panel coordinates). */
const LANDING: Point = { x: 23, y: 20 }

const ms = (seconds: number, k: number) => seconds * 1000 * k

export interface OpeningPanelProps {
  opening: OpeningStyle
  geometry: StageGeometry
  /** Where Crafty was summoned, in stage coordinates. */
  pointer: Point
  /** Slow motion: 1 is real time, 4 a quarter of the speed. */
  k: number
  stagger: boolean
  glow: boolean
  closing: boolean
  /** The exit has finished: unmount the panel. */
  onClosed: () => void
  /** The panel's close button. */
  onClose: () => void
  turn?: DemoTurn | null
  /**
   * The dot is already on screen and Crafty already has the selection (the circular menu hands
   * over): open right away, growing out of the dot at its full size.
   */
  handoff?: boolean
}

interface OpeningProps extends Omit<OpeningPanelProps, 'geometry' | 'pointer' | 'opening' | 'onClose' | 'turn' | 'handoff'> {
  rows: PanelRow[]
  /** The pointer in the panel's coordinates: every opening grows out of it. */
  origin: Point
  /** The panel's height when it opened. */
  height: number
  /** When the panel starts to open: once the selection arrives, or at once on a handoff. */
  startAt: number
  /** The material's first size (Morph and Fly): a dot about to pop, or the dot itself on a handoff. */
  startSize: number
}

type Step = [number, () => void]

/**
 * The panel, placed like CraftyApp places it and opened the chosen way. It renders once unseen to
 * measure its height (both passes run before the first paint), and stays where it opened while
 * an answer grows it.
 */
export function OpeningPanel({ opening: requested, geometry, pointer, turn, onClose, handoff = false, ...rest }: OpeningPanelProps) {
  const measureRef = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState<{ height: number; placement: PanelPlacement } | null>(null)
  const rows = panelRows({ turn, onClose })

  React.useLayoutEffect(() => {
    const height = measureRef.current?.offsetHeight ?? 0
    setBox(current => current ?? { height, placement: placePanel(geometry, pointer, height) })
  }, [geometry, pointer])

  // One object per summon: the openings restart their choreography when it changes
  const origin = React.useMemo(() => {
    if (!box) return null
    const top = box.placement.above ? box.placement.y - box.height : box.placement.y
    return { x: pointer.x - box.placement.x, y: pointer.y - top }
  }, [box, pointer])

  if (!box || !origin) {
    return (
      <div ref={measureRef} aria-hidden className="invisible absolute left-0 top-0 flex flex-col" style={{ width: PANEL_WIDTH }}>
        {rows.map(row => <div key={row.key}>{row.node}</div>)}
      </div>
    )
  }

  const opening = prefersReducedMotion() ? 'fade' : requested
  const { placement, height } = box
  const props: OpeningProps = { ...rest, rows, height, origin, startAt: handoff ? 0 : SELECTION_S, startSize: handoff ? DOT_SIZE : 6 }

  return (
    <div
      data-crafty-panel
      className="pointer-events-auto absolute"
      style={{ left: placement.x, top: placement.y, width: PANEL_WIDTH, transform: placement.above ? 'translateY(-100%)' : undefined }}
    >
      {opening === 'reveal' ? <RevealOpening {...props} />
        : opening === 'morph' || opening === 'fly' ? <MorphOpening {...props} fly={opening === 'fly'} />
        : <ScaleOpening {...props} today={opening === 'today'} />}
    </div>
  )
}

/** The panel's rows; with `enter`, they fade (and with `stagger` rise) in after `delay`. */
function Rows({ rows, k, delay, stagger, closing, enter }: {
  rows: PanelRow[]
  k: number
  delay: number
  stagger: boolean
  closing: boolean
  enter: boolean
}) {
  return (
    <>
      {rows.map((row, index) => {
        if (!enter) return <div key={row.key}>{row.node}</div>
        const at = delay + (stagger ? index * STAGGER_S : 0)
        return (
          <motion.div
            key={row.key}
            initial={{ opacity: 0, y: stagger ? 6 : 0 }}
            animate={{ opacity: closing ? 0 : 1, y: 0 }}
            transition={closing ? slowed(TWEEN.exit, k) : { opacity: slowed(TWEEN.fast, k, at), y: slowed(SPRING.base, k, at) }}
          >
            {row.node}
          </motion.div>
        )
      })}
    </>
  )
}

/** The companion dot (crafty.css): pops in at the pointer, fades as the panel takes over. */
function CompanionDot({ at, k, gone }: { at: Point; k: number; gone: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute size-[18px] rounded-full bg-accent-solid shadow-elev-2"
      style={{ left: at.x - DOT_SIZE / 2, top: at.y - DOT_SIZE / 2 }}
      initial={{ opacity: 0, scale: 0.2 }}
      animate={{ opacity: gone ? 0 : 1, scale: 1 }}
      transition={{
        scale: slowed(SPRING.snap, k),
        opacity: gone ? slowed({ type: 'tween', duration: DURATION.micro, ease: EASE.out }, k) : slowed(SPRING.snap, k),
      }}
    />
  )
}

/**
 * Today (crafty.css, as built): the panel scales up from 40% around the pointer on the snap
 * spring, and wilts to 94% on the exit tween. Fade: opacity only, what reduced motion gets.
 */
function ScaleOpening({ rows, origin, k, glow, closing, onClosed, startAt, today }: OpeningProps & { today: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [glowKey, setGlowKey] = React.useState(0)

  React.useEffect(() => {
    if (closing) return schedule([[ms(DURATION.exit, k) + 20, onClosed]])
    const steps: Step[] = [[ms(startAt, k), () => setOpen(true)]]
    if (glow) steps.push([ms(startAt + 0.25, k), () => setGlowKey(1)])
    return schedule(steps)
  }, [closing, glow, k, onClosed, startAt])

  const from = { opacity: 0, scale: today ? 0.4 : 1 }
  return (
    <>
      {today && <CompanionDot at={origin} k={k} gone={open || closing} />}
      <motion.div
        className="popover-styled relative flex flex-col overflow-hidden text-foreground"
        style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
        initial={from}
        animate={closing ? { opacity: 0, scale: today ? 0.94 : 1 } : open ? { opacity: 1, scale: 1 } : from}
        transition={closing ? slowed(TWEEN.exit, k) : slowed(today ? SPRING.snap : TWEEN.fast, k)}
      >
        <Rows rows={rows} k={k} delay={0} stagger={false} closing={closing} enter={false} />
        <CraftyGlow playKey={glowKey} />
      </motion.div>
    </>
  )
}

/** A ring that leaves the dot as the panel starts to open. */
function Ripple({ at, k, delay }: { at: Point; k: number; delay: number }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute overflow-visible" style={{ left: at.x, top: at.y }} width={1} height={1}>
      <motion.circle
        cx={0}
        cy={0}
        fill="none"
        className="stroke-accent"
        strokeWidth={1.5}
        initial={{ r: DOT_SIZE / 2, opacity: 0.7 }}
        animate={{ r: 56, opacity: 0 }}
        transition={slowed({ type: 'tween', duration: 0.5, ease: EASE.out }, k, delay)}
      />
    </svg>
  )
}

/**
 * Reveal: the panel is already in place, and a circle centered on the pointer uncovers it (like a
 * lens opening). Nothing scales, so the text is sharp from the first frame. A box-shadow can't
 * follow a clip-path, so the elevation is its own layer, faded in behind.
 */
function RevealOpening({ rows, origin, height, k, stagger, glow, closing, onClosed, startAt }: OpeningProps) {
  const [dotGone, setDotGone] = React.useState(false)
  const [glowKey, setGlowKey] = React.useState(0)

  React.useEffect(() => {
    if (closing) return schedule([[ms(0.16, k), onClosed]])
    const steps: Step[] = [[ms(startAt + 0.06, k), () => setDotGone(true)]]
    if (glow) steps.push([ms(startAt + 0.35, k), () => setGlowKey(1)])
    return schedule(steps)
  }, [closing, glow, k, onClosed, startAt])

  const corners: Point[] = [{ x: 0, y: 0 }, { x: PANEL_WIDTH, y: 0 }, { x: 0, y: height }, { x: PANEL_WIDTH, y: height }]
  const far = Math.max(...corners.map(c => Math.hypot(c.x - origin.x, c.y - origin.y))) + 2
  const circle = (r: number) => `circle(${r}px at ${origin.x}px ${origin.y}px)`

  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-lg shadow-elev-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={closing ? slowed(TWEEN.exit, k) : slowed(TWEEN.base, k, startAt + 0.1)}
      />
      <motion.div
        className="relative flex flex-col overflow-hidden rounded-lg bg-floating text-foreground"
        initial={{ clipPath: circle(DOT_SIZE / 2) }}
        animate={{ clipPath: circle(closing ? 0 : far) }}
        transition={closing
          ? slowed({ type: 'tween', duration: 0.14, ease: EASE.exit }, k)
          : slowed({ type: 'tween', duration: DURATION.slow, ease: EASE.out }, k, startAt)}
      >
        <Rows rows={rows} k={k} delay={startAt + 0.04} stagger={stagger} closing={closing} enter={stagger} />
        <CraftyGlow playKey={glowKey} />
      </motion.div>
      {!closing && <Ripple at={origin} k={k} delay={startAt} />}
      <CompanionDot at={origin} k={k} gone={dotGone || closing} />
    </>
  )
}

/** The material's edges, in panel coordinates. */
interface Edges {
  left: number
  right: number
  top: number
  bottom: number
}

const dotEdges = (c: Point, size: number): Edges => ({ left: c.x - size / 2, right: c.x + size / 2, top: c.y - size / 2, bottom: c.y + size / 2 })
/** On screen the corners stay round: a dot, then a pill, then the panel's 12px. */
const cornerOf = (width: number, height: number) => Math.max(0, Math.min(12, width / 2, height / 2))

/**
 * Morph: the dot is the panel's material. It stretches into a pill along the panel's edge nearer
 * the pointer (the base spring), turns from the accent into the floating surface, and the panel
 * unrolls from there (the panel spring, a beat later). The content fades up inside it: clipped to
 * the material, so no text ever shows outside the panel. Fly: the dot first jumps from the pointer
 * to the panel's corner (x and y on different springs, so it travels on a curve), then unfolds
 * from there. Both fold back into the pointer when they close.
 *
 * The four edges are the animated values. The material is drawn from them with translate and
 * scale only (FLIP from the top-left corner), its radius counter-scaled; the content's clip-path
 * is the same rectangle.
 */
function MorphOpening({ rows, origin, height, k, stagger, glow, closing, onClosed, startAt, startSize, fly }: OpeningProps & { fly: boolean }) {
  const left = useMotionValue(0)
  const right = useMotionValue(PANEL_WIDTH)
  const top = useMotionValue(0)
  const bottom = useMotionValue(height)
  const accent = useMotionValue(0)
  const fade = useMotionValue(1)
  const [glowKey, setGlowKey] = React.useState(0)

  const scaleX = useTransform([left, right], ([l, r]: number[]) => Math.max(r - l, 0.01) / PANEL_WIDTH)
  const scaleY = useTransform([top, bottom], ([t, b]: number[]) => Math.max(b - t, 0.01) / height)
  const borderRadius = useTransform([left, right, top, bottom], ([l, r, t, b]: number[]) => {
    const w = Math.max(r - l, 0.01)
    const h = Math.max(b - t, 0.01)
    const corner = cornerOf(w, h)
    return `${(corner * PANEL_WIDTH) / w}px / ${(corner * height) / h}px`
  })
  const clipPath = useTransform([left, right, top, bottom], ([l, r, t, b]: number[]) =>
    `inset(${t}px ${PANEL_WIDTH - r}px ${height - b}px ${l}px round ${cornerOf(r - l, b - t)}px)`)

  React.useLayoutEffect(() => {
    const controls: Array<{ stop: () => void }> = []
    const go = (value: MotionValue<number>, to: number, t: Transition) => controls.push(animate(value, to, slowed(t, k)))
    const goTo = (edges: Edges, horizontal: Transition, vertical: Transition) => {
      go(left, edges.left, horizontal)
      go(right, edges.right, horizontal)
      go(top, edges.top, vertical)
      go(bottom, edges.bottom, vertical)
    }
    // Unroll from the edge nearer the pointer: down when the panel opens below it, up when above
    const fromTop = origin.y < height / 2
    let cancel: () => void

    if (closing) {
      // Back into the pointer; the content fades as the material folds, then the dot goes
      goTo(dotEdges(origin, DOT_SIZE), SPRING.snap, SPRING.snap)
      go(accent, 1, TWEEN.micro)
      cancel = schedule([
        [ms(0.09, k), () => go(fade, 0, TWEEN.exit)],
        [ms(0.2, k), onClosed],
      ])
    } else {
      // A small dot at the pointer pops to the companion's size (motion springs keep their
      // velocity when the next phase takes over, so the phases blend)
      const start = dotEdges(origin, startSize)
      left.set(start.left)
      right.set(start.right)
      top.set(start.top)
      bottom.set(start.bottom)
      accent.set(1)
      fade.set(1)
      goTo(dotEdges(origin, DOT_SIZE), SPRING.snap, SPRING.snap)
      const unfoldAt = fly ? startAt + FLY_S : startAt
      const steps: Step[] = []
      if (fly) steps.push([ms(startAt, k), () => goTo(dotEdges(LANDING, DOT_SIZE), SPRING.base, SPRING.panel)])
      steps.push([ms(unfoldAt, k), () => {
        // Off the selected line quickly (snap), wider at the base spring's pace
        goTo(fromTop
          ? { left: 0, right: PANEL_WIDTH, top: 0, bottom: DOT_SIZE }
          : { left: 0, right: PANEL_WIDTH, top: height - DOT_SIZE, bottom: height }, SPRING.base, SPRING.snap)
        go(accent, 0, TWEEN.fast)
      }])
      steps.push([ms(unfoldAt + PILL_S, k), () => (fromTop ? go(bottom, height, SPRING.panel) : go(top, 0, SPRING.panel))])
      if (glow) steps.push([ms(unfoldAt + 0.32, k), () => setGlowKey(1)])
      cancel = schedule(steps)
    }
    return () => {
      cancel()
      controls.forEach(control => control.stop())
    }
  }, [closing, accent, bottom, fade, fly, glow, height, k, left, onClosed, origin, right, startAt, startSize, top])

  return (
    <motion.div className="relative" style={{ opacity: fade }}>
      <motion.div
        aria-hidden
        className="absolute inset-0 overflow-hidden shadow-elev-2"
        style={{ originX: 0, originY: 0, x: left, y: top, scaleX, scaleY, borderRadius }}
      >
        <div className="absolute inset-0 bg-floating" />
        <motion.div className="absolute inset-0 bg-accent-solid" style={{ opacity: accent }} />
      </motion.div>
      <motion.div className="relative flex flex-col text-foreground" style={{ clipPath }}>
        <Rows rows={rows} k={k} delay={(fly ? startAt + FLY_S : startAt) + 0.06} stagger={stagger} closing={closing} enter />
      </motion.div>
      <CraftyGlow playKey={glowKey} />
    </motion.div>
  )
}

// ---------------------------------------------------------------------------------------------
// The demo
// ---------------------------------------------------------------------------------------------

interface Summon {
  key: number
  pointer: Point
  /** A replay: the real pointer isn't there, so the demo draws one. */
  simulated: boolean
  closing: boolean
}

interface CraftyOpeningDemoProps {
  opening?: OpeningStyle
  stagger?: boolean
  glow?: boolean
  speed?: string
}

function CraftyOpeningDemo({ opening = 'morph', stagger = true, glow = false, speed = '1' }: CraftyOpeningDemoProps) {
  const { stageRef, selectionRef, geometry, toStage } = useStageGeometry()
  const [summon, setSummon] = React.useState<Summon | null>(null)
  const k = Number(speed) || 1
  const keyRef = React.useRef(0)
  const geometryRef = React.useRef(geometry)

  const open = React.useCallback((pointer: Point, simulated: boolean) => {
    keyRef.current += 1
    setSummon({ key: keyRef.current, pointer, simulated, closing: false })
  }, [])
  const close = React.useCallback(() => setSummon(current => (current && !current.closing ? { ...current, closing: true } : current)), [])
  const onClosed = React.useCallback(() => setSummon(current => (current?.closing ? null : current)), [])
  const replay = React.useCallback(() => {
    const g = geometryRef.current
    if (g) open(g.selection.end, true)
  }, [open])

  React.useEffect(() => {
    geometryRef.current = geometry
  }, [geometry])

  // Play once the stage is measured, and again whenever a control changes
  const ready = geometry !== null
  React.useEffect(() => {
    if (ready) replay()
  }, [ready, opening, stagger, glow, speed, replay])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-crafty-panel]')) return
    if (summon && !summon.closing) close()
    else open(toStage(event), false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') close()
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      replay()
    }
  }

  return (
    <div className="flex max-w-full flex-col items-start gap-3">
      <CraftyStage stageRef={stageRef} selectionRef={selectionRef} onPointerDown={onPointerDown} onKeyDown={onKeyDown}>
        {geometry && summon && (
          <OpeningPanel
            key={summon.key}
            opening={opening}
            geometry={geometry}
            pointer={summon.pointer}
            k={k}
            stagger={stagger}
            glow={glow}
            closing={summon.closing}
            onClosed={onClosed}
            onClose={close}
          />
        )}
        {summon?.simulated && <SimulatedPointer at={summon.pointer} k={k} />}
      </CraftyStage>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={replay}>
          <RotateCcw /> Replay
        </Button>
        <span className="text-label-sm text-tertiary">Click anywhere on the desktop to open Crafty there; click again (or Esc) to close it.</span>
      </div>
    </div>
  )
}

export const craftyOpeningComponents: ComponentEntry[] = [
  {
    id: 'crafty-opening',
    name: 'Crafty · Opening from the cursor',
    category: 'Crafty',
    description:
      'Design examples, not wired in: how the panel could come out of the pointer after Crafty\'s trigger. Today scales the whole panel up from 40%, so the text zooms in. Morph makes the dot the panel\'s material (dot → pill → panel) and fades the content in once there\'s room. Fly first jumps the dot to the selection, where the panel opens. Reveal uncovers the panel through a circle that grows from the pointer, so nothing scales. Reduced motion gets the fade. The glow is the composer\'s Ultrathink border, once.',
    component: CraftyOpeningDemo,
    layout: 'centered',
    props: [
      {
        name: 'opening',
        description: 'How the panel opens',
        control: {
          type: 'select',
          options: [
            { label: 'Today (as built)', value: 'today' },
            { label: 'Morph: the dot becomes the panel', value: 'morph' },
            { label: 'Fly: the dot jumps to the selection', value: 'fly' },
            { label: 'Reveal: a circle opens from the pointer', value: 'reveal' },
            { label: 'Fade (reduced motion)', value: 'fade' },
          ],
        },
        defaultValue: 'morph',
      },
      { name: 'stagger', description: 'The rows rise in one after another (Morph, Fly, Reveal)', control: { type: 'boolean' }, defaultValue: true },
      { name: 'glow', description: 'The Ultrathink border plays once when the panel lands', control: { type: 'boolean' }, defaultValue: false },
      { name: 'speed', description: 'Slow motion, to judge the curves', control: { type: 'select', options: SPEED_OPTIONS }, defaultValue: '1' },
    ],
    variants: [
      { name: 'Today (as built)', description: 'crafty.css: the dot pops, the panel scales up from 40% around it', props: { opening: 'today', stagger: false, glow: false, speed: '1' } },
      { name: 'Morph', description: 'Dot → pill → panel; the content fades up after the material', props: { opening: 'morph', stagger: true, glow: false, speed: '1' } },
      { name: 'Fly', description: 'The dot jumps from the pointer to the panel\'s corner, then unfolds', props: { opening: 'fly', stagger: true, glow: false, speed: '1' } },
      { name: 'Reveal', description: 'A circle from the pointer uncovers the panel; nothing scales', props: { opening: 'reveal', stagger: false, glow: false, speed: '1' } },
      { name: 'Morph with the glow', description: 'For a moment that deserves it (a first open, sending Crafty to a session)', props: { opening: 'morph', stagger: true, glow: true, speed: '1' } },
      { name: 'Morph at ¼ speed', description: 'To see the pill phase and the radius correction', props: { opening: 'morph', stagger: true, glow: false, speed: '4' } },
    ],
  },
]
