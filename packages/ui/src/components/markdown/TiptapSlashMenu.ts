import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { NodeSelection, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { InlineMenuSurface } from '../ui/InlineMenuSurface'

export interface SlashCommandItem {
  id: string
  title: string
  description?: string
  icon: string
  group: 'Format' | 'Lists' | 'Blocks'
  aliases?: string[]
  run: (editor: Editor) => void
}

export const SlashCommandPluginKey = new PluginKey('tiptapSlashMenu')

export function isSlashSuggestionActive(editor: Editor): boolean {
  const pluginState = SlashCommandPluginKey.getState(editor.state) as
    | { active?: boolean; range?: { from: number; to: number } | null }
    | undefined

  return Boolean(pluginState?.active ?? pluginState?.range)
}

export function createSlashCommandItems(editor: Editor): SlashCommandItem[] {
  const canSetCodeBlock = editor.can().setCodeBlock()

  return [
    {
      id: 'paragraph',
      title: 'Text',
      description: 'Turn into a normal paragraph',
      icon: '¶',
      group: 'Format',
      aliases: ['paragraph', 'text', 'p'],
      run: (e) => {
        e.chain().focus().setParagraph().run()
      },
    },
    {
      id: 'heading-1',
      title: 'Heading 1',
      description: 'Large section heading',
      icon: 'H1',
      group: 'Format',
      aliases: ['h1', 'title', 'heading'],
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 1 }).run()
      },
    },
    {
      id: 'heading-2',
      title: 'Heading 2',
      description: 'Medium section heading',
      icon: 'H2',
      group: 'Format',
      aliases: ['h2', 'subtitle', 'heading'],
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 2 }).run()
      },
    },
    {
      id: 'heading-3',
      title: 'Heading 3',
      description: 'Small section heading',
      icon: 'H3',
      group: 'Format',
      aliases: ['h3', 'subheading', 'heading'],
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 3 }).run()
      },
    },
    {
      id: 'bullet-list',
      title: 'Bullet List',
      description: 'Create a bulleted list',
      icon: '•',
      group: 'Lists',
      aliases: ['ul', 'list', 'bullets'],
      run: (e) => {
        e.chain().focus().toggleBulletList().run()
      },
    },
    {
      id: 'ordered-list',
      title: 'Numbered List',
      description: 'Create an ordered list',
      icon: '1.',
      group: 'Lists',
      aliases: ['ol', 'list', 'numbers'],
      run: (e) => {
        e.chain().focus().toggleOrderedList().run()
      },
    },
    {
      id: 'blockquote',
      title: 'Quote',
      description: 'Insert a block quote',
      icon: '❝',
      group: 'Blocks',
      aliases: ['blockquote', 'quote', 'callout'],
      run: (e) => {
        e.chain().focus().toggleBlockquote().run()
      },
    },
    {
      id: 'horizontal-rule',
      title: 'Horizontal Rule',
      description: 'Insert a divider line',
      icon: '—',
      group: 'Blocks',
      aliases: ['hr', 'divider', 'line'],
      run: (e) => {
        e.chain().focus().setHorizontalRule().run()
      },
    },
    {
      id: 'code-block',
      title: 'Code Block',
      description: 'Insert a fenced code block',
      icon: '</>',
      group: 'Blocks',
      aliases: ['code', 'fence', 'snippet'],
      run: (e) => {
        e.chain().focus().toggleCodeBlock().run()
      },
    },
    {
      id: 'mermaid-code-block',
      title: 'Mermaid Diagram',
      description: 'Insert a mermaid code block',
      icon: '◇',
      group: 'Blocks',
      aliases: ['mermaid', 'diagram', 'flowchart'],
      run: (e) => {
        if (!canSetCodeBlock) return
        e.chain().focus().setCodeBlock({ language: 'mermaid' }).run()
      },
    },
    {
      id: 'latex-code-block',
      title: 'LaTeX Block',
      description: 'Insert a latex math block',
      icon: '∑',
      group: 'Blocks',
      aliases: ['latex', 'math', 'tex', 'katex'],
      run: (e) => {
        if (!canSetCodeBlock) return
        e.chain().focus().setCodeBlock({ language: 'latex' }).run()
      },
    },
  ]
}

