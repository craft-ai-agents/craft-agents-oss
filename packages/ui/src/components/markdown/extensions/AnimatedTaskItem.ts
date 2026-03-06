import { getRenderedAttributes } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Custom TaskItem node view that keeps TipTap behavior but renders
 * an SVG checkmark path element so CSS can animate stroke-dashoffset.
 */
export const AnimatedTaskItem = TaskItem.extend({
  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement('li')
      const checkboxWrapper = document.createElement('label')
      const checkbox = document.createElement('input')
      const checkboxVisual = document.createElement('span')
      const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      const content = document.createElement('div')

      checkboxVisual.className = 'tiptap-task-checkbox-visual'
      checkSvg.setAttribute('class', 'tiptap-task-checkbox-svg')
      checkSvg.setAttribute('viewBox', '0 0 20 20')
      checkSvg.setAttribute('aria-hidden', 'true')

      // Based on Spell's check path geometry for a similar look.
      checkPath.setAttribute('d', 'M 0 4.5 L 3.182 8 L 10 0')
      checkPath.setAttribute('pathLength', '1')
      checkPath.setAttribute('fill', 'transparent')
      checkPath.setAttribute('stroke', 'currentColor')
      checkPath.setAttribute('stroke-width', '1.7')
      checkPath.setAttribute('stroke-linecap', 'round')
      checkPath.setAttribute('stroke-linejoin', 'round')
      checkPath.setAttribute('transform', 'translate(5 6)')
      checkPath.setAttribute('class', 'tiptap-task-checkbox-path')

      checkSvg.append(checkPath)
      checkboxVisual.append(checkSvg)

      const updateA11Y = (currentNode: ProseMirrorNode) => {
        checkbox.ariaLabel =
          this.options.a11y?.checkboxLabel?.(currentNode, checkbox.checked)
          || `Task item checkbox for ${currentNode.textContent || 'empty task item'}`
      }

      const applyCheckedState = (checked: boolean) => {
        listItem.dataset.checked = String(checked)
        checkbox.checked = checked
      }

      updateA11Y(node)

      checkboxWrapper.contentEditable = 'false'
      checkbox.type = 'checkbox'
      checkbox.addEventListener('mousedown', event => event.preventDefault())
      checkbox.addEventListener('change', event => {
        if (!editor.isEditable && !this.options.onReadOnlyChecked) {
          checkbox.checked = !checkbox.checked
          return
        }

        const { checked } = event.target as HTMLInputElement

        if (editor.isEditable && typeof getPos === 'function') {
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }) => {
              const position = getPos()

              if (typeof position !== 'number') return false
              const currentNode = tr.doc.nodeAt(position)

              tr.setNodeMarkup(position, undefined, {
                ...currentNode?.attrs,
                checked,
              })

              return true
            })
            .run()
        }

        if (!editor.isEditable && this.options.onReadOnlyChecked) {
          if (!this.options.onReadOnlyChecked(node, checked)) {
            checkbox.checked = !checkbox.checked
          }
        }
      })

      Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, String(value))
      })

      applyCheckedState(node.attrs.checked)

      checkboxWrapper.append(checkbox, checkboxVisual)
      listItem.append(checkboxWrapper, content)

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, String(value))
      })

      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes))

      return {
        dom: listItem,
        contentDOM: content,
        update: updatedNode => {
          if (updatedNode.type !== this.type) return false

          applyCheckedState(updatedNode.attrs.checked)
          updateA11Y(updatedNode)

          const extensionAttributes = editor.extensionManager.attributes
          const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes)
          const newKeys = new Set(Object.keys(newHTMLAttributes))
          const staticAttrs = this.options.HTMLAttributes

          prevRenderedAttributeKeys.forEach(key => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) listItem.setAttribute(key, String(staticAttrs[key]))
              else listItem.removeAttribute(key)
            }
          })

          Object.entries(newHTMLAttributes).forEach(([key, value]) => {
            if (value == null) {
              if (key in staticAttrs) listItem.setAttribute(key, String(staticAttrs[key]))
              else listItem.removeAttribute(key)
            } else {
              listItem.setAttribute(key, String(value))
            }
          })

          prevRenderedAttributeKeys = newKeys
          return true
        },
      }
    }
  },
})

export default AnimatedTaskItem
