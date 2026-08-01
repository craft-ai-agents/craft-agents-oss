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
          <stop offset="0%" style={{ stopColor: 'color-mix(in oklch, var(--brand-lime) 70%, white)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--brand-lime)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--brand-lime-deep)' }} />
        </linearGradient>
        <linearGradient id={rg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'color-mix(in oklch, var(--brand-purple) 45%, white)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--brand-purple)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--brand-purple-deep)' }} />
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
