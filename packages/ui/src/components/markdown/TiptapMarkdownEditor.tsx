import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Mathematics } from '@tiptap/extension-mathematics'
import Image from '@tiptap/extension-image'
import FileHandler from '@tiptap/extension-file-handler'
import { Markdown as OfficialMarkdown } from '@tiptap/markdown'
import { Markdown as LegacyMarkdown } from 'tiptap-markdown'
import { Extension, type Editor as CoreEditor } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { TiptapBubbleMenus, INLINE_MATH_EDIT_EVENT } from './TiptapBubbleMenus'
import { TiptapSlashMenu, isSlashSuggestionActive } from './TiptapSlashMenu'
import { cn } from '../../lib/utils'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'

export type MarkdownEngine = 'legacy' | 'official'

// Languages rendered as visual blocks (contentEditable={false} NodeViews)
const VISUAL_LANGUAGES = new Set(['mermaid', 'latex', 'math', 'tex', 'katex'])

/**
 * Plugin that adds an `is-selected` class via Decoration.node() to visual
 * code blocks (mermaid/latex) and inline math when they fall within a range
 * selection (e.g. Cmd+A). This gives a unified block-level highlight instead
 * of the browser highlighting individual text nodes inside SVGs / KaTeX.
 */
const SelectionHighlight = Extension.create({
  name: 'selectionHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('selectionHighlight'),
        props: {
          decorations(state) {
            const { from, to } = state.selection
            if (from === to) return DecorationSet.empty
            if (state.selection instanceof NodeSelection) return DecorationSet.empty

            const decorations: Decoration[] = []
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'codeBlock') {
                const lang = (node.attrs.language as string | undefined)?.toLowerCase()
                if (lang && VISUAL_LANGUAGES.has(lang)) {
                  decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-selected' }))
                }
              }
              if (node.type.name === 'inlineMath') {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-selected' }))
              }
            })

            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
          },
        },
      }),
    ]
  },
})

function getLegacyMarkdown(editor: { storage: { markdown?: { getMarkdown?: () => string } } }): string {
  return editor.storage.markdown?.getMarkdown?.() ?? ''
}

function getOfficialMarkdown(editor: { getMarkdown?: () => string }): string {
  return editor.getMarkdown?.() ?? ''
}

function forceShikiDecorations(editor: any) {
  try {
    if (editor?.isDestroyed) return
    const tr = editor.view?.state.tr.setMeta('shikiPluginForceDecoration', true)
    if (tr) {
      editor.view?.dispatch(tr)
    }
  } catch {
    // Best-effort refresh only.
  }
}

function scheduleShikiRefresh(editor: any) {
  forceShikiDecorations(editor)

  for (const delay of [80, 220, 450]) {
    setTimeout(() => {
      forceShikiDecorations(editor)
    }, delay)
  }
}

const INLINE_DOUBLE_DOLLAR_REGEX = /\$\$([^\n]+?)\$\$/g
// Currency marker used during official parse to avoid accidental math tokenization.
const CURRENCY_MARKER = '¤'
const CURRENCY_RANGE_REGEX = /\$(\d[\dA-Za-z.,]*\s*[–-]\s*)\$(\d[\dA-Za-z.,]*)/g
const CURRENCY_AMOUNT_REGEX = /\$(\d[\dA-Za-z.,]*)/g

/**
 * Normalize markdown for official TipTap parser:
 * - Keep product policy: users write math with $$...$$
 * - Convert same-line $$...$$ to inline $...$ (TipTap inline math)
 * - Escape currency-like dollars ($100, $2M...) so they don't become inline math nodes
 */
export function preprocessMarkdownForOfficial(markdown: string): string {
  let index = 0
  const placeholders = new Map<string, string>()

  const withPlaceholders = markdown.replace(INLINE_DOUBLE_DOLLAR_REGEX, (_, latex: string) => {
    const key = `@@CA_INLINE_MATH_${index++}@@`
    placeholders.set(key, latex)
    return key
  })

  const rangeProtected = withPlaceholders.replace(
    CURRENCY_RANGE_REGEX,
    (_match, left: string, right: string) => `${CURRENCY_MARKER}${left}${CURRENCY_MARKER}${right}`
  )

  const amountProtected = rangeProtected.replace(
    CURRENCY_AMOUNT_REGEX,
    (_match, amount: string) => `${CURRENCY_MARKER}${amount}`
  )

  return amountProtected.replace(/@@CA_INLINE_MATH_\d+@@/g, (key) => {
    const latex = placeholders.get(key) ?? ''
    return `$${latex}$`
  })
}

/** Undo parser-safety escaping in serialized markdown. */
export function postprocessMarkdownFromOfficial(markdown: string): string {
  return markdown.replaceAll(CURRENCY_MARKER, '$')
}

const MERMAID_FILE_EXTENSIONS = new Set(['mmd', 'mermaid'])
const MERMAID_DIAGRAM_PREFIXES = [
  'graph ',
  'flowchart ',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
]

