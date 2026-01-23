/**
 * LabelBadge Component
 *
 * A colored badge/chip for displaying session labels.
 * Uses dynamic background color with calculated contrast text.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import type { Label } from '@craft-agent/shared/labels';

export interface LabelBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: Label;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Show remove button */
  removable?: boolean;
  /** Callback when remove button is clicked */
  onRemove?: () => void;
  /** Whether this badge is active/selected (for filter UI) */
  active?: boolean;
}

/**
 * Calculate contrasting text color for a background color.
 * Uses luminance formula for WCAG compliance.
 */
function getContrastColor(hex: string): '#000000' | '#ffffff' {
  // Handle invalid hex
  if (!hex || !hex.startsWith('#') || hex.length < 7) {
    return '#ffffff';
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Calculate luminance using WCAG formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Use white text on dark backgrounds, black on light
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export function LabelBadge({
  label,
  size = 'sm',
  removable = false,
  onRemove,
  active = true,
  className,
  onClick,
  ...props
}: LabelBadgeProps) {
  const textColor = getContrastColor(label.color);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full font-medium transition-all',
        size === 'sm' ? 'px-1.5 py-0 text-[10px] leading-4' : 'px-2 py-0.5 text-xs',
        onClick && 'cursor-pointer hover:opacity-80',
        !active && 'opacity-50',
        className
      )}
      style={{
        backgroundColor: label.color,
        color: textColor,
      }}
      onClick={onClick}
      {...props}
    >
      <span className="truncate max-w-[80px]">{label.name}</span>
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          aria-label={`Remove ${label.name} label`}
        >
          <X className={cn(size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3')} />
        </button>
      )}
    </span>
  );
}

/**
 * Export the contrast color utility for use elsewhere
 */
export { getContrastColor };
