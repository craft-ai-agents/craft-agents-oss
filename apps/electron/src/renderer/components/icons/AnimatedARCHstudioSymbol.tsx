import { useId } from 'react'
import { SymbolMark } from './SymbolMark'

interface AnimatedARCHstudioSymbolProps {
  className?: string
}

/**
 * Animated ARCHstudio "A" emblem for the splash screen.
 *
 * The orbital ring rotates continuously (slit travels around the ring) and
 * the diamond accent pulses on a gentle ease-in-out loop. CSS for both
 * animations lives in apps/electron/src/renderer/index.css under the
 * .arch-splash-ring and .arch-splash-diamond class names -- see that file
 * for the exact keyframes.
 *
 * Honours prefers-reduced-motion at the CSS layer.
 */
export function AnimatedARCHstudioSymbol({ className }: AnimatedARCHstudioSymbolProps) {
  const id = useId()
  const lg = `${id}-left`
  const rg = `${id}-right`

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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

      <SymbolMark
        leftGrad={lg}
        rightGrad={rg}
        ringClassName="arch-splash-ring"
        diamondClassName="arch-splash-diamond"
      />
    </svg>
  )
}
