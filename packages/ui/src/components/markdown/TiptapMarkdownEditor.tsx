import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { cn } from '../../lib/utils'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'

function getMarkdown(editor: { storage: { markdown?: MarkdownStorage } }): string {
  return editor.storage.markdown?.getMarkdown() ?? ''
}

export interface TiptapMarkdownEditorProps {
  /** Markdown string content */
  content: string
  /** Called when content changes (debounced on blur or cmd+s) */
  onUpdate?: (markdown: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  className?: string
  /** Whether the editor is editable */
  editable?: boolean
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder = 'Write something...',
  className,
  editable = true,
}: TiptapMarkdownEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      tiptapCodeBlock.configure({
        themes: { light: 'github-light', dark: 'github-dark' },
      }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-prose outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor)
      onUpdateRef.current?.(md)
    },
  }, [])

  // Sync editable prop
  React.useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  // Sync content when the selected task changes (key prop handles this,
  // but as a safety net for direct content prop changes)
  const prevContentRef = React.useRef(content)
  React.useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content
      const currentMd = getMarkdown(editor)
      if (currentMd !== content) {
        editor.commands.setContent(content)
      }
    }
  }, [editor, content])

  return (
    <div className={cn('tiptap-editor', className)}>
      <EditorContent editor={editor} />
    </div>
  )
}
