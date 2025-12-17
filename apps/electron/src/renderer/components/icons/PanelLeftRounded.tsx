import type { SVGProps } from "react"

/**
 * Custom PanelLeft icon with slightly more rounded corners
 * Based on Lucide's panel-left but with corner radius increased from 2 to 3
 */
export function PanelLeftRounded(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="3" />
      <path d="M9 3v18" />
    </svg>
  )
}
