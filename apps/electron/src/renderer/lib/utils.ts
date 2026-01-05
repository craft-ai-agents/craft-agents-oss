import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Check if a string is a valid 6-character hex color (e.g., #FF0000)
 */
export function isHexColor(str: string | undefined): boolean {
  return !!str && /^#[0-9A-Fa-f]{6}$/.test(str)
}
