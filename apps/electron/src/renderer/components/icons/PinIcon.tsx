/**
 * Pin icon for always-on-top functionality
 */

import * as React from 'react'

interface PinIconProps {
  className?: string
  filled?: boolean
}

export function PinIcon({ className, filled }: PinIconProps) {
  if (filled) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
      >
        <path d="M16 4a2 2 0 0 0-2-2H10a2 2 0 0 0-2 2v1.172a2 2 0 0 0-.586 1.414L6 8l-.707.707a1 1 0 0 0 0 1.414l2.586 2.586L5 15.586V17h1.414l2.879-2.879 2.586 2.586a1 1 0 0 0 1.414 0L14 16l1.414-1.414a2 2 0 0 0 .586-1.414V12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V4h2z" />
      </svg>
    )
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5A1.5 1.5 0 0 0 18 3.5v0A1.5 1.5 0 0 0 16.5 2h-9A1.5 1.5 0 0 0 6 3.5v0A1.5 1.5 0 0 0 7.5 5H8a1 1 0 0 1 1 1v4.76" />
    </svg>
  )
}
