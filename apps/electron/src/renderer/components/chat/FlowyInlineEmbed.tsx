import * as React from 'react'
import { useState } from 'react'
import type { FlowyInlineEmbed } from '@vesper/core'
import type { FlowyDocument } from '@vesper/shared/flowy'
import { DiagramRenderer } from '../diagram/DiagramRenderer'
import { Button } from '@/components/ui/button'
import { Workflow, Smartphone, Maximize2, Edit } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FlowyInlineEmbedProps {
  embed: FlowyInlineEmbed
  onEdit?: (updatedDocument: FlowyDocument) => void
  onOpenFullscreen?: () => void
  isEditable?: boolean
}

export function FlowyInlineEmbed({
  embed,
  onEdit,
  onOpenFullscreen,
  isEditable = true
}: FlowyInlineEmbedProps) {
  const [isHovered, setIsHovered] = useState(false)

  const { document } = embed

  // Get icon based on document type
  const Icon = document.type === 'flowchart' ? Workflow : Smartphone

  return (
    <div
      className={cn(
        'rounded-lg border bg-background/50 p-3 my-2 transition-colors',
        isHovered && 'border-foreground/20'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
          {document.name}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {isEditable && onEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 hover:bg-foreground/10"
              onClick={() => onEdit(document)}
              title="Edit diagram"
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
          )}
          {onOpenFullscreen && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 hover:bg-foreground/10"
              onClick={onOpenFullscreen}
              title="Open fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Diagram preview */}
      <div className="w-full h-[300px] max-h-[300px] overflow-hidden rounded border border-border/50 bg-background">
        <DiagramRenderer
          document={document}
          className="w-full h-full"
          showGrid={false}
        />
      </div>

      {/* Optional description */}
      {document.description && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {document.description}
        </p>
      )}
    </div>
  )
}