export function isMermaidFilename(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop()
  return ext != null && MERMAID_FILE_EXTENSIONS.has(ext)
}

export function extractMermaidSource(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/^```mermaid\s*\n([\s\S]*?)\n```$/i)
  if (fenced?.[1]) {
    const source = fenced[1].trim()
    return source.length > 0 ? source : null
  }

  const lines = trimmed.split('\n')
  const firstMeaningful = lines
    .map(line => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('%%'))

  if (!firstMeaningful) return null

  const looksLikeMermaid = MERMAID_DIAGRAM_PREFIXES.some(prefix => firstMeaningful.startsWith(prefix))
  return looksLikeMermaid ? trimmed : null
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Failed to read file as data URL'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function insertMermaidBlock(editor: NonNullable<ReturnType<typeof useEditor>>, source: string, pos?: number) {
  const payload = {
    type: 'codeBlock',
    attrs: { language: 'mermaid' },
    content: [{ type: 'text', text: source }],
  }

  const chain = editor.chain().focus()
  if (typeof pos === 'number') chain.setTextSelection(pos)
  chain.insertContent(payload).run()
}

function insertImageNode(editor: NonNullable<ReturnType<typeof useEditor>>, src: string, pos?: number) {
  const chain = editor.chain().focus()
  if (typeof pos === 'number') chain.setTextSelection(pos)
  chain.setImage({ src }).run()
}

async function handleDroppedOrPastedFiles(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  files: File[],
  pos?: number,
): Promise<void> {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const src = await readFileAsDataUrl(file)
      insertImageNode(editor, src, pos)
      continue
    }

    if (!isMermaidFilename(file.name)) continue
    const text = await file.text()
    const source = extractMermaidSource(text) ?? text.trim()
    if (!source) continue
    insertMermaidBlock(editor, source, pos)
  }
}

export interface TiptapMarkdownEditorProps {
  /** Markdown string content */
  content: string
  /** Called when content changes */
  onUpdate?: (markdown: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  className?: string
  /** Whether the editor is editable */
  editable?: boolean
  /**
   * Migration flag for markdown engine foundations.
   * - `legacy`: tiptap-markdown (default for safe rollout)
   * - `official`: @tiptap/markdown + mathematics extension
   */
  markdownEngine?: MarkdownEngine
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder = 'Write something...',
  className,
  editable = true,
  markdownEngine = 'legacy',
}: TiptapMarkdownEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate

  // Ref for the editor instance — used by the Mathematics onClick callback
  // which is created at extension-configure time (before useEditor returns).
  const editorRef = React.useRef<ReturnType<typeof useEditor>>(null!)

  const useOfficialMarkdown = markdownEngine === 'official'

  const extensions = React.useMemo(() => {
    const base = [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      tiptapCodeBlock.configure({
        themes: { light: 'github-light', dark: 'github-dark' },
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      FileHandler.configure({
        onPaste: async (editor, files) => {
          if (!editable || files.length === 0) return
          await handleDroppedOrPastedFiles(editor as NonNullable<ReturnType<typeof useEditor>>, files)
        },
        onDrop: async (editor, files, pos) => {
          if (!editable || files.length === 0) return
          await handleDroppedOrPastedFiles(editor as NonNullable<ReturnType<typeof useEditor>>, files, pos)
        },
      }),
      SelectionHighlight,
      ...(editable ? [TiptapSlashMenu] : []),
    ]

    if (useOfficialMarkdown) {
      return [
        ...base,
        Mathematics.configure({
          inlineOptions: {
            onClick: (_node, pos) => {
              const e = editorRef.current
              if (!e) return
              e.chain().focus().setNodeSelection(pos).run()
              // Emit after selection so BubbleMenu mounts, then the event activates the input
              queueMicrotask(() => (e as any).emit(INLINE_MATH_EDIT_EVENT))
            },
          },
          katexOptions: {
            throwOnError: false,
            strict: false,
          },
        }),
        OfficialMarkdown.configure({
          markedOptions: {
            gfm: true,
          },
        }),
      ]
    }

    return [
      ...base,
      LegacyMarkdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ]
  }, [placeholder, useOfficialMarkdown])

  const initialContent = useOfficialMarkdown
    ? preprocessMarkdownForOfficial(content)
    : content

  const editor = useEditor({
    extensions,
    content: initialContent,
    ...(useOfficialMarkdown ? { contentType: 'markdown' as const } : {}),
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-prose outline-none',
      },
      handlePaste: (_view, event) => {
        if (!editable) return false
        if (event.clipboardData?.files?.length) return false

        const text = event.clipboardData?.getData('text/plain') ?? ''
        const source = extractMermaidSource(text)
        if (!source) return false

        const activeEditor = editorRef.current
        if (!activeEditor) return false
        insertMermaidBlock(activeEditor, source)
        return true
      },
      handleDrop: (view, event) => {
        if (!editable) return false
        if (event.dataTransfer?.files?.length) return false

        const text = event.dataTransfer?.getData('text/plain') ?? ''
        const source = extractMermaidSource(text)
        if (!source) return false

        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        const activeEditor = editorRef.current
        if (!activeEditor) return false
        insertMermaidBlock(activeEditor, source, pos)
        return true
      },
    },
    onCreate: ({ editor }) => {
      queueMicrotask(() => {
        scheduleShikiRefresh(editor)
      })
    },
    onUpdate: ({ editor }) => {
      const md = useOfficialMarkdown
        ? postprocessMarkdownFromOfficial(getOfficialMarkdown(editor as { getMarkdown?: () => string }))
        : getLegacyMarkdown(editor as { storage: { markdown?: { getMarkdown?: () => string } } })
      onUpdateRef.current?.(md)
    },
  }, [useOfficialMarkdown, extensions])

