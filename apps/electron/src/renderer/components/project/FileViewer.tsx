/**
 * FileViewer
 *
 * Renders a project file with appropriate viewer based on file type.
 * - .md files: rendered with Markdown component, with toggle to edit mode
 * - Other text files: rendered as plain text with basic code styling
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { FileText, Pencil, Eye, Save } from 'lucide-react'
import { Markdown } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

export interface FileViewerProps {
  workspaceId: string
  projectSlug: string
  filePath: string
}

export function FileViewer({ workspaceId, projectSlug, filePath }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  const fileName = filePath.split('/').pop() || filePath
  const isMarkdown = /\.md$/i.test(filePath)

  // Load file content
  useEffect(() => {
    setLoading(true)
    window.electronAPI.readProjectFile(workspaceId, projectSlug, filePath)
      .then((text) => {
        setContent(text)
        setEditContent(text || '')
      })
      .catch((err) => {
        console.error('[FileViewer] Failed to read file:', err)
        setContent(null)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, projectSlug, filePath])

  // Save file
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.electronAPI.writeProjectFile(workspaceId, projectSlug, filePath, editContent)
      setContent(editContent)
      setEditing(false)
    } catch (err) {
      console.error('[FileViewer] Failed to save file:', err)
    } finally {
      setSaving(false)
    }
  }, [workspaceId, projectSlug, filePath, editContent])

  // Handle keyboard shortcut for save
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading file...</p>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Failed to load file</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* File header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate flex-1">{fileName}</span>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-[6px] bg-foreground/[0.05] hover:bg-foreground/[0.08] transition-colors disabled:opacity-50"
              >
                <Save className="h-3 w-3" />
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setEditContent(content || '')
                }}
                className="inline-flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-[6px] hover:bg-foreground/[0.05] transition-colors text-muted-foreground"
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 h-6 px-2 text-xs font-medium rounded-[6px] hover:bg-foreground/[0.05] transition-colors text-muted-foreground"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-auto">
        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-full p-4 bg-transparent text-sm font-mono resize-none outline-none"
            spellCheck={false}
          />
        ) : isMarkdown ? (
          <div className="p-6 max-w-3xl">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <pre className="p-4 text-sm font-mono whitespace-pre-wrap">{content}</pre>
        )}
      </div>
    </div>
  )
}
