/**
 * Playground: a circular menu around the pointer, as a concept for Crafty. Design examples only,
 * not wired into the Crafty window; the pie Crafty ships (`renderer/crafty/pie/`) grew out of the
 * Pie look here.
 *
 * The idea: a tap on the shortcut opens the panel; holding it opens a ring of actions around
 * the pointer. Move toward one and let go to run it on the selection. It's a marking menu: the
 * direction picks, not the distance, so a practised flick works without looking, and every
 * action keeps its direction. A press without moving keeps the ring open for clicking. Here the
 * mouse stands in for the held shortcut: press, drag, release.
 */

import * as React from 'react'
import {
  AlignLeft,
  Camera,
  Languages,
  Lightbulb,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Reply,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { DURATION, EASE, SPRING, TWEEN, prefersReducedMotion } from '@craft-agent/ui/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'
import {
  CraftyStage,
  DEMO_SELECTED_TEXT,
  DOT_SIZE,
  EDGE,
  SPEED_OPTIONS,
  SimulatedPointer,
  clamp,
  schedule,
  slowed,
  useStageGeometry,
  type DemoTurn,
  type Point,
  type StageGeometry,
} from './crafty-stage'
import { OpeningPanel } from './crafty-opening'

type Look = 'ring' | 'pie' | 'labels'
type EdgeMode = 'shift' | 'arc'
type OpenAt = 'selection' | 'edge' | 'corner'

interface RadialAction {
  id: string
  label: string
  icon: LucideIcon
  /** What it asks about the selection. Ask opens the panel empty; the rest do something else. */
  question?: string
  answer?: string
  /** For an action that isn't a question: what comes next. */
  next?: string
}

const ACTIONS: Record<string, RadialAction> = {
  ask: { id: 'ask', label: 'Ask', icon: MessageSquare },
  summarize: {
    id: 'summarize',
    label: 'Summarize',
    icon: AlignLeft,
    question: 'Summarize this',
    answer: 'Leo found that the empty state still says “No sessions yet” after a source is connected, so the first screen looks like an error. Priya is adding a connected-but-empty variant before the release.',
  },
  explain: {
    id: 'explain',
    label: 'Explain',
    icon: Lightbulb,
    question: 'Explain this',
    answer: 'The first screen checks for sessions, not for connected sources. Someone who has just connected a source still gets the “nothing here” message, which reads as if the connection failed.',
  },
  reply: {
    id: 'reply',
    label: 'Draft a reply',
    icon: Reply,
    question: 'Draft a reply to this',
    answer: 'Good catch, thanks! I’ll check for connected sources before showing the empty state, and ping you when the fix is up.',
  },
  rewrite: {
    id: 'rewrite',
    label: 'Rewrite',
    icon: PenLine,
    question: 'Rewrite this more clearly',
    answer: 'After you connect a source, the empty state still says “No sessions yet”, so the first screen looks like an error.',
  },
  translate: {
    id: 'translate',
    label: 'Translate',
    icon: Languages,
    question: 'Translate this into Hungarian',
    answer: 'Az üres állapot továbbra is azt írja, hogy „Még nincsenek munkamenetek”, miután csatlakoztattál egy forrást, így az első képernyő hibának tűnik.',
  },
  screenshot: { id: 'screenshot', label: 'Screenshot', icon: Camera, next: 'drag over what to attach' },
  send: { id: 'send', label: 'Send to session', icon: MessageSquarePlus, next: 'pick the session that gets it' },
}

/** Clockwise from the top. The cardinal directions get the most used actions: they're the easiest flicks. */
const ORDER: Record<string, string[]> = {
  '4': ['ask', 'summarize', 'reply', 'explain'],
  '6': ['ask', 'summarize', 'translate', 'reply', 'explain', 'rewrite'],
  '8': ['ask', 'rewrite', 'summarize', 'translate', 'reply', 'screenshot', 'explain', 'send'],
}

/** Each look's ring radius, and the least distance between neighbouring items' centers. */
const LOOK: Record<Look, { radius: number; gap: number }> = {
  ring: { radius: 64, gap: 46 },
  pie: { radius: 74, gap: 58 },
  labels: { radius: 92, gap: 44 },
}
/** The pie's band, each side of its radius. */
const PIE_BAND = 28
/** Movement under this doesn't pick anything: it's a tap, or a hand at rest. */
const DEAD_ZONE = 16
/** How far (radians) the items turn as they fly out of the hub. */
const SWIRL = 0.5
const ITEM_STAGGER_S = 0.018
/** A pick: the ring folds into the hub, then the panel grows out of it. */
const PICK_S = 0.18

interface Slot {
  angle: number
  /** Relative to the ring's center. */
  x: number
  y: number
}

interface Ring {
  slots: Slot[]
  radius: number
  /** Radians between neighbours. */
  step: number
  full: boolean
  /** Stage coordinates: the press point, or moved in from an edge ('shift'). */
  center: Point
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

type Side = 'right' | 'left' | 'top' | 'bottom'

/** Which way a label hangs off its point: outward from the hub. */
function sideOf(angle: number): Side {
  const cos = Math.cos(angle)
  if (cos > 0.35) return 'right'
  if (cos < -0.35) return 'left'
  return Math.sin(angle) < 0 ? 'top' : 'bottom'
}

const estimateLabelWidth = (label: string, perChar = 7) => 24 + label.length * perChar

/** A label's box when it hangs off `at` toward `side`, `inset` px of it overlapping the point. */
function hangBox(at: Point, side: Side, width: number, height: number, inset = 0): Box {
  if (side === 'right') return { left: at.x - inset, right: at.x - inset + width, top: at.y - height / 2, bottom: at.y + height / 2 }
  if (side === 'left') return { left: at.x + inset - width, right: at.x + inset, top: at.y - height / 2, bottom: at.y + height / 2 }
  if (side === 'top') return { left: at.x - width / 2, right: at.x + width / 2, top: at.y - height, bottom: at.y }
  return { left: at.x - width / 2, right: at.x + width / 2, top: at.y, bottom: at.y + height }
}

function hangTransform(side: Side, inset = 0): string {
  if (side === 'right') return `translate(${-inset}px, -50%)`
  if (side === 'left') return `translate(calc(-100% + ${inset}px), -50%)`
  return side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
}

const union = (a: Box, b: Box): Box => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) })

