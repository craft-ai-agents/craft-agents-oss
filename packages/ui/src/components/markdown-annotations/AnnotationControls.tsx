/**
 * AnnotationControls — Shared action buttons for plan annotations.
 *
 * Layout: [N comments] |        spacer        Clear [Reply with Comments | Copy]
 * The reply/copy split button matches AcceptPlanDropdown styling (accent instead of success).
 * Used by both the inline card footer and the fullscreen island.
 */

import { Check, Copy, MessageSquare, Trash2 } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { cn } from '../../lib/utils';

interface AnnotationControlsProps {
  count: number;
  onCopy: () => Promise<void>;
  onReply?: () => void;
  onClear: () => void;
  /** Called after reply — used to close fullscreen overlay */
  onDone?: () => void;
}

export function AnnotationControls({
  count,
  onCopy,
  onReply,
  onClear,
  onDone,
}: AnnotationControlsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopy]);

  const handleReply = useCallback(() => {
    onReply?.();
    onDone?.();
  }, [onReply, onDone]);

  const handleClear = useCallback(() => {
    if (count > 3) {
      if (!window.confirm(`Remove all ${count} comments?`)) return;
    }
    onClear();
  }, [count, onClear]);

  return (
    <div className="flex items-center gap-3.5 min-h-[28px]">
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} {count === 1 ? 'comment' : 'comments'}
      </span>

      <div className="w-px h-3.5 bg-border" />

      <div className="flex items-center gap-3">
        <button
          onClick={handleClear}
          className={cn(
            'text-xs transition-colors select-none flex items-center gap-1.5',
            'text-muted-foreground hover:text-destructive',
            'focus:outline-none focus-visible:underline',
          )}
        >
          <Trash2 className="h-3 w-3" />
          Clear comments
        </button>

        <div
          className="inline-flex items-center shadow-tinted rounded-[6px]"
          style={
            { '--shadow-color': 'var(--accent-rgb)' } as React.CSSProperties
          }
        >
          {/* Primary action: Reply */}
          {onReply && (
            <button
              type="button"
              onClick={handleReply}
              className={cn(
                'h-[28px] px-2.5 text-xs font-medium flex items-center gap-1.5 transition-all',
                'bg-accent/5 text-accent hover:bg-accent/10',
                'rounded-l-[6px]',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Reply with Comments</span>
            </button>
          )}

          {/* Divider between split halves */}
          {onReply && (
            <div
              className="w-px self-stretch"
              style={{
                backgroundColor: `rgba(var(--accent-rgb), calc(var(--shadow-border-opacity) * 1.5))`,
              }}
            />
          )}

          {/* Secondary action: Copy */}
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'h-[28px] px-2.5 text-xs font-medium flex items-center transition-all',
              'bg-accent/5 hover:bg-accent/10',
              onReply ? 'rounded-r-[6px]' : 'rounded-[6px]',
              'text-accent',
            )}
            title={copied ? 'Copied!' : 'Copy comments'}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
