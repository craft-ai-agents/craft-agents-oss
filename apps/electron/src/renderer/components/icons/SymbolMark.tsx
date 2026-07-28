import { useId } from 'react'

interface SymbolMarkProps {
  /** ID of an externally-defined green gradient. If omitted, a local one is created. */
  leftGrad?: string
  /** ID of an externally-defined purple gradient. If omitted, a local one is created. */
  rightGrad?: string
  /** Class name applied to the orbital-ring group (used for animations). */
  ringClassName?: string
  /** Class name applied to the diamond accent (used for animations). */
  diamondClassName?: string
}

/**
 * The ARCHstudio "A" emblem.
 *
 * Composed of:
 *   - A split green / purple orbital ring with a small slit at the top, through
 *     which the A's apex protrudes.
 *   - A two-stroke "A" with the left leg in green, the right leg + crossbar in
 *     purple, meeting at a sharp point above the ring.
 *   - A floating purple diamond accent below the crossbar.
 *
 * Designed for viewBox "0 0 48 48". The wrapping <svg> lives in the parent so
 * the same geometry can be reused at every size from the splash-screen hero
 * down to a 16x16 favicon. Gradient IDs are accepted from the parent (so a
 * wordmark component can share defs) and fall back to a useId-safe local pair
 * when rendered standalone.
 */
export function SymbolMark({
  leftGrad,
  rightGrad,
  ringClassName,
  diamondClassName,
}: SymbolMarkProps) {
  const localId = useId()
  const useLocal = !leftGrad || !rightGrad
  const lg = leftGrad ?? `${localId}-left`
  const rg = rightGrad ?? `${localId}-right`

  return (
    <g>
      {useLocal && (
        <defs>
          <linearGradient id={lg} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86EFAC" />
            <stop offset="55%" stopColor="#22C55E" />
            <stop offset="100%" stopColor="#15803D" />
          </linearGradient>
          <linearGradient id={rg} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E9D5FF" />
            <stop offset="55%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#6B21A8" />
          </linearGradient>
        </defs>
      )}

      {/* Ring group: rotates together as one piece via the animation class. */}
      <g className={ringClassName}>
        {/* Left half (top slit -> through the left -> bottom). */}
        <path
          d="M 26 6 A 18 18 0 1 0 24 42"
          stroke={`url(#${lg})`}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
        {/* Right half (top slit -> through the right -> bottom). */}
        <path
          d="M 22 6 A 18 18 0 1 1 24 42"
          stroke={`url(#${rg})`}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* A apex protrudes ABOVE the ring through the slit. */}
      <path
        d="M 24 4 L 10 38"
        stroke={`url(#${lg})`}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M 24 4 L 38 38"
        stroke={`url(#${rg})`}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <line
        x1={15} y1={26} x2={33} y2={26}
        stroke={`url(#${rg})`}
        strokeWidth={3}
        strokeLinecap="round"
      />

      {/* Floating purple diamond accent below the crossbar. */}
      <rect
        className={diamondClassName}
        x={21.5} y={29.5} width={5} height={5}
        transform="rotate(45 24 32)"
        fill={`url(#${rg})`}
      />
    </g>
  )
}
