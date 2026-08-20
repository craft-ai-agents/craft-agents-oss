import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const WIKI_LINK_KEY = new PluginKey<DecorationSet>('wikiLink')

export interface WikiLinkOptions {
  onWikiLinkClick?: (target: string) => void
}

export const WikiLink = Extension.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return { onWikiLinkClick: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin({
        key: WIKI_LINK_KEY,

        state: {
          init(_, state) {
            return buildDecorations(state, options)
          },
          apply(tr, _old, _prev, newState) {
            if (!tr.docChanged && !tr.selectionSet) return _old
            return buildDecorations(newState, options)
          },
        },

        props: {
          decorations(state) {
            return WIKI_LINK_KEY.getState(state) ?? null
          },
        },
      }),
    ]
  },
})

interface WikiMatch {
  start: number
  end: number
  target: string
  display: string
}

function findWikiMatches(text: string): WikiMatch[] {
  const matches: WikiMatch[] = []
  const re = /\[\[([^\]\n|#]+?)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const target = (m[1] ?? '').trim()
    if (!target) continue
    const alias = m[2]?.trim()
    const display = alias || target.split('/').pop() || target
    matches.push({ start: m.index, end: m.index + m[0].length, target, display })
  }
  return matches
}

function buildDecorations(
  state: EditorState,
  options: WikiLinkOptions,
): DecorationSet {
  const decorations: Decoration[] = []
  const { from: cursorFrom, to: cursorTo } = state.selection

  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    for (const { start, end, target, display } of findWikiMatches(text)) {
      const from = pos + start
      const to = pos + end

      // When cursor is inside this link show raw text for editing
      const cursorInside = cursorFrom > from && cursorTo <= to
      if (cursorInside) {
        decorations.push(
          Decoration.inline(from, to, {
            class: 'tiptap-wiki-link tiptap-wiki-link--editing',
          })
        )
        continue
      }

      // Insert a visible display chip BEFORE the raw text
      const t = target
      const d = display
      decorations.push(
        Decoration.widget(from, () => {
          const span = document.createElement('span')
          span.className = 'tiptap-wiki-link'
          span.setAttribute('data-wiki-link', t)
          span.textContent = d
          span.addEventListener('mousedown', (e) => {
            e.preventDefault()
            options.onWikiLinkClick?.(t)
          })
          return span
        }, { key: `wiki:${from}:${target}`, side: -1 })
      )

      // Hide the raw [[...]] text
      decorations.push(
        Decoration.inline(from, to, {
          class: 'tiptap-wiki-link-raw',
        })
      )
    }
  })

  return DecorationSet.create(state.doc, decorations)
}
