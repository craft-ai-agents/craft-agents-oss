import type { LineComment } from '@/atoms/line-comments'

export interface LineCommentConfig {
  filePath: string
  onComment: (comment: LineComment) => void
}

/** Data attribute set on each line row element by LineAnnotatableViewer. */
export const LINE_ROW_ATTR = 'data-line-index'

/**
 * LineCommentExtension — self-contained DOM extension with no React dependency.
 *
 * Attaches to a container element rendered by LineAnnotatableViewer. Finds
 * line rows via [data-line-index] attributes, adds a floating `+` button on
 * hover, and inserts an inline annotation widget on click.
 *
 * Returns a cleanup function that removes all listeners and DOM nodes created
 * by the extension.
 */
export function LineCommentExtension(
  container: HTMLElement,
  config: LineCommentConfig,
): () => void {
  const { filePath, onComment } = config

  // The floating `+` button, reused across all lines.
  const plusBtn = document.createElement('button')
  plusBtn.type = 'button'
  plusBtn.textContent = '+'
  plusBtn.setAttribute('aria-label', 'Add line comment')
  applyPlusBtnStyles(plusBtn)

  let currentLineEl: HTMLElement | null = null
  let currentWidget: HTMLElement | null = null

  function getLineRow(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null
    const row = target.closest(`[${LINE_ROW_ATTR}]`)
    return row instanceof HTMLElement ? row : null
  }

  function showPlusBtn(lineEl: HTMLElement) {
    if (currentWidget) return // widget open — don't move the button
    currentLineEl = lineEl
    lineEl.appendChild(plusBtn)
    plusBtn.style.display = 'flex'
  }

  function hidePlusBtn() {
    if (plusBtn.parentElement) plusBtn.parentElement.removeChild(plusBtn)
    currentLineEl = null
  }

  function openWidget(lineEl: HTMLElement) {
    if (currentWidget) removeWidget()

    const lineIndex = parseInt(lineEl.getAttribute(LINE_ROW_ATTR) ?? '0', 10)
    const lineContentEl = lineEl.querySelector('[data-line-content]')
    const lineContent = (lineContentEl?.textContent ?? '').trim()

    const widget = document.createElement('div')
    applyWidgetStyles(widget)

    const textarea = document.createElement('textarea')
    applyTextareaStyles(textarea)
    textarea.placeholder = 'Add a comment…'

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;margin-top:6px;'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'
    applyActionBtnStyles(cancelBtn, false)

    const annotateBtn = document.createElement('button')
    annotateBtn.type = 'button'
    annotateBtn.textContent = 'Annotate'
    applyActionBtnStyles(annotateBtn, true)

    cancelBtn.addEventListener('click', () => removeWidget())

    annotateBtn.addEventListener('click', () => {
      const text = textarea.value.trim()
      if (!text) return
      onComment({
        filePath,
        lineNumber: lineIndex + 1,
        lineContent,
        text,
      })
      removeWidget()
    })

    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(annotateBtn)
    widget.appendChild(textarea)
    widget.appendChild(btnRow)

    lineEl.insertAdjacentElement('afterend', widget)
    currentWidget = widget
    hidePlusBtn()

    requestAnimationFrame(() => textarea.focus())
  }

  function removeWidget() {
    if (currentWidget?.parentElement) {
      currentWidget.parentElement.removeChild(currentWidget)
    }
    currentWidget = null
  }

  function handleMouseMove(e: MouseEvent) {
    const lineEl = getLineRow(e.target)
    if (!lineEl) {
      hidePlusBtn()
      return
    }
    if (lineEl !== currentLineEl) showPlusBtn(lineEl)
  }

  function handleMouseLeave() {
    hidePlusBtn()
  }

  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (currentLineEl) openWidget(currentLineEl)
  })

  container.addEventListener('mousemove', handleMouseMove)
  container.addEventListener('mouseleave', handleMouseLeave)

  return function cleanup() {
    container.removeEventListener('mousemove', handleMouseMove)
    container.removeEventListener('mouseleave', handleMouseLeave)
    hidePlusBtn()
    removeWidget()
  }
}

function applyPlusBtnStyles(el: HTMLElement) {
  el.style.cssText = [
    'position:absolute',
    'left:-28px',
    'top:50%',
    'transform:translateY(-50%)',
    'width:20px',
    'height:20px',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'border-radius:4px',
    'border:1px solid var(--border,#e0e0e0)',
    'background:var(--background,#fff)',
    'color:var(--foreground,#111)',
    'font-size:14px',
    'line-height:1',
    'cursor:pointer',
    'z-index:10',
    'padding:0',
    'user-select:none',
  ].join(';')
}

function applyWidgetStyles(el: HTMLElement) {
  el.style.cssText = [
    'display:block',
    'margin:4px 0',
    'padding:8px',
    'border:1px solid var(--border,#e0e0e0)',
    'border-radius:6px',
    'background:var(--background,#fff)',
    'z-index:20',
  ].join(';')
}

function applyTextareaStyles(el: HTMLTextAreaElement) {
  el.style.cssText = [
    'width:100%',
    'min-height:60px',
    'padding:6px 8px',
    'border:1px solid var(--border,#e0e0e0)',
    'border-radius:4px',
    'background:var(--background,#fff)',
    'color:var(--foreground,#111)',
    'font-size:12px',
    'font-family:inherit',
    'resize:vertical',
    'outline:none',
    'box-sizing:border-box',
  ].join(';')
}

function applyActionBtnStyles(el: HTMLElement, isPrimary: boolean) {
  el.style.cssText = [
    'padding:4px 10px',
    'border-radius:4px',
    'font-size:12px',
    'cursor:pointer',
    isPrimary
      ? 'background:var(--foreground,#111);color:var(--background,#fff);border:none;'
      : 'background:transparent;color:var(--foreground,#111);border:1px solid var(--border,#e0e0e0);',
  ].join(';')
}
