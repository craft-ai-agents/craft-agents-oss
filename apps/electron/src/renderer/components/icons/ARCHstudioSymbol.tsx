import { useId } from 'react'
import { SymbolMark } from './SymbolMark'

interface ARCHstudioSymbolProps {
  className?: string
}

/**
 * Static ARCHstudio "A" emblem. The SymbolMark wrapped in its own <svg>
 * with useId-safe gradient IDs so it can be embedded anywhere without
 * collisions. Used in headers, sidebar, favicons, and anywhere a static
 * version of the mark is required.
 */
export function ARCHstudioSymbol({ className }: ARCHstudioSymbolProps) {
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

      <SymbolMark leftGrad={lg} rightGrad={rg} />
    </svg>
  )
}
