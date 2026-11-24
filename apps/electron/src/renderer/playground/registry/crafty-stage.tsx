/**
 * Scaffolding for the Crafty concept demos (Crafty › Opening from the cursor, Crafty › Circular
 * menu): a slice of a desktop with a chat app and a selected message, which is what Crafty reads,
 * and a static copy of the Crafty panel as built. The real panel lives in its own click-through
 * window (renderer/crafty/CraftyApp.tsx), which a playground preview can't host.
 */

import * as React from 'react'
import { ArrowUp, Camera, ChevronDown, Copy, CornerDownLeft, ExternalLink, MousePointer2, SquarePen, X } from 'lucide-react'
import { motion, type Transition } from 'motion/react'
import { Spinner } from '@craft-agent/ui'
import { EASE } from '@craft-agent/ui/motion'
import { Button, IconButton } from '@/components/ui/button'
import { COMPOSER_CHIP } from '@/components/app-shell/input/composer-styles'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import { ContextChip } from '@/crafty/ContextDetails'
import { cn } from '@/lib/utils'
import type { CraftyProvenance, CraftySelectionResult } from '../../../shared/crafty'

/** The panel's width in the Crafty window (CraftyApp's PANEL_WIDTH). */
export const PANEL_WIDTH = 400
/** The companion dot's diameter (crafty.css). */
export const DOT_SIZE = 18
/** The panel keeps this far from the stage's edges (PanelAnchor's EDGE). */
export const EDGE = 12
const PANEL_GAP = 10

export interface Point {
  x: number
  y: number
}

export interface StageGeometry {
  width: number
  height: number
  /** The selected text's box, and where the pointer rests after selecting it: the last line's end. */
  selection: { x: number; y: number; width: number; height: number; end: Point }
}

/** Where a panel goes: its top-left corner, or its bottom-left corner when `above`. */
export interface PanelPlacement {
  x: number
  y: number
  above: boolean
}

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Like CraftyApp's placePanel: under the selection when the pointer is on it, else next to the
 * pointer; above when there's more room there and not enough below.
 */
export function placePanel(geometry: StageGeometry, pointer: Point, panelHeight: number): PanelPlacement {
  const { selection: s, width, height } = geometry
  const onSelection = pointer.x >= s.x - 8 && pointer.x <= s.x + s.width + 8 && pointer.y >= s.y - 8 && pointer.y <= s.y + s.height + 8
  const belowY = (onSelection ? s.y + s.height : pointer.y + 6) + PANEL_GAP
  const aboveY = (onSelection ? s.y : pointer.y - 6) - PANEL_GAP
  const spaceBelow = height - belowY - EDGE
  const spaceAbove = aboveY - EDGE
  const above = spaceBelow < panelHeight && spaceAbove > spaceBelow
  const x = clamp(onSelection ? s.x : pointer.x - 20, EDGE, width - PANEL_WIDTH - EDGE)
  return { x, y: above ? aboveY : belowY, above }
}

/**
 * A transition `k` times slower (springs and tweens alike), starting after `delay` seconds of the
 * real-time choreography. The demos' slow-motion control runs through here.
 */
export function slowed(transition: Transition, k: number, delay = 0): Transition {
  const t = { ...(transition as unknown as Record<string, unknown>) }
  if (typeof t.visualDuration === 'number') t.visualDuration = t.visualDuration * k
  if (typeof t.duration === 'number') t.duration = t.duration * k
  if (typeof t.stiffness === 'number') t.stiffness = t.stiffness / (k * k)
  if (typeof t.damping === 'number') t.damping = t.damping / k
  if (delay) t.delay = delay * k
  return t as unknown as Transition
}

/** Runs each step after its delay (ms); the returned function cancels the ones still pending. */
export function schedule(steps: Array<[number, () => void]>): () => void {
  const timers = steps.map(([ms, run]) => window.setTimeout(run, ms))
  return () => timers.forEach(timer => window.clearTimeout(timer))
}

/** The slow-motion control both demos share. */
export const SPEED_OPTIONS = [
  { label: 'Real time', value: '1' },
  { label: '½ speed', value: '2' },
  { label: '¼ speed', value: '4' },
  { label: '⅒ speed', value: '10' },
]

// ---------------------------------------------------------------------------------------------
// The stage: a desktop with a chat app, and a selected message
// ---------------------------------------------------------------------------------------------

export const DEMO_APP = 'Team Chat'
export const DEMO_SELECTED_TEXT =
  'The empty state still says “No sessions yet” after you connect a source, so the first screen reads like an error.'

