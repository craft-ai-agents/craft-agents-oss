import React, { useState, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText } from 'lucide-react'
import { Spinner } from '@vesper/ui'

interface FileViewerProps {
  path: string | null
}

export function FileViewer({ path }: FileViewerProps) {
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setContent('')
      setError(null)
      return
    }

    const loadFile = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const fileContent = await window.electronAPI.readFile(path)
        setContent(fileContent)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
        setContent('')
      } finally {
        setIsLoading(false)
      }
    }

    loadFile()
  }, [path])

  if (!path) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <div className="size-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
          <FileText className="size-8 text-muted-foreground/50" />
        </div>
        <p className="font-medium text-foreground">No file selected</p>
        <p className="text-sm mt-1">Click a file path in the chat to view it here</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* File path header */}
      <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-2 shrink-0">
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <p className="text-xs font-mono text-muted-foreground truncate select-all" title={path}>
          {path}
        </p>
      </div>

      {/* File content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-3">
              <Spinner className="text-lg" />
              <span className="text-sm font-medium">Loading content...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-32 text-destructive gap-2">
              <p className="text-sm font-medium">Error loading file</p>
              <p className="text-xs">{error}</p>
            </div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed selection:bg-foreground/20">
              {content}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
