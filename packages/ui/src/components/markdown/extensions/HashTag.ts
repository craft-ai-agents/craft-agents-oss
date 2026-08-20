import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const HASH_TAG_KEY = new PluginKey<DecorationSet>('hashTag')

export interface HashTagOptions {
  onTagClick?: (tag: string) => void
}

export const HashTag = Extension.create<HashTagOptions>({
  name: 'hashTag',

  addOptions() {
    return { onTagClick: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin({
        key: HASH_TAG_KEY,

        state: {
          init(_, state) {
            return buildDecorations(state)
          },
          apply(tr, old, _prev, newState) {
            if (!tr.docChanged) return old
            return buildDecorations(newState)
          },
        },

        props: {
          decorations(state) {
            return HASH_TAG_KEY.getState(state) ?? null
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null
              const el = target?.closest?.('[data-hash-tag]') as HTMLElement | null
              if (!el) return false
              const tag = el.getAttribute('data-hash-tag')
              if (!tag) return false
              event.preventDefault()
              options.onTagClick?.(tag)
              return true
            },
          },
        },
      }),
    ]
  },
})

interface TagMatch {
  start: number
  end: number
  tag: string
}

function findTagMatches(text: string): TagMatch[] {
  const matches: TagMatch[] = []
  // Word-boundary hashtags: #tag, #tag-name, #tag_name (not inside [[wiki#heading]])
  const re = /(^|[\s([{])#([^\s#\][.,;:!?)]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const prefix = m[1] ?? ''
    const tag = (m[2] ?? '').trim()
    if (!tag) continue
    const start = m.index + prefix.length
    const end = start + 1 + tag.length
    matches.push({ start, end, tag })
  }
  return matches
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []

  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    for (const { start, end, tag } of findTagMatches(text)) {
      const from = pos + start
      const to = pos + end
      decorations.push(
        Decoration.inline(from, to, {
          class: 'tiptap-hash-tag',
          'data-hash-tag': tag,
        }),
      )
    }
  })

  return DecorationSet.create(state.doc, decorations)
}