/** The ring look's active label: past the item, hanging outward. */
const ringLabelAnchor = (slot: Slot, radius: number): Point => ({ x: Math.cos(slot.angle) * (radius + 26), y: Math.sin(slot.angle) * (radius + 26) })

/** What an item covers around the ring's center, its label included, to keep it on the stage. */
function itemBox(look: Look, slot: Slot, label: string, radius: number): Box {
  if (look === 'labels') {
    // As LabelPill draws it: sideways pills hang off their icon, the top and bottom ones are centered
    const side = sideOf(slot.angle)
    const width = estimateLabelWidth(label) + 16
    if (side === 'left' || side === 'right') return hangBox(slot, side, width, 32, 16)
    return { left: slot.x - width / 2, right: slot.x + width / 2, top: slot.y - 16, bottom: slot.y + 16 }
  }
  if (look === 'pie') {
    const outer = { x: Math.cos(slot.angle) * (radius + PIE_BAND), y: Math.sin(slot.angle) * (radius + PIE_BAND) }
    return { left: Math.min(outer.x, slot.x) - 20, right: Math.max(outer.x, slot.x) + 20, top: Math.min(outer.y, slot.y) - 20, bottom: Math.max(outer.y, slot.y) + 20 }
  }
  const disc = { left: slot.x - 22, right: slot.x + 22, top: slot.y - 22, bottom: slot.y + 22 }
  return union(disc, hangBox(ringLabelAnchor(slot, radius), sideOf(slot.angle), estimateLabelWidth(label, 6.5), 24))
}

function slotsAround(count: number, radius: number, start: number, step: number): Slot[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = start + i * step
    return { angle, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })
}

/** Away from the edges the pointer is close to (or toward the middle). */
function inwardAngle(p: Point, stage: StageGeometry): number {
  const reach = 150
  let vx = 0
  let vy = 0
  if (p.x < reach) vx += 1 - p.x / reach
  if (stage.width - p.x < reach) vx -= 1 - (stage.width - p.x) / reach
  if (p.y < reach) vy += 1 - p.y / reach
  if (stage.height - p.y < reach) vy -= 1 - (stage.height - p.y) / reach
  if (vx === 0 && vy === 0) return Math.atan2(stage.height / 2 - p.y, stage.width / 2 - p.x)
  return Math.atan2(vy, vx)
}

/**
 * Where the items go. A full ring around the pointer when it fits. Near an edge, 'shift' keeps
 * the full ring (so every action keeps its direction) and moves it in, the pointer with it (the
 * gesture reads from the press, so a real build would warp the pointer to the ring's center);
 * 'arc' keeps it on the pointer and fans the items away from the edge, widening the radius to
 * keep them apart.
 */
