interface RunnerMarkProps {
  className?: string
}

export function RunnerMark({ className }: RunnerMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="24" height="24" rx="7" fill="currentColor" opacity="0.16" />
      <path
        d="M10 22V9.75h7.4c2.74 0 4.6 1.58 4.6 3.9 0 1.65-.93 2.9-2.42 3.45L23 22h-4.05l-2.95-4.3h-2.25V22H10Zm3.75-7.15h3.15c.82 0 1.35-.43 1.35-1.13 0-.72-.53-1.15-1.35-1.15h-3.15v2.28Z"
        fill="currentColor"
      />
    </svg>
  )
}