export function filterSlashCommandItems(items: SlashCommandItem[], query: string): SlashCommandItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return items

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(normalized)) return true
    if (item.description?.toLowerCase().includes(normalized)) return true
    return item.aliases?.some((alias) => alias.toLowerCase().includes(normalized)) ?? false
  })
}

function getRectFromClientRect(clientRect?: (() => DOMRect | null) | null): DOMRect | null {
  if (!clientRect) return null
  return clientRect()
}

function renderMenuItems(container: HTMLElement, items: SlashCommandItem[], selectedIndex: number) {
  const grouped = new Map<string, SlashCommandItem[]>()
  for (const item of items) {
    const existing = grouped.get(item.group)
    if (existing) {
      existing.push(item)
    } else {
      grouped.set(item.group, [item])
    }
  }

  container.innerHTML = ''

  if (items.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'tiptap-slash-empty'
    empty.textContent = 'No commands found'
    container.appendChild(empty)
    return
  }

  let itemIndex = 0
  for (const [groupName, groupItems] of grouped) {
    const group = document.createElement('div')
    group.className = 'tiptap-slash-group'

    const label = document.createElement('div')
    label.className = 'tiptap-slash-group-label'
    label.textContent = groupName
    group.appendChild(label)

    for (const item of groupItems) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = `tiptap-slash-item${itemIndex === selectedIndex ? ' is-selected' : ''}`
      row.dataset.index = String(itemIndex)

      const icon = document.createElement('div')
      icon.className = 'tiptap-slash-item-icon'
      icon.textContent = item.icon

      const title = document.createElement('div')
      title.className = 'tiptap-slash-item-title'
      title.textContent = item.title

      row.appendChild(icon)
      row.appendChild(title)
      group.appendChild(row)
      itemIndex += 1
    }

    container.appendChild(group)
  }
}

class SlashMenuView {
  private props: SuggestionProps<SlashCommandItem>

  private surface: InlineMenuSurface<SlashCommandItem>

  constructor(props: SuggestionProps<SlashCommandItem>) {
    this.props = props

    this.surface = new InlineMenuSurface<SlashCommandItem>({
      className: 'tiptap-slash-menu popover-styled',
      onSelect: (item) => {
        this.props.command(item)
      },
      render: (container, items, selectedIndex) => {
        renderMenuItems(container, items, selectedIndex)
      },
    })

    this.surface.mount()
    this.surface.update(props.items, 0)
    this.setPosition(props)
  }

  update(props: SuggestionProps<SlashCommandItem>) {
    this.props = props
    this.surface.update(props.items)
    this.setPosition(props)
  }

  onKeyDown(props: SuggestionKeyDownProps): boolean {
    if (props.event.key === 'Escape') {
      this.destroy()
      return true
    }

    if (props.event.key === 'ArrowDown') {
      this.surface.moveSelection(1)
      return true
    }

    if (props.event.key === 'ArrowUp') {
      this.surface.moveSelection(-1)
      return true
    }

    if (props.event.key === 'Enter') {
      const item = this.surface.getSelectedItem()
      if (!item) return true
      this.props.command(item)
      return true
    }

    return false
  }

  private setPosition(props: SuggestionProps<SlashCommandItem>) {
    const rect = getRectFromClientRect(props.clientRect)
    if (!rect) return

    this.surface.setPosition(rect.bottom + 8, rect.left)
  }

  destroy() {
    this.surface.destroy()
  }
}

export const TiptapSlashMenu = Extension.create({
  name: 'tiptapSlashMenu',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        pluginKey: SlashCommandPluginKey,
        char: '/',
        startOfLine: false,
        allowedPrefixes: null,
        allowSpaces: true,
        items: ({ editor, query }) => {
          const items = createSlashCommandItems(editor)
          return filterSlashCommandItems(items, query)
        },
        allow: ({ editor, state }) => {
          const { selection } = state

          if (!selection.empty) return false
          if (selection instanceof NodeSelection) return false
          if (editor.isActive('codeBlock')) return false
          if (editor.isActive('code')) return false

          return true
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run()
          props.run(editor)
        },
        render: () => {
          let menu: SlashMenuView | null = null

          return {
            onStart: (props) => {
              menu = new SlashMenuView(props)
            },
            onUpdate: (props) => {
              menu?.update(props)
            },
            onKeyDown: (props) => {
              return menu?.onKeyDown(props) ?? false
            },
            onExit: () => {
              menu?.destroy()
              menu = null
            },
          }
        },
      }),
    ]
  },
})
