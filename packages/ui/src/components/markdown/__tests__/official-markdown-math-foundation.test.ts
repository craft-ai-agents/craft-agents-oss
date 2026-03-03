import { describe, it, expect } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import {
  preprocessMarkdownForOfficial,
  postprocessMarkdownFromOfficial,
} from '../TiptapMarkdownEditor'
import { tiptapCodeBlock } from '../TiptapCodeBlockView'

describe('official markdown + mathematics foundation', () => {
  it('parses markdown content when contentType is markdown', () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown],
      content: '# Hello\n\n**World**',
      contentType: 'markdown',
    })

    const md = editor.getMarkdown()
    expect(md).toContain('# Hello')
    expect(md).toContain('**World**')

    editor.destroy()
  })

  it('normalizes one-line $$...$$ and protects currency ranges', () => {
    const source = 'Inline $$x$$, money $100, range $2M–$4M, formula $$E=mc^2$$'

    const normalized = preprocessMarkdownForOfficial(source)
    expect(normalized).toContain('Inline $x$')
    expect(normalized).toContain('money ¤100')
    expect(normalized).toContain('range ¤2M–¤4M')
    expect(normalized).toContain('formula $E=mc^2$')

    const restored = postprocessMarkdownFromOfficial(normalized)
    expect(restored).toContain('$100')
    expect(restored).toContain('$2M–$4M')
  })

  it('round-trips official math without inlineMath placeholder leakage', () => {
    const source = 'Inline $$x$$ and value $100 and range $2M–$4M.\n\n$$E=mc^2$$'
    const normalized = preprocessMarkdownForOfficial(source)

    const editor = new Editor({
      extensions: [
        StarterKit,
        Mathematics.configure({
          katexOptions: {
            throwOnError: false,
            strict: false,
          },
        }),
        Markdown,
      ],
      content: normalized,
      contentType: 'markdown',
    })

    const md = postprocessMarkdownFromOfficial(editor.getMarkdown())
    const json = editor.getJSON()

    expect(md).not.toContain('[inlineMath]')
    expect(md).toContain('$x$')
    expect(md).toContain('$100')
    expect(md).toContain('$2M–$4M')
    expect(md).toContain('E=mc^2')

    // Guardrails: ensure math nodes exist while currency range remains literal text.
    const jsonText = JSON.stringify(json)
    expect(jsonText).toContain('inlineMath')
    expect(jsonText).toContain('¤2M–¤4M')

    editor.destroy()
  })

  it('preserves fenced code blocks (including mermaid) with official markdown parser', () => {
    const source = [
      'before',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      'after',
    ].join('\n')

    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        tiptapCodeBlock,
        Markdown,
      ],
      content: source,
      contentType: 'markdown',
    })

    const json = editor.getJSON()
    const md = editor.getMarkdown()
    const jsonText = JSON.stringify(json)

    expect(jsonText).toContain('"type":"codeBlock"')
    expect(jsonText).toContain('"language":"mermaid"')
    expect(jsonText).toContain('"language":"ts"')
    expect(md).toContain('```mermaid')
    expect(md).toContain('graph TD')
    expect(md).toContain('```ts')
    expect(md).toContain('const x = 1')

    editor.destroy()
  })

  it('round-trips markdown images with alt, src, and title in official markdown mode', () => {
    const source = [
      'Before image',
      '',
      '![Planner board](https://picsum.photos/seed/planner-image-test/1200/600 "Planner Board")',
      '',
      'After image',
    ].join('\n')

    const editor = new Editor({
      extensions: [StarterKit, Image, Markdown],
      content: source,
      contentType: 'markdown',
    })

    const json = editor.getJSON()
    const md = editor.getMarkdown()
    const jsonText = JSON.stringify(json)

    expect(jsonText).toContain('"type":"image"')
    expect(jsonText).toContain('"src":"https://picsum.photos/seed/planner-image-test/1200/600"')
    expect(jsonText).toContain('"alt":"Planner board"')
    expect(jsonText).toContain('"title":"Planner Board"')
    expect(md).toContain('![Planner board](https://picsum.photos/seed/planner-image-test/1200/600 "Planner Board")')

    editor.destroy()
  })
})
