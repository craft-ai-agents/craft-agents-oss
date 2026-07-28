import React, { useId } from 'react'
import { SymbolMark } from './SymbolMark'

interface ARCHstudioLogoProps extends React.SVGProps<SVGSVGElement> {
  /** When true, hides the "─── AI AGENT ───" subtitle line. Defaults to false. */
  hideSubtitle?: boolean
}

/**
 * The full ARCHstudio brand mark: emblem + "ARCH studio" wordmark +
 * "─── AI AGENT ───" subtitle. The emblem is rendered via <SymbolMark>
 * so the geometry stays byte-identical to the splash screen and the
 * canonical app icon.
 *
 * Layout (viewBox 0 0 320 80):
 *   - Emblem: 64x64 at (8, 8)
 *   - ARCH wordmark: green gradient at x=84
 *   - "studio" wordmark: purple gradient, lowercase, lighter weight at x=180
 *   - Optional subtitle: rule + "AI AGENT" + rule at y=64, x=84..308
 *
 * Typography uses Orbitron (loaded from Google Fonts CDN) with a system-sans
 * fallback so the wordmark degrades gracefully when fonts haven't loaded.
 */
export function ARCHstudioLogo({ hideSubtitle = false, className, ...props }: ARCHstudioLogoProps) {
  const id = useId()
  const lg = `${id}-left`
  const rg = `${id}-right`
  const lgt = `${id}-left-text`
  const rgt = `${id}-right-text`

  return (
    <svg
      viewBox="0 0 320 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
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
        {/* Slightly lighter text-gradients so glyphs read as "highlighted" rather than outline. */}
        <linearGradient id={lgt} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
        <linearGradient id={rgt} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E9D5FF" />
          <stop offset="100%" stopColor="#A855F7" />
        </linearGradient>
      </defs>

      {/* Emblem, scaled to 64x64 at (8, 8) so it visually balances the wordmark height. */}
      <g transform="translate(8, 8) scale(1.333)">
        <SymbolMark leftGrad={lg} rightGrad={rg} />
      </g>

      {/* "ARCH" wordmark -- geometric block letters in green */}
      <g transform="translate(84, 18)" fill={`url(#${lgt})`}>
        {/* A */}
        <path d="M 0 28 L 13 0 L 26 28 L 20 28 L 17.5 21 L 8.5 21 L 6 28 Z M 9.5 16 L 16.5 16 L 13 7 Z" />
        {/* R */}
        <path d="M 32 0 L 46 0 C 53 0 56 3 56 7 C 56 11 53 13 49 14 L 56 28 L 49 28 L 43 16 L 38 16 L 38 28 L 32 28 Z M 38 5 L 38 11 L 45 11 C 48 11 50 9.5 50 8 C 50 6.5 48 5 45 5 Z" />
        {/* C -- open left arc with a small notch at top-right */}
        <path d="M 86 5 C 84 3 80 1 76 1 C 68 1 62 6 62 14 C 62 22 68 27 76 27 C 80 27 84 25 86 23 L 89 27 C 86 30 81 31.5 76 31.5 C 64 31.5 56 24 56 14 C 56 4 64 -2.5 76 -2.5 C 81 -2.5 86 -1 89 2 Z" />
        {/* H */}
        <path d="M 96 0 L 102 0 L 102 11 L 118 11 L 118 0 L 124 0 L 124 28 L 118 28 L 118 16 L 102 16 L 102 28 L 96 28 Z" />
      </g>

      {/* "studio" wordmark -- purple, lowercase, lighter weight */}
      <text
        x="210" y="38"
        fontFamily="Orbitron, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
        fontSize="22"
        fontWeight="500"
        letterSpacing="0.5"
        fill={`url(#${rgt})`}
      >
        studio
      </text>

      {/* Subtitle: rule + AI AGENT + rule */}
      {!hideSubtitle && (
        <g transform="translate(84, 60)">
          <line x1="0" y1="0" x2="50" y2="0" stroke="#A1A1AA" strokeWidth="1" strokeLinecap="round" opacity="0.75" />
          <text
            x="60" y="3.5"
            fontFamily="Orbitron, ui-sans-serif, system-ui, -apple-system, sans-serif"
            fontSize="8"
            fontWeight="600"
            letterSpacing="4"
            fill="#A1A1AA"
          >
            AI AGENT
          </text>
          <line x1="118" y1="0" x2="220" y2="0" stroke="#A1A1AA" strokeWidth="1" strokeLinecap="round" opacity="0.75" />
        </g>
      )}
    </svg>
  )
}