const MESSAGES: Array<{ initials: string; name: string; time: string; tint: string; text?: string; selected?: [string, string] }> = [
  { initials: 'MO', name: 'Maya Ortiz', time: '10:42', tint: 'bg-info-tint text-info', text: 'Pushed the new onboarding copy. Can someone sanity-check the second screen before I ship it?' },
  { initials: 'LB', name: 'Leo Brandt', time: '10:44', tint: 'bg-accent-tint text-accent', selected: ['Tried it on a fresh install. ', ' The rest reads well.'] },
  { initials: 'PS', name: 'Priya Shah', time: '10:45', tint: 'bg-success-tint text-success', text: 'Good catch, I’ll add a connected-but-empty variant.' },
  { initials: 'MO', name: 'Maya Ortiz', time: '10:47', tint: 'bg-info-tint text-info', text: 'Thanks both, holding the release until that’s in.' },
]

function MockChatWindow({ selectionRef }: { selectionRef: React.Ref<HTMLSpanElement> }) {
  return (
    <div className="absolute inset-6 flex flex-col overflow-hidden rounded-lg bg-paper shadow-elev-1">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-subtle px-4">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(dot => <span key={dot} className="size-2.5 rounded-full bg-fill-pressed" />)}
        </div>
        <span className="text-label font-medium text-foreground"># launch-review</span>
        <span className="text-label-sm text-tertiary">{DEMO_APP}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        {MESSAGES.map((message, index) => (
          <div key={index} className="flex gap-3">
            <div className={cn('grid size-8 shrink-0 place-items-center rounded-md text-label-sm font-semibold', message.tint)}>{message.initials}</div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-label font-semibold text-foreground">{message.name}</span>
                <span className="text-caption text-tertiary">{message.time}</span>
              </div>
              <p className="text-copy text-foreground">
                {message.selected ? (
                  <>
                    {message.selected[0]}
                    <span ref={selectionRef} className="rounded-[3px] bg-accent-tint-strong box-decoration-clone">{DEMO_SELECTED_TEXT}</span>
                    {message.selected[1]}
                  </>
                ) : message.text}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="mx-5 mb-4 flex h-9 shrink-0 items-center rounded-md border border-subtle px-3 text-label text-tertiary">
        Message #launch-review
      </div>
    </div>
  )
}

/** The stage and its selection, measured in stage coordinates (re-measured when the stage resizes). */
export function useStageGeometry() {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const selectionRef = React.useRef<HTMLSpanElement>(null)
  const [geometry, setGeometry] = React.useState<StageGeometry | null>(null)

  React.useLayoutEffect(() => {
    const stage = stageRef.current
    const selection = selectionRef.current
    if (!stage || !selection) return
    const measure = () => {
      const s = stage.getBoundingClientRect()
      const box = selection.getBoundingClientRect()
      const lines = selection.getClientRects()
      const last = lines[lines.length - 1] ?? box
      const next: StageGeometry = {
        width: Math.round(s.width),
        height: Math.round(s.height),
        selection: {
          x: Math.round(box.left - s.left),
          y: Math.round(box.top - s.top),
          width: Math.round(box.width),
          height: Math.round(box.height),
          end: { x: Math.round(last.right - s.left), y: Math.round(last.top - s.top + last.height / 2) },
        },
      }
      // Same numbers, same object: a resize that changes nothing doesn't replay the demo
      setGeometry(current => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  /** A pointer event's position in stage coordinates. */
  const toStage = React.useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }, [])

  return { stageRef, selectionRef, geometry, toStage }
}

type StageHandlers = Pick<
  React.HTMLAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onKeyDown'
>

/** The desktop. Focusable, so the demos can take Esc, arrows and Enter. Overlays go in `children`. */
export function CraftyStage({ stageRef, selectionRef, children, ...handlers }: StageHandlers & {
  stageRef: React.Ref<HTMLDivElement>
  selectionRef: React.Ref<HTMLSpanElement>
  children?: React.ReactNode
}) {
  return (
    <div
      ref={stageRef}
      tabIndex={0}
      className="relative h-[460px] w-[760px] max-w-full shrink-0 touch-none select-none overflow-hidden rounded-xl bg-navigator shadow-elev-1"
      {...handlers}
    >
      <MockChatWindow selectionRef={selectionRef} />
      {children}
    </div>
  )
}

/** Where a replay's pointer is: the real one isn't there, so the demo draws one. */
export function SimulatedPointer({ at, k, glide = false }: { at: Point; k: number; glide?: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0"
      initial={false}
      // The arrow's tip is 3.5px in from the icon's corner
      animate={{ x: at.x - 3.5, y: at.y - 3.5 }}
      transition={glide ? slowed({ type: 'tween', duration: 0.28, ease: EASE.standard }, k) : { duration: 0 }}
    >
      <MousePointer2 className="size-5 fill-black text-white" strokeWidth={1.5} />
    </motion.div>
  )
}

// ---------------------------------------------------------------------------------------------
// The panel, as built (a static copy of CraftyApp's markup)
// ---------------------------------------------------------------------------------------------

const DEMO_SELECTION: CraftySelectionResult = {
  selection: {
    text: DEMO_SELECTED_TEXT,
    method: 'accessibility',
    rawMethod: 0,
    posLevel: 0,
    bounds: null,
    programName: DEMO_APP,
  },
  latencyMs: 14,
}

const DEMO_PROVENANCE: CraftyProvenance = {
  pid: null,
  bundleId: null,
  appName: DEMO_APP,
  windowTitle: '#launch-review',
  url: null,
  notes: [],
  latencyMs: 40,
}

const CLAUDE_CONNECTION = { name: 'Claude', providerType: 'anthropic' as const, baseUrl: undefined, piAuthProvider: undefined }

/** CraftyTargetMenu's and CraftyModelMenu's chip styles. */
const TARGET_CHIP = 'h-control-sm shrink gap-1 pl-2 pr-1.5 text-label-sm font-normal text-tertiary'
const MODEL_CHIP = 'h-control-sm gap-1 pl-2 pr-1.5 text-label-sm font-normal text-tertiary'

/** A question sent from the panel: its answer is null while it streams. */
export interface DemoTurn {
  question: string
  answer: string | null
}

export interface PanelRow {
  key: string
  node: React.ReactNode
}

/**
 * The panel's rows, without its material (background, radius, shadow), so an opening can animate
 * the material and the content separately.
 */
export function panelRows({ turn, onClose }: { turn?: DemoTurn | null; onClose: () => void }): PanelRow[] {
  const rows: PanelRow[] = [
    {
      key: 'header',
      node: (
        <div className="flex select-none items-center gap-1 py-2 pl-card-pad pr-2">
          <div className="flex min-w-0 flex-1 items-center">
            <ContextChip selection={DEMO_SELECTION} provenance={DEMO_PROVENANCE} open={false} onToggle={() => {}} detailsId="crafty-demo-details" />
          </div>
          <button type="button" className={cn(COMPOSER_CHIP, TARGET_CHIP, 'max-w-44')}>
            <SquarePen className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">New session</span>
            <ChevronDown className="size-3.5 shrink-0" />
          </button>
          {turn && <IconButton aria-label="Open in Craft" size="sm" icon={<ExternalLink />} />}
          <IconButton aria-label="Close" size="sm" icon={<X />} onClick={onClose} />
        </div>
      ),
    },
  ]
  if (turn) {
    rows.push({
      key: 'answer',
      node: (
        <div className="border-t border-subtle px-card-pad py-2">
          <div className="mb-1 text-caption text-tertiary">{turn.question}</div>
          {turn.answer
            ? <p className="text-label text-foreground">{turn.answer}</p>
            : <div className="flex items-center gap-2 text-label-sm text-secondary"><Spinner /> Thinking…</div>}
        </div>
      ),
    })
    if (turn.answer) {
      rows.push({
        key: 'actions',
        node: (
          <div className="flex items-center gap-1 border-t border-subtle px-card-pad py-2">
            <Button size="sm"><CornerDownLeft /> Insert at cursor</Button>
            <IconButton aria-label="Copy" size="sm" icon={<Copy />} />
          </div>
        ),
      })
    }
  }
  rows.push({
    key: 'input',
    node: (
      <div className="flex items-end gap-1.5 border-t border-subtle px-card-pad py-2">
        <div className="flex min-h-control flex-1 items-center rounded-md bg-sunken px-2.5 text-label text-tertiary">
          {turn ? 'Ask a follow-up…' : 'Ask about this…'}
        </div>
        <button type="button" className={cn(COMPOSER_CHIP, 'shrink gap-1 pl-2.5 pr-2', MODEL_CHIP)}>
          <ConnectionIcon connection={CLAUDE_CONNECTION} size={14} />
          <span className="min-w-0 truncate">Opus 5.5</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
        {!turn && <IconButton aria-label="Capture a region" icon={<Camera />} />}
        <IconButton aria-label="Send" icon={<ArrowUp />} />
      </div>
    ),
  })
  return rows
}