  // Keep editorRef in sync for the Mathematics onClick callback
  editorRef.current = editor

  // Capture-phase keydown handler for:
  // 1. Enter on inlineMath → open edit popover
  // 2. ArrowUp/Down → select visual code blocks (mermaid/latex) instead of skipping them
  React.useEffect(() => {
    if (!editor || !editable) return
    const dom = editor.view.dom

    const isVisualCodeBlock = (node: any) =>
      node?.type.name === 'codeBlock' &&
      VISUAL_LANGUAGES.has((node.attrs.language as string | undefined)?.toLowerCase() ?? '')

    const handler = (e: KeyboardEvent) => {
      // Enter on inlineMath → open edit popover
      if (e.key === 'Enter') {
        const { selection } = editor.state
        if (selection instanceof NodeSelection && selection.node.type.name === 'inlineMath') {
          e.preventDefault()
          ;(editor as any).emit(INLINE_MATH_EDIT_EVENT)
        }
        return
      }

      // ArrowUp / ArrowDown → select visual code blocks (mermaid/latex) instead of skipping
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

      // If slash menu is active, let Suggestion keyboard navigation own Arrow keys.
      if (isSlashSuggestionActive(editor as CoreEditor)) return

      const { state, view } = editor
      const { selection, doc } = state
      const down = e.key === 'ArrowDown'

      // Exiting a selected visual code block → move to adjacent node
      if (selection instanceof NodeSelection && isVisualCodeBlock(selection.node)) {
        e.preventDefault()
        if (down) {
          const afterPos = selection.to
          if (afterPos >= doc.content.size) return
          const next = doc.nodeAt(afterPos)
          if (next && isVisualCodeBlock(next)) {
            editor.commands.setNodeSelection(afterPos)
          } else {
            editor.commands.setTextSelection(afterPos)
          }
        } else {
          const beforePos = selection.from
          if (beforePos <= 0) return
          const $before = doc.resolve(beforePos)
          const prev = $before.nodeBefore
          if (prev && isVisualCodeBlock(prev)) {
            editor.commands.setNodeSelection(beforePos - prev.nodeSize)
          } else {
            editor.commands.setTextSelection(beforePos)
          }
        }
        return
      }

      // Only handle collapsed text cursors
      if (selection.from !== selection.to) return
      const $head = selection.$head
      if ($head.depth < 1) return

      // Use ProseMirror's endOfTextblock — correctly handles multi-line blocks
      if (!view.endOfTextblock(down ? 'down' : 'up')) return

      if (down) {
        const afterPos = $head.after()
        if (afterPos >= doc.content.size) return
        const next = doc.nodeAt(afterPos)
        if (next && isVisualCodeBlock(next)) {
          e.preventDefault()
          editor.commands.setNodeSelection(afterPos)
        }
      } else {
        const beforePos = $head.before()
        if (beforePos <= 0) return
        const $before = doc.resolve(beforePos)
        const prev = $before.nodeBefore
        if (prev && isVisualCodeBlock(prev)) {
          e.preventDefault()
          editor.commands.setNodeSelection(beforePos - prev.nodeSize)
        }
      }
    }

    dom.addEventListener('keydown', handler, true)
    return () => dom.removeEventListener('keydown', handler, true)
  }, [editor, editable])

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

      const currentMd = useOfficialMarkdown
        ? postprocessMarkdownFromOfficial(getOfficialMarkdown(editor as { getMarkdown?: () => string }))
        : getLegacyMarkdown(editor as { storage: { markdown?: { getMarkdown?: () => string } } })

      if (currentMd !== content) {
        if (useOfficialMarkdown) {
          const normalized = preprocessMarkdownForOfficial(content)
          editor.commands.setContent(normalized, { contentType: 'markdown' } as never)
        } else {
          editor.commands.setContent(content)
        }

        queueMicrotask(() => {
          if (!editor.isDestroyed) {
            scheduleShikiRefresh(editor)
          }
        })
      }
    }
  }, [editor, content, useOfficialMarkdown])

  return (
    <div className={cn('tiptap-editor', className)}>
      <EditorContent editor={editor} />
      {editor && editable && <TiptapBubbleMenus editor={editor} />}
    </div>
  )
}
