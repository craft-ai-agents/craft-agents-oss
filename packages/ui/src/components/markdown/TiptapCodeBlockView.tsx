import * as React from 'react'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import CodeBlockShiki from 'tiptap-extension-code-block-shiki'
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
 */
function TiptapCodeBlockView({ node }: { node: { attrs: { language?: string }; textContent: string } }) {
  const language = node.attrs.language

  if (language === 'mermaid') {
    return (
      <NodeViewWrapper contentEditable={false} className="tiptap-mermaid-block">
        <MarkdownMermaidBlock code={node.textContent} showExpandButton={false} />
      </NodeViewWrapper>
    )
  }

  if (language === 'latex' || language === 'math') {
    return (
      <NodeViewWrapper contentEditable={false} className="tiptap-latex-block">
        <MarkdownLatexBlock code={node.textContent} />
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
  addNodeView() {
    return ReactNodeViewRenderer(TiptapCodeBlockView)
  },
})
