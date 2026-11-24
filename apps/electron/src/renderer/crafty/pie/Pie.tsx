import { Spinner } from '@craft-agent/ui'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { cn } from '@/lib/utils'
import { arcPath, hubRadius, innerRadius, outerRadius, segmentPath, type Ring } from './geometry'
import { itemAccessibleName, type HubText, type PieItem } from './slots'

/** Pixels between neighbouring segments. */
const SEGMENT_GAP = 4

export type PieExit = { kind: 'pick'; index: number } | { kind: 'cancel' }

export interface PieViewProps {
  ring: Ring
  items: PieItem[]
  active: number | null
  /** The pointer's direction past the dead zone: before the pie draws, the hub's notch shows it. */
  aim: number | null
  /** Before this (the start of a hold) only the hub dot shows, so a quick flick never draws the pie. */
  drawn: boolean
  /** Names the slot aimed at (there are no labels around the pie), else says what goes along. */
  hub: HubText
  exit: PieExit | null
  listboxId: string
  optionId: (index: number) => string
}

function Glyph({ item, className }: { item: PieItem; className?: string }) {
  if (item.glyph) return <span className={cn('text-caption font-semibold leading-none', className)}>{item.glyph}</span>
  const Icon = item.icon
  return Icon ? <Icon className={cn('size-4', className)} /> : null
}

/** The ▸ of a slot with a sub-pie: a small triangle at the band's outer edge, pointing out. */
function markerPath(angle: number, outer: number): string {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const tip = outer - 4
  const base = outer - 9
  const half = 3.5
  const point = (r: number, side: number) => `${(cos * r - sin * side).toFixed(2)} ${(sin * r + cos * side).toFixed(2)}`
  return `M ${point(tip, 0)} L ${point(base, half)} L ${point(base, -half)} Z`
}

/**
 * The pie, from the playground's Pie look (`playground/registry/crafty-radial.tsx`). It only
 * draws: `CraftyPie` reads the pointer and keys. Slots that can't run stay in place, dimmed.
 */
export function PieView({ ring, items, active, aim, drawn, hub, exit, listboxId, optionId }: PieViewProps) {
  const inner = innerRadius(ring)
  const outer = outerRadius(ring)
  const hubR = hubRadius(ring)
  const size = 2 * (outer + 8)
  const picked = exit?.kind === 'pick' ? items[exit.index] : null

  return (
    <div
      className="crafty-pie-anchor"
      data-state={exit?.kind ?? 'open'}
      style={{ transform: `translate(${ring.center.x}px, ${ring.center.y}px)` }}
    >
      {drawn ? (
        <div className="crafty-pie" data-state={exit?.kind ?? 'open'}>
          {/* A drop-shadow follows the segments; a box-shadow would draw a square */}
          <svg
            aria-hidden
            className="absolute"
            width={size}
            height={size}
            viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
            style={{ left: -size / 2, top: -size / 2, filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.05)) drop-shadow(0 8px 16px rgb(0 0 0 / 0.16))' }}
          >
            {ring.slots.map((slot, i) => {
              const item = items[i]
              if (!item) return null
              const segment = segmentPath(slot.angle, ring.step / 2, inner, outer, SEGMENT_GAP)
              const isActive = i === active
              const lit = isActive && item.availability.state !== 'off'
              return (
                <g key={item.id}>
                  <path d={segment} className={lit ? 'fill-accent-solid' : 'fill-floating'} />
                  {/* A dimmed slot aimed at gets a neutral highlight: the hub says why it can't run */}
                  {isActive && !lit && <path d={segment} className="fill-fill-selected" />}
                  {item.sub && (
                    <path d={markerPath(slot.angle, outer)} className={cn('fill-current', lit ? 'text-on-accent' : 'text-tertiary')} />
                  )}
                </g>
              )
            })}
            <circle r={hubR} className="fill-floating" />
          </svg>

          <div role="listbox" id={listboxId} aria-label="Crafty actions">
            {ring.slots.map((slot, i) => {
              const item = items[i]
              if (!item) return null
              const off = item.availability.state === 'off'
              const lit = i === active && !off
              return (
                <div
                  key={item.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={off || undefined}
                  aria-label={itemAccessibleName(item)}
                  className="absolute left-0 top-0"
                  style={{ transform: `translate(${slot.x}px, ${slot.y}px)` }}
                >
                  <div className="-translate-x-1/2 -translate-y-1/2">
                    <Glyph item={item} className={lit ? 'text-on-accent' : off ? 'text-disabled' : 'text-secondary'} />
                  </div>
                </div>
              )
            })}
          </div>

          <div
            aria-live="polite"
            className="absolute left-0 top-0 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 text-center"
            style={{ width: 2 * hubR - 10 }}
          >
            {hub.mark ? (
              <>
                <span aria-hidden>
                  <CraftAgentsSymbol className="h-6 text-accent" />
                </span>
                <span className="sr-only">{hub.label}</span>
              </>
            ) : (
              <>
                <span className={cn('line-clamp-2 text-caption leading-tight', active !== null ? 'font-medium text-foreground' : 'text-secondary')}>
                  {hub.primary}
                </span>
                {hub.secondary && (
                  <span className="flex items-center gap-1 text-caption leading-tight text-tertiary">
                    {hub.busy && <Spinner className="shrink-0 text-[9px]" />}
                    <span className="line-clamp-3">{hub.secondary}</span>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div aria-hidden className="crafty-pie-dot bg-accent-solid shadow-elev-2" />
          {aim !== null && !exit && (
            <svg aria-hidden className="absolute overflow-visible" width={1} height={1}>
              <path d={arcPath(15, aim - 0.45, aim + 0.45)} fill="none" className="stroke-accent" strokeWidth={2.5} strokeLinecap="round" />
            </svg>
          )}
        </>
      )}

      {/* Mark-ahead: a pick before the pie drew flashes the slot at the hub */}
      {picked && !drawn && (
        <div aria-hidden className="crafty-pie-flash grid size-9 place-items-center rounded-full bg-accent-solid text-on-accent shadow-elev-2">
          <Glyph item={picked} />
        </div>
      )}
    </div>
  )
}
