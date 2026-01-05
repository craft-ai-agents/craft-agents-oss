import * as React from 'react'
import { useRef, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import type { OnMount, OnChange } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useTheme } from '@/context/ThemeContext'

interface MonacoEditorProps {
  content: string
  onChange: (content: string) => void
  onCursorChange: (line: number) => void
  scrollToLineRef?: React.MutableRefObject<((line: number) => void) | null>
}

/**
 * MonacoEditor - Monaco-based markdown editor
 *
 * Features:
 * - Markdown syntax highlighting
 * - Cursor position tracking for TOC
 * - Scroll-to-line API via ref
 * - Light/dark theme support
 * - Word wrap enabled
 * - Minimap disabled for cleaner look
 */
export function MonacoEditor({
  content,
  onChange,
  onCursorChange,
  scrollToLineRef,
}: MonacoEditorProps) {
  const { resolvedMode } = useTheme()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  // Handle editor mount
  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor

    // Track cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      onCursorChange(e.position.lineNumber)
    })

    // Initial cursor position
    const position = editor.getPosition()
    if (position) {
      onCursorChange(position.lineNumber)
    }

    // Focus the editor
    editor.focus()
  }, [onCursorChange])

  // Expose scroll-to-line via ref
  useEffect(() => {
    if (scrollToLineRef) {
      scrollToLineRef.current = (line: number) => {
        if (editorRef.current) {
          editorRef.current.revealLineInCenter(line)
          editorRef.current.setPosition({ lineNumber: line, column: 1 })
          editorRef.current.focus()
        }
      }
    }

    return () => {
      if (scrollToLineRef) {
        scrollToLineRef.current = null
      }
    }
  }, [scrollToLineRef])

  // Handle content changes
  const handleChange: OnChange = useCallback((value) => {
    onChange(value ?? '')
  }, [onChange])

  return (
    <Editor
      height="100%"
      language="markdown"
      theme={resolvedMode === 'dark' ? 'vs-dark' : 'vs'}
      value={content}
      onChange={handleChange}
      onMount={handleMount}
      options={{
        // Font settings
        fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.6,

        // Layout
        wordWrap: 'on',
        minimap: { enabled: false },
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 0,

        // Behavior
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        insertSpaces: true,

        // Appearance
        renderLineHighlight: 'none',
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'hidden',
          verticalScrollbarSize: 8,
        },

        // Padding
        padding: {
          top: 24,
          bottom: 24,
        },
      }}
    />
  )
}