function layoutRing(pointer: Point, stage: StageGeometry, look: Look, labels: string[], edges: EdgeMode): Ring {
  const count = labels.length
  const { radius: base, gap } = LOOK[look]
  const boxesOf = (slots: Slot[], radius: number) => slots.map((slot, i) => itemBox(look, slot, labels[i], radius))
  const fitsAt = (c: Point, boxes: Box[]) =>
    boxes.every(b => c.x + b.left >= EDGE && c.x + b.right <= stage.width - EDGE && c.y + b.top >= EDGE && c.y + b.bottom <= stage.height - EDGE)

  const fullStep = (2 * Math.PI) / count
  const fullRadius = Math.max(base, gap / fullStep)
  const full = slotsAround(count, fullRadius, -Math.PI / 2, fullStep)
  const fullBoxes = boxesOf(full, fullRadius)
  if (edges === 'shift' || fitsAt(pointer, fullBoxes)) {
    const extent = fullBoxes.reduce(union)
    const center = {
      x: clamp(pointer.x, EDGE - extent.left, stage.width - EDGE - extent.right),
      y: clamp(pointer.y, EDGE - extent.top, stage.height - EDGE - extent.bottom),
    }
    return { slots: full, radius: fullRadius, step: fullStep, full: true, center }
  }

  const inward = inwardAngle(pointer, stage)
  const arcs = [200, 160, 120, 90].map(degrees => {
    const span = (degrees * Math.PI) / 180
    const step = span / (count - 1)
    const radius = Math.max(base, gap / step)
    const slots = slotsAround(count, radius, inward - span / 2, step)
    return { ring: { slots, radius, step, full: false, center: pointer }, fits: fitsAt(pointer, boxesOf(slots, radius)) }
  })
  return (arcs.find(arc => arc.fits) ?? arcs[arcs.length - 1]).ring
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** The item in the direction of (dx, dy): nothing inside the dead zone, or past an arc's ends. */
function slotToward(ring: Ring, dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null
  const angle = Math.atan2(dy, dx)
  let best = 0
  let bestDiff = Infinity
  ring.slots.forEach((slot, i) => {
    const diff = Math.abs(wrapAngle(angle - slot.angle))
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  })
  return bestDiff <= ring.step / 2 + (ring.full ? 1e-3 : 0.25) ? best : null
}

const point = (angle: number, r: number) => `${(Math.cos(angle) * r).toFixed(2)} ${(Math.sin(angle) * r).toFixed(2)}`

function arcPath(r: number, from: number, to: number): string {
  return `M ${point(from, r)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to, r)}`
}

/** A full circle, drawn clockwise from the top (so it draws itself in the items' order). */
const circlePath = (r: number) => `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r}`

/** A pie segment with a gap of `gap` px on both sides, the same width at both radii. */
function segmentPath(center: number, half: number, inner: number, outer: number, gap: number): string {
  const o = gap / 2 / outer
  const i = gap / 2 / inner
  return [
    `M ${point(center - half + o, outer)}`,
    `A ${outer} ${outer} 0 0 1 ${point(center + half - o, outer)}`,
    `L ${point(center + half - i, inner)}`,
    `A ${inner} ${inner} 0 0 0 ${point(center - half + i, inner)}`,
    'Z',
  ].join(' ')
}

// ---------------------------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------------------------

/** Flies out of the hub along a short spiral, and back in when the menu closes. The picked one stays a beat. */
function RingItem({ slot, radius, index, k, closing, picked, children }: {
  slot: Slot
  radius: number
  index: number
  k: number
  closing: boolean
  picked: boolean
  children: React.ReactNode
}) {
  const progress = useMotionValue(0)
  const fade = useMotionValue(1)
  const x = useTransform(progress, p => Math.cos(slot.angle - (1 - p) * SWIRL) * radius * p)
  const y = useTransform(progress, p => Math.sin(slot.angle - (1 - p) * SWIRL) * radius * p)
  const opacity = useTransform([progress, fade], ([p, f]: number[]) => Math.min(1, Math.max(0, p) / 0.35) * f)

  React.useLayoutEffect(() => {
    if (!closing) {
      if (prefersReducedMotion()) {
        progress.set(1)
        fade.set(0)
        const control = animate(fade, 1, TWEEN.fast)
        return () => control.stop()
      }
      const control = animate(progress, 1, slowed(SPRING.gentle, k, 0.03 + index * ITEM_STAGGER_S))
      return () => control.stop()
    }
    // The picked one fades where it is, done by the time the panel takes over (PICK_S)
    const control = picked
      ? animate(fade, 0, slowed({ type: 'tween', duration: DURATION.fast, ease: EASE.exit }, k, 0.03))
      : animate(progress, 0, slowed(SPRING.snap, k))
    return () => control.stop()
  }, [closing, fade, index, k, picked, progress])

  return <motion.div className="absolute left-0 top-0" style={{ x, y, opacity }}>{children}</motion.div>
}

function IconDisc({ action, active }: { action: RadialAction; active: boolean }) {
  const Icon = action.icon
  return (
    <motion.div
      className={cn(
        'grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-elev-2 transition-colors duration-micro',
        active ? 'bg-accent-solid text-on-accent' : 'bg-floating text-secondary',
      )}
      animate={{ scale: active ? 1.14 : 1 }}
      transition={SPRING.snap}
    >
      <Icon className="size-4" />
    </motion.div>
  )
}

function LabelPill({ action, active, angle }: { action: RadialAction; active: boolean; angle: number }) {
  const Icon = action.icon
  const side = sideOf(angle)
  const sideways = side === 'left' || side === 'right'
  return (
    // Sideways pills put their icon on the slot (16px in), so the icons sit on the ring
    <div style={{ transform: sideways ? hangTransform(side, 16) : 'translate(-50%, -50%)' }}>
      <motion.div
        className={cn(
          'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full pl-2.5 pr-3 text-label shadow-elev-2 transition-colors duration-micro',
          side === 'left' && 'flex-row-reverse pl-3 pr-2.5',
          active ? 'bg-accent-solid text-on-accent' : 'bg-floating text-foreground',
        )}
        style={{ transformOrigin: side === 'right' ? '16px 50%' : side === 'left' ? 'calc(100% - 16px) 50%' : '50% 50%' }}
        animate={{ scale: active ? 1.06 : 1 }}
        transition={SPRING.snap}
      >
        <Icon className={cn('size-4', active ? 'text-on-accent' : 'text-secondary')} />
        {action.label}
      </motion.div>
    </div>
  )
}

/** The orbit: draws itself around as the items fly out. */
function Guide({ ring, k, closing }: { ring: Ring; k: number; closing: boolean }) {
  const first = ring.slots[0].angle
  const last = ring.slots[ring.slots.length - 1].angle
  const d = ring.full ? circlePath(ring.radius) : arcPath(ring.radius, first - ring.step / 2, last + ring.step / 2)
  return (
    <svg aria-hidden className="absolute overflow-visible" width={1} height={1}>
      <motion.path
        d={d}
        fill="none"
        className="stroke-separator"
        strokeWidth={1.5}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={closing ? { pathLength: 0, opacity: 0 } : { pathLength: 1, opacity: 1 }}
        transition={closing ? slowed(TWEEN.exit, k) : { pathLength: slowed(SPRING.panel, k, 0.02), opacity: slowed(TWEEN.fast, k) }}
      />
    </svg>
  )
}

/** The companion dot in the middle, with a notch that points where the pointer is heading. */
function Hub({ aim, k, closing, picked }: { aim: number | null; k: number; closing: boolean; picked: boolean }) {
  return (
    <>
      <motion.div
        aria-hidden
        className="absolute left-0 top-0 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-solid shadow-elev-2"
        initial={{ scale: 0.2, opacity: 0 }}
        // A pick hands the dot to the panel, which grows out of it from the same spot and size
        animate={closing && !picked ? { scale: 0.2, opacity: 0 } : { scale: 1, opacity: 1 }}
        transition={closing ? slowed(TWEEN.exit, k) : slowed(SPRING.snap, k)}
      />
      {aim !== null && !closing && (
        <svg aria-hidden className="absolute overflow-visible" width={1} height={1}>
          <path d={arcPath(15, aim - 0.45, aim + 0.45)} fill="none" className="stroke-accent" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
      )}
    </>
  )
}

function ActiveLabel({ ring, actions, active }: { ring: Ring; actions: RadialAction[]; active: number | null }) {
  const slot = active !== null ? ring.slots[active] : null
  const at = slot ? ringLabelAnchor(slot, ring.radius) : null
  return (
    <AnimatePresence>
      {slot && at && active !== null && (
        <motion.div
          key={actions[active].id}
          className="absolute left-0 top-0"
          style={{ x: at.x, y: at.y }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={TWEEN.micro}
        >
          <div
            className="whitespace-nowrap rounded-full bg-floating px-2.5 py-1 text-label-sm font-medium text-foreground shadow-elev-2"
            style={{ transform: hangTransform(sideOf(slot.angle)) }}
          >
            {actions[active].label}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Pie({ ring, actions, active, k, closing, picked }: {
  ring: Ring
  actions: RadialAction[]
  active: number | null
  k: number
  closing: boolean
  picked: boolean
}) {
  const inner = ring.radius - PIE_BAND
  const outer = ring.radius + PIE_BAND
  const size = 2 * (outer + 24)
  const reduce = prefersReducedMotion()
  const from = { scale: reduce ? 1 : 0.6, rotate: reduce ? 0 : -24, opacity: 0 }
  const label = active !== null ? actions[active].label : `${DEMO_SELECTED_TEXT.length} characters`
  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={from}
      animate={closing ? { scale: picked ? 1 : 0.6, rotate: 0, opacity: 0 } : { scale: 1, rotate: 0, opacity: 1 }}
      transition={closing
        ? slowed(picked ? { type: 'tween', duration: 0.12, ease: EASE.exit } : TWEEN.exit, k, picked ? 0.04 : 0)
        : { scale: slowed(SPRING.base, k), rotate: slowed(SPRING.panel, k), opacity: slowed(TWEEN.fast, k) }}
    >
      {/* A drop-shadow follows the segments; a box-shadow would draw a square */}
      <svg
        aria-hidden
        className="absolute"
        width={size}
        height={size}
        viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
        style={{ left: -size / 2, top: -size / 2, filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.04)) drop-shadow(0 8px 16px rgb(0 0 0 / 0.14))' }}
      >
        {ring.slots.map((slot, i) => (
          <path
            key={actions[i].id}
            d={segmentPath(slot.angle, ring.step / 2, inner, outer, 4)}
            className={cn('transition-colors duration-micro', i === active ? 'fill-accent-solid' : 'fill-floating')}
          />
        ))}
        <circle r={inner - 5} className="fill-floating" />
      </svg>
      {ring.slots.map((slot, i) => {
        const Icon = actions[i].icon
        return (
          <div key={actions[i].id} className="absolute left-0 top-0" style={{ transform: `translate(${slot.x}px, ${slot.y}px)` }}>
            <Icon className={cn('size-4 -translate-x-1/2 -translate-y-1/2 transition-colors duration-micro', i === active ? 'text-on-accent' : 'text-secondary')} />
          </div>
        )
      })}
      <div
        className={cn(
          'absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 text-center text-caption leading-tight',
          active !== null ? 'font-medium text-foreground' : 'text-tertiary',
        )}
        style={{ width: 2 * (inner - 5) - 10 }}
      >
        {label}
      </div>
    </motion.div>
  )
}

interface MenuState {
  key: number
  /** Where the press started: the gesture's direction reads from here. */
  press: Point
  ring: Ring
  /** 'press': held, picks on release; 'click': a tap left it open. */
  mode: 'press' | 'click'
  active: number | null
  /** The pointer's direction past the dead zone, for the hub's notch. */
  aim: number | null
  /** A replay drives it, not the pointer. */
  simulated: boolean
  /** Set while it closes: the picked item, or null when dismissed. */
  closing: { picked: number | null } | null
}

function RadialMenu({ look, actions, menu, k }: { look: Look; actions: RadialAction[]; menu: MenuState; k: number }) {
  const { ring, active, closing } = menu
  const picked = closing?.picked ?? null
  return (
    <div className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${ring.center.x}px, ${ring.center.y}px)` }}>
      {look === 'pie' ? (
        <Pie ring={ring} actions={actions} active={active} k={k} closing={!!closing} picked={picked !== null} />
      ) : (
        <>
          <Guide ring={ring} k={k} closing={!!closing} />
          {actions.map((action, i) => (
            <RingItem key={action.id} slot={ring.slots[i]} radius={ring.radius} index={i} k={k} closing={!!closing} picked={picked === i}>
              {look === 'labels'
                ? <LabelPill action={action} active={active === i} angle={ring.slots[i].angle} />
                : <IconDisc action={action} active={active === i} />}
            </RingItem>
          ))}
          {look === 'ring' && !closing && <ActiveLabel ring={ring} actions={actions} active={active} />}
          <Hub aim={menu.aim} k={k} closing={!!closing} picked={picked !== null} />
        </>
      )}
    </div>
  )
}

/** What an action that isn't a question does next, at the hub. */
function NextStep({ action, at, k }: { action: RadialAction; at: Point; k: number }) {
  const Icon = action.icon
  return (
    <motion.div className="pointer-events-none absolute left-0 top-0" style={{ x: at.x, y: at.y }}>
      <motion.div
        className="flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-floating py-1.5 pl-2.5 pr-3 text-label shadow-elev-2"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, transition: slowed(TWEEN.exit, k) }}
        transition={slowed(SPRING.base, k)}
      >
        <Icon className="size-4 text-accent" />
        <span className="font-medium text-foreground">{action.label}:</span>
        <span className="text-secondary">{action.next}</span>
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------------------------
// The demo
// ---------------------------------------------------------------------------------------------

interface ResultState {
  key: number
  action: RadialAction
  /** The ring's center: the panel grows out of where the ring collapsed. */
  at: Point
  turn: DemoTurn | null
  closing: boolean
}

interface CraftyRadialDemoProps {
  look?: Look
  count?: string
  edges?: EdgeMode
  openAt?: OpenAt
  speed?: string
}

function replayPoint(openAt: OpenAt, geometry: StageGeometry): Point {
  if (openAt === 'edge') return { x: geometry.width - 34, y: Math.round(geometry.height * 0.42) }
  if (openAt === 'corner') return { x: geometry.width - 30, y: geometry.height - 30 }
  return geometry.selection.end
}

function CraftyRadialDemo({ look = 'ring', count = '8', edges = 'shift', openAt = 'selection', speed = '1' }: CraftyRadialDemoProps) {
  const { stageRef, selectionRef, geometry, toStage } = useStageGeometry()
  const [menu, setMenu] = React.useState<MenuState | null>(null)
  const [result, setResult] = React.useState<ResultState | null>(null)
  const [fakePointer, setFakePointer] = React.useState<{ at: Point; glide: boolean } | null>(null)
  const k = Number(speed) || 1
  const actions = React.useMemo(() => (ORDER[count] ?? ORDER['8']).map(id => ACTIONS[id]), [count])
  const keyRef = React.useRef(0)
  const timers = React.useRef<Array<() => void>>([])
  const geometryRef = React.useRef(geometry)
  const menuRef = React.useRef(menu)

  React.useEffect(() => {
    geometryRef.current = geometry
    menuRef.current = menu
  })

  const later = React.useCallback((steps: Array<[number, () => void]>) => {
    timers.current.push(schedule(steps.map(([seconds, run]) => [seconds * 1000 * k, run])))
  }, [k])
  const cancelTimers = React.useCallback(() => {
    timers.current.forEach(cancel => cancel())
    timers.current = []
  }, [])
  React.useEffect(() => cancelTimers, [cancelTimers])

  const openMenu = React.useCallback((at: Point, simulated: boolean): MenuState | null => {
    const g = geometryRef.current
    if (!g) return null
    keyRef.current += 1
    const next: MenuState = {
      key: keyRef.current,
      press: at,
      ring: layoutRing(at, g, look, actions.map(action => action.label), edges),
      mode: 'press',
      active: null,
      aim: null,
      simulated,
      closing: null,
    }
    setMenu(next)
    return next
  }, [actions, edges, look])

  const dismiss = React.useCallback(() => {
    setMenu(current => (current && !current.closing ? { ...current, active: null, closing: { picked: null } } : current))
    later([[0.16, () => setMenu(current => (current?.closing ? null : current))]])
  }, [later])

  const pick = React.useCallback((index: number) => {
    const current = menuRef.current
    if (!current || current.closing) return
    const action = actions[index]
    setMenu({ ...current, active: index, closing: { picked: index } })
    later([
      [PICK_S, () => {
        setMenu(null)
        keyRef.current += 1
        setResult({ key: keyRef.current, action, at: current.ring.center, turn: action.question ? { question: action.question, answer: null } : null, closing: false })
      }],
    ])
  }, [actions, later])

  const closeResult = React.useCallback(() => setResult(current => (current && !current.closing ? { ...current, closing: true } : current)), [])
  const onResultClosed = React.useCallback(() => setResult(current => (current?.closing ? null : current)), [])

  // The answer streams in a moment after the question; a step that isn't a question fades away
  React.useEffect(() => {
    if (!result || result.closing) return undefined
    const { key, action } = result
    if (action.question && !result.turn?.answer) {
      return schedule([[700 * k, () => setResult(current => (current?.key === key && current.turn ? { ...current, turn: { ...current.turn, answer: action.answer ?? '' } } : current))]])
    }
    if (action.next) return schedule([[1800 * k, () => setResult(current => (current?.key === key ? null : current))]])
    return undefined
  }, [result, k])

  /** Opens the ring where Replay points, flicks toward Summarize and lets go. */
  const replay = React.useCallback(() => {
    cancelTimers()
    setResult(null)
    const g = geometryRef.current
    if (!g) return
    const at = replayPoint(openAt, g)
    const opened = openMenu(at, true)
    if (!opened) return
    setFakePointer({ at, glide: false })
    // A ring moved in from an edge takes the pointer to its center (macOS can move the pointer:
    // CGWarpMouseCursorPosition); otherwise an edge would block the flick toward it
    const { center } = opened.ring
    const steps: Array<[number, () => void]> = []
    if (center.x !== at.x || center.y !== at.y) steps.push([0.06, () => setFakePointer({ at: center, glide: false })])
    const target = Math.max(0, actions.findIndex(action => action.id === 'summarize'))
    const slot = opened.ring.slots[target]
    const flick = { x: center.x + Math.cos(slot.angle) * 84, y: center.y + Math.sin(slot.angle) * 84 }
    later([
      ...steps,
      [0.55, () => setFakePointer({ at: flick, glide: true })],
      [0.62, () => setMenu(current => (current && !current.closing ? { ...current, active: target, aim: slot.angle } : current))],
      [1.05, () => pick(target)],
    ])
  }, [actions, cancelTimers, later, openAt, openMenu, pick])

  // Play once the stage is measured, and again whenever a control changes
  const ready = geometry !== null
  React.useEffect(() => {
    if (ready) replay()
  }, [ready, replay])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-crafty-panel]')) return
    cancelTimers()
    setFakePointer(null)
    const p = toStage(event)
    if (result) {
      closeResult()
      return
    }
    if (menu && !menu.closing && !menu.simulated) {
      if (menu.mode === 'click') {
        const index = slotToward(menu.ring, p.x - menu.ring.center.x, p.y - menu.ring.center.y)
        if (index === null) dismiss()
        else pick(index)
      }
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    openMenu(p, false)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!menu || menu.closing || menu.simulated) return
    const p = toStage(event)
    const from = menu.mode === 'press' ? menu.press : menu.ring.center
    const dx = p.x - from.x
    const dy = p.y - from.y
    const active = slotToward(menu.ring, dx, dy)
    const aim = Math.hypot(dx, dy) >= DEAD_ZONE ? Math.atan2(dy, dx) : null
    if (active !== menu.active || aim !== menu.aim) setMenu({ ...menu, active, aim })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!menu || menu.closing || menu.simulated || menu.mode !== 'press') return
    const p = toStage(event)
    const moved = Math.hypot(p.x - menu.press.x, p.y - menu.press.y) >= DEAD_ZONE
    if (!moved) setMenu({ ...menu, mode: 'click' })
    else if (menu.active !== null) pick(menu.active)
    else dismiss()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!menu || menu.closing) {
      if (event.key === 'Escape') closeResult()
      return
    }
    const directions: Record<string, number> = { ArrowUp: -Math.PI / 2, ArrowRight: 0, ArrowDown: Math.PI / 2, ArrowLeft: Math.PI }
    if (event.key === 'Escape') dismiss()
    else if (event.key === 'Enter' && menu.active !== null) pick(menu.active)
    else if (/^[1-8]$/.test(event.key) && Number(event.key) <= actions.length) pick(Number(event.key) - 1)
    else if (event.key in directions || event.key === 'Tab') {
      event.preventDefault()
      const { slots } = menu.ring
      let active: number
      if (event.key === 'Tab') {
        const step = event.shiftKey ? -1 : 1
        active = menu.active === null ? 0 : (menu.active + step + slots.length) % slots.length
      } else {
        const toward = directions[event.key]
        active = slots.reduce((best, slot, i) => (Math.abs(wrapAngle(slot.angle - toward)) < Math.abs(wrapAngle(slots[best].angle - toward)) ? i : best), 0)
      }
      setMenu({ ...menu, active, aim: slots[active].angle })
    }
  }

  return (
    <div className="flex max-w-full flex-col items-start gap-3">
      <CraftyStage
        stageRef={stageRef}
        selectionRef={selectionRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {menu && <RadialMenu key={menu.key} look={look} actions={actions} menu={menu} k={k} />}
        {geometry && result && (result.action.question || result.action.id === 'ask') && (
          <OpeningPanel
            key={result.key}
            opening="morph"
            geometry={geometry}
            pointer={result.at}
            k={k}
            stagger
            glow={false}
            closing={result.closing}
            onClosed={onResultClosed}
            onClose={closeResult}
            turn={result.turn}
            handoff
          />
        )}
        <AnimatePresence>
          {result?.action.next && <NextStep key={result.key} action={result.action} at={result.at} k={k} />}
        </AnimatePresence>
        {fakePointer && <SimulatedPointer at={fakePointer.at} glide={fakePointer.glide} k={k} />}
      </CraftyStage>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={replay}>
          <RotateCcw /> Replay
        </Button>
        <span className="text-label-sm text-tertiary">
          Press on the desktop and drag toward an action, then let go. A click keeps the ring open. Arrows, Tab, 1–8, Enter, Esc.
        </span>
      </div>
    </div>
  )
}

const LOOK_OPTIONS = [
  { label: 'Ring: icons, the active one named', value: 'ring' },
  { label: 'Pie: segments, the name in the middle', value: 'pie' },
  { label: 'Labels: every action named', value: 'labels' },
]

export const craftyRadialComponents: ComponentEntry[] = [
  {
    id: 'crafty-radial',
    name: 'Crafty · Circular menu (concept)',
    category: 'Crafty',
    description:
      'A concept, not wired in: Crafty\'s real pie (renderer/crafty/pie) grew out of its Pie look. The idea: tap the shortcut for the panel; hold it for a ring of actions around the pointer, move toward one and let go. It\'s a marking menu: the direction picks, not the distance, so a practised flick works without looking. A tap leaves it open for clicking. Questions open the panel with the answer; Screenshot and Send to session go to their next step. Near an edge, Shift moves the whole ring in and the pointer to its center (a pointer warp), so every action keeps its direction; Arc leaves the pointer alone and fans the actions away from the edge, which changes their directions.',
    component: CraftyRadialDemo,
    layout: 'centered',
    props: [
      { name: 'look', description: 'How the actions are drawn', control: { type: 'select', options: LOOK_OPTIONS }, defaultValue: 'ring' },
      {
        name: 'count',
        description: 'How many actions',
        control: { type: 'select', options: [{ label: '4: the four directions', value: '4' }, { label: '6', value: '6' }, { label: '8: directions and diagonals', value: '8' }] },
        defaultValue: '8',
      },
      {
        name: 'edges',
        description: 'Near an edge of the screen',
        control: { type: 'select', options: [{ label: 'Shift: move the ring and the pointer in', value: 'shift' }, { label: 'Arc: fan away from the edge', value: 'arc' }] },
        defaultValue: 'shift',
      },
      {
        name: 'openAt',
        description: 'Where Replay opens it',
        control: { type: 'select', options: [{ label: 'The selection', value: 'selection' }, { label: 'The right edge', value: 'edge' }, { label: 'The bottom-right corner', value: 'corner' }] },
        defaultValue: 'selection',
      },
      { name: 'speed', description: 'Slow motion, to judge the curves', control: { type: 'select', options: SPEED_OPTIONS }, defaultValue: '1' },
    ],
    variants: [
      { name: 'Ring', description: 'Eight icon buttons; the active one is named', props: { look: 'ring', count: '8', edges: 'shift', openAt: 'selection', speed: '1' } },
      { name: 'Pie', description: 'Segments, with the name in the middle', props: { look: 'pie', count: '8', edges: 'shift', openAt: 'selection', speed: '1' } },
      { name: 'Labels', description: 'Every action named: the easiest to learn', props: { look: 'labels', count: '6', edges: 'shift', openAt: 'selection', speed: '1' } },
      { name: 'Four directions', description: 'The fastest to flick, the least to remember', props: { look: 'ring', count: '4', edges: 'shift', openAt: 'selection', speed: '1' } },
      { name: 'In a corner: shift', description: 'The ring moves in and takes the pointer along; every action keeps its direction', props: { look: 'ring', count: '8', edges: 'shift', openAt: 'corner', speed: '1' } },
      { name: 'In a corner: arc', description: 'The actions fan out of the corner; their directions change', props: { look: 'ring', count: '8', edges: 'arc', openAt: 'corner', speed: '1' } },
      { name: 'Pie at ¼ speed', props: { look: 'pie', count: '8', edges: 'shift', openAt: 'selection', speed: '4' } },
    ],
  },
]
