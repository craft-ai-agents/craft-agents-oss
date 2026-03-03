import * as React from 'react'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import CodeBlockShiki from 'tiptap-extension-code-block-shiki'
import { Pencil } from 'lucide-react'
import { MarkdownMermaidBlock } from './MarkdownMermaidBlock'
import { MarkdownLatexBlock } from './MarkdownLatexBlock'

/**
 * React NodeView for code blocks that dispatches rendering:
 *
 * - `mermaid`  → MarkdownMermaidBlock (rendered SVG diagram)
 * - `latex`/`math` → MarkdownLatexBlock (KaTeX rendered equation)
 * - everything else → <pre><code> with Shiki decorations (editable)
 *
 * Mermaid/LaTeX blocks render the visual output without a contentDOM,
 * so they're not editable inline (the content stays in the document
 * for markdown round-tripping). Regular code blocks expose NodeViewContent
 * so ProseMirror manages the text and Shiki decorations apply.
 *
 * Visual blocks show a pencil icon on hover. Clicking it places the
 * ProseMirror selection inside the code block, which triggers the
 * CodeBlockEditMenu bubble menu for source editing.
 */

interface TiptapCodeBlockViewProps {
  node: ProseMirrorNode
  editor: Editor
  getPos: () => number | undefined
}

function TiptapCodeBlockView({ node, editor, getPos }: TiptapCodeBlockViewProps) {
  const language = (node.attrs.language as string | undefined)?.toLowerCase()

  // Place the cursor inside this code block so the BubbleMenu appears
  const handleEditClick = React.useCallback(() => {
    const pos = getPos()
    if (pos == null) return
    // Position cursor at the start of the code block content (pos + 1)
    editor.chain().focus().setTextSelection(pos + 1).run()
  }, [editor, getPos])

  if (language === 'mermaid') {
    return (
      <NodeViewWrapper contentEditable={false} className="tiptap-mermaid-block">
        <div className="relative group">
          <button
            type="button"
            onClick={handleEditClick}
            className="absolute top-2 right-2 z-10 p-1 rounded-[6px] bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-all select-none border-none cursor-pointer"
            title="Edit Mermaid"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <MarkdownMermaidBlock code={node.textContent} showExpandButton={false} tapToOpen={false} />
        </div>
      </NodeViewWrapper>
    )
  }

  if (language === 'latex' || language === 'math' || language === 'tex' || language === 'katex') {
    return (
      <NodeViewWrapper contentEditable={false} className="tiptap-latex-block">
        <div className="relative group">
          <button
            type="button"
            onClick={handleEditClick}
            className="absolute top-2 right-2 z-10 p-1 rounded-[6px] bg-background shadow-minimal text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-all select-none border-none cursor-pointer"
            title="Edit LaTeX"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <MarkdownLatexBlock code={node.textContent} />
        </div>
      </NodeViewWrapper>
    )
  }

  // Regular code block — NodeViewContent creates a contentDOM
  // that ProseMirror manages. Shiki inline decorations apply to this content.
  return (
    <NodeViewWrapper as="pre">
      <NodeViewContent<'code'> as="code" />
    </NodeViewWrapper>
  )
}

/**
 * Extended CodeBlockShiki with React NodeView for mermaid/latex rendering.
 * Regular code blocks get Shiki syntax highlighting via decorations.
 */
export const tiptapCodeBlock = CodeBlockShiki.extend({
  // Official @tiptap/markdown integration for fenced code blocks.
  // Without this, markdown parsing in official mode can drop code fences.
  markdownTokenName: 'code',

  parseMarkdown: (token: { type?: string; lang?: string; text?: string }, _helpers: unknown) => ({
    type: 'codeBlock',
    attrs: {
      language: token.lang ?? null,
    },
    content: token.text
      ? [
          {
            type: 'text',
            text: token.text,
          },
        ]
      : [],
  }),

  renderMarkdown: (
    node: { attrs?: { language?: string | null }; content?: unknown[]; textContent?: string },
    helpers: { renderChildren: (content: unknown[]) => string }
  ) => {
    const language = node.attrs?.language ?? ''
    const code = node.textContent ?? helpers.renderChildren(node.content ?? [])
    const langPart = language ? String(language) : ''

    return `\`\`\`${langPart}\n${code}\n\`\`\``
  },

  addNodeView() {
    return ReactNodeViewRenderer(TiptapCodeBlockView)
  },
})
