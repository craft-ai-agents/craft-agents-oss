/**
 * AnnotationIsland — Floating bar at the bottom of fullscreen plan overlay.
 *
 * Only renders when there are annotations. Animated enter/exit with
 * blur + fade + y-translate. Contains AnnotationControls with copy/reply/clear actions.
 */

import { motion, AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { cn } from '../../lib/utils';
import { AnnotationControls } from './AnnotationControls';
import { useMarkdownAnnotations } from './MarkdownAnnotationContext';

interface AnnotationIslandProps {
  onSendToChat?: (text: string) => void;
  /** Called after reply — used to close fullscreen overlay */
  onDone?: () => void;
}

export function AnnotationIsland({
  onSendToChat,
  onDone,
}: AnnotationIslandProps) {
  const { annotations, copyComments, getCommentsText, clearAll } =
    useMarkdownAnnotations();

  const handleReply = useCallback(() => {
    onSendToChat?.(getCommentsText());
    clearAll();
  }, [onSendToChat, getCommentsText, clearAll]);

  return (
    <AnimatePresence>
      {annotations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.18, ease: 'easeOut' } }}
          exit={{ opacity: 0, y: 8, filter: 'blur(3px)', transition: { duration: 0.15, ease: 'easeIn' } }}
          className={cn(
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-[360]',
            'pl-5 pr-2.5 py-2.5 text-[14px]',
            'bg-background/95 backdrop-blur-sm shadow-strong rounded-[12px] border border-border/50',
          )}
        >
          <AnnotationControls
            count={annotations.length}
            onCopy={copyComments}
            onReply={onSendToChat ? handleReply : undefined}
            onClear={clearAll}
            onDone={onDone}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
