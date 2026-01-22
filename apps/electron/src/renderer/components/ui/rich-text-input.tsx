import * as React from 'react'
import { cn } from '@/lib/utils'
import { findMentionMatches, parseMentions, type MentionMatch } from '@/lib/mentions'
import {
  loadSourceIcon,
  loadSkillIcon,
  getSourceIconSync,
  getSkillIconSync,
  EMOJI_ICON_PREFIX,
} from '@/lib/icon-cache'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'
import type { MentionItemType } from './mention-menu'

// ============================================================================
// Types
// ============================================================================

/** Line count threshold for auto-converting pasted text to file attachment */
const LONG_TEXT_LINE_THRESHOLD = 100

export interface RichTextInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onInput' | 'onPaste'> {
  /** Current text value */
  value: string
  /** Called when text changes */
  onChange: (value: string) => void
  /** Placeholder text(s) when empty - can be a single string or array for rotation */
  placeholder?: string | string[]
  /** Available skills for mention parsing */
  skills?: LoadedSkill[]
  /** Available sources for mention parsing */
  sources?: LoadedSource[]
  /** Workspace ID for avatars */
  workspaceId?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Called when input changes (provides value and cursor position for mention detection) */
  onInput?: (value: string, cursorPosition: number) => void
  /** Called on paste */
  onPaste?: (e: React.ClipboardEvent) => void
  /** Called when pasted text exceeds line threshold - should create file attachment */
  onLongTextPaste?: (text: string) => void
}

export interface RichTextInputHandle {
  focus: () => void
  blur: () => void
  /** The text value */
  value: string
  /** Selection start position in text model */
  selectionStart: number
  /** Set the text value */
  setValue: (value: string) => void
  /** Set selection range */
  setSelectionRange: (start: number, end: number) => void
  /** Get bounding rect for position calculations */
  getBoundingClientRect: () => DOMRect
  /** Get bounding rect of the current caret/selection position */
  getCaretRect: () => DOMRect | null
  /** The underlying div element */
  element: HTMLDivElement | null
}

// ============================================================================
// InlineMentionBadge - Compact badge for inline display (static HTML version)
// ============================================================================

// SVG icons as HTML strings (avoiding react-dom/server which doesn't work in browser)
const SKILL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`

const SOURCE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`

function renderBadgeHTML(
  type: MentionItemType,
  label: string,
  skill?: LoadedSkill,
  source?: LoadedSource,
  workspaceId?: string
): string {
  // Try to get cached icon first
  let iconHtml = ''
  let cachedIconUrl: string | null = null

  if (type === 'skill' && skill && workspaceId) {
    cachedIconUrl = getSkillIconSync(workspaceId, skill.slug)
  } else if (type === 'source' && source && workspaceId) {
    cachedIconUrl = getSourceIconSync(workspaceId, source.config.slug)
  }

  if (cachedIconUrl) {
    // Check for emoji marker - render as text, not image
    if (cachedIconUrl.startsWith(EMOJI_ICON_PREFIX)) {
      const emoji = cachedIconUrl.slice(EMOJI_ICON_PREFIX.length)
      iconHtml = `<span class="h-[12px] w-[12px] flex items-center justify-center text-[10px] leading-none shrink-0">${emoji}</span>`
    } else {
      // Use cached icon as img (data URL or external URL)
      iconHtml = `<img src="${cachedIconUrl}" class="h-[12px] w-[12px] rounded-[2px] shrink-0" alt="" />`
    }
  } else {
    // Fall back to generic SVG icon
    if (type === 'skill') {
      iconHtml = `<span class="h-[12px] w-[12px] rounded-[2px] bg-foreground/5 flex items-center justify-center text-foreground/50 shrink-0">${SKILL_ICON_SVG}</span>`
    } else if (type === 'source') {
      iconHtml = `<span class="h-[12px] w-[12px] rounded-[2px] bg-foreground/5 flex items-center justify-center text-foreground/50 shrink-0">${SOURCE_ICON_SVG}</span>`
    }
  }

  const escapedLabel = label.replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Line height is increased when badges are present (see hasMentions in component)
  // Use transform for upward shift - doesn't affect layout flow (works even at start of line)
  return `<span contenteditable="false" data-mention="true" class="mention-badge inline-flex items-center gap-1 h-[22px] px-1.5 mx-1 rounded-[5px] bg-background shadow-minimal text-[12px] text-foreground [&_*]:selection:bg-transparent selection:bg-transparent" style="vertical-align: middle; transform: translateY(-1px)">${iconHtml}<span class="truncate max-w-[200px]">${escapedLabel}</span></span>`
}

// ============================================================================
// Helper: Extract plain text from contenteditable
// ============================================================================

function getTextFromElement(element: HTMLElement): string {
  let text = ''

  // isTopLevel: true for direct children of the contenteditable root
  function processNode(node: Node, isTopLevel: boolean = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Filter out zero-width spaces (used for contenteditable cursor fix)
      text += (node.textContent || '').replace(/\u200B/g, '')
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement

      // Skip mention badges - they shouldn't contribute additional text
      if (el.getAttribute('data-mention') === 'true') {
        // Get the mention text from data attribute
        const mentionText = el.getAttribute('data-mention-text')
        if (mentionText) {
          text += mentionText
        }
        return // Don't process children
      }

      // Handle line breaks
      if (el.tagName === 'BR') {
        text += '\n'
      } else if (el.tagName === 'DIV' && text.length > 0 && !text.endsWith('\n')) {
        // DIVs in contenteditable normally represent line breaks.
        // HOWEVER: When typing before a badge at position 0, browsers wrap the
        // typed character in a <div>, creating: <div>typed</div><span badge>
        // This is NOT a user-intended line break - it's browser behavior.
        // We detect this by checking if a top-level DIV is immediately followed
        // by a mention badge sibling. If so, skip adding the newline.
        if (isTopLevel) {
          // Check if this DIV is followed by a mention badge at top level.
          // Skip over ZWS-only text nodes - browser may preserve them between
          // the DIV wrapper and the badge span.
          let nextSibling: Node | null = el.nextSibling
          while (
            nextSibling?.nodeType === Node.TEXT_NODE &&
            nextSibling.textContent?.replace(/\u200B/g, '') === ''
          ) {
            nextSibling = nextSibling.nextSibling
          }
          const isBrowserWrapper =
            (nextSibling as HTMLElement)?.getAttribute?.('data-mention') === 'true'
          if (!isBrowserWrapper) {
            text += '\n'
          }
          // If it IS followed by a badge, don't add newline - just process children
        } else {
          // Nested DIVs are always treated as line breaks
          text += '\n'
        }
      }

      // Process children (no longer top-level)
      Array.from(el.childNodes).forEach(child => {
        processNode(child, false)
      })
    }
  }

  // Process direct children as top-level nodes
  Array.from(element.childNodes).forEach(child => {
    processNode(child, true)
  })

  return text
}

// ============================================================================
// Helper: Get cursor position in text model
// ============================================================================

function getCursorPosition(element: HTMLElement, fallback: number = 0): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return fallback

  const range = selection.getRangeAt(0)

  // Create a range from start of element to cursor
  const preRange = document.createRange()
  preRange.selectNodeContents(element)
  preRange.setEnd(range.startContainer, range.startOffset)

  // Get text length before cursor, excluding badge content
  const fragment = preRange.cloneContents()
  const div = document.createElement('div')
  div.appendChild(fragment)
  return getTextFromElement(div).length
}

// ============================================================================
// Helper: Set cursor position in contenteditable
// ============================================================================

function setCursorPosition(element: HTMLElement, targetPosition: number): void {
  const selection = window.getSelection()
  if (!selection) return

  let currentPos = 0

  function findPosition(node: Node): { node: Node; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const rawText = node.textContent || ''
      // Filter out zero-width spaces to match text model (ZWS is a DOM-only artifact)
      const textWithoutZWS = rawText.replace(/\u200B/g, '')
      const modelLength = textWithoutZWS.length

      if (currentPos + modelLength >= targetPosition) {
        // Calculate actual DOM offset accounting for zero-width spaces
        const modelOffset = targetPosition - currentPos
        let domOffset = 0
        let modelCount = 0
        while (modelCount < modelOffset && domOffset < rawText.length) {
          if (rawText[domOffset] !== '\u200B') {
            modelCount++
          }
          domOffset++
        }
        // Skip any trailing ZWS at the target position
        while (domOffset < rawText.length && rawText[domOffset] === '\u200B') {
          domOffset++
        }
        return { node, offset: domOffset }
      }
      currentPos += modelLength
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement

      // Skip mention badge internals - treat as atomic
      if (el.getAttribute('data-mention') === 'true') {
        const mentionText = el.getAttribute('data-mention-text') || ''
        const mentionLength = mentionText.length
        if (currentPos + mentionLength >= targetPosition) {
          // Position cursor after the badge
          return { node: el.parentNode!, offset: Array.from(el.parentNode!.childNodes).indexOf(el) + 1 }
        }
        currentPos += mentionLength
        return null
      }

      // Handle BR
      if (el.tagName === 'BR') {
        currentPos += 1
        if (currentPos >= targetPosition) {
          return { node: el.parentNode!, offset: Array.from(el.parentNode!.childNodes).indexOf(el) + 1 }
        }
        return null
      }

      for (let i = 0; i < el.childNodes.length; i++) {
        const result = findPosition(el.childNodes[i])
        if (result) return result
      }
    }
    return null
  }

  const result = findPosition(element)

  if (result) {
    const range = document.createRange()
    range.setStart(result.node, result.offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    // Position at end
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

// ============================================================================
// Convert text with mentions to HTML
// ============================================================================

function textToHTML(
  text: string,
  skills: LoadedSkill[],
  sources: LoadedSource[],
  workspaceId?: string
): string {
  if (!text) return ''

  const skillSlugs = skills.map(s => s.slug)
  const sourceSlugs = sources.map(s => s.config.slug)
  const matches = findMentionMatches(text, skillSlugs, sourceSlugs)

  // Escape HTML in text
  const escapeHTML = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  if (matches.length === 0) {
    return escapeHTML(text)
  }

  let html = ''
  let lastIndex = 0

  // If first match starts at position 0, prepend zero-width space for contenteditable cursor fix
  if (matches[0].startIndex === 0) {
    html += '\u200B'
  }

  for (const match of matches) {
    // Add escaped text before this mention
    if (match.startIndex > lastIndex) {
      html += escapeHTML(text.slice(lastIndex, match.startIndex))
    }

    // Determine label and data for badge
    let label = match.id
    let skill: LoadedSkill | undefined
    let source: LoadedSource | undefined

    if (match.type === 'skill') {
      skill = skills.find(s => s.slug === match.id)
      label = skill?.metadata.name || match.id
    } else if (match.type === 'source') {
      source = sources.find(s => s.config.slug === match.id)
      label = source?.config.name || match.id
    }

    // Render badge with data-mention-text storing the original text
    const badgeHtml = renderBadgeHTML(match.type, label, skill, source, workspaceId)
    // Add data-mention-text attribute to store original text for extraction
    const withMentionText = badgeHtml.replace(
      'data-mention="true"',
      `data-mention="true" data-mention-text="${match.fullMatch.replace(/"/g, '&quot;')}"`
    )
    html += withMentionText

    lastIndex = match.startIndex + match.fullMatch.length
  }

  // Add remaining text after last mention
  if (lastIndex < text.length) {
    html += escapeHTML(text.slice(lastIndex))
  }

  return html
}

// ============================================================================
// Check if mentions have changed (for determining if we need to re-render HTML)
// ============================================================================

function getMentionSignature(text: string, skillSlugs: string[], sourceSlugs: string[]): string {
  const matches = findMentionMatches(text, skillSlugs, sourceSlugs)
  return matches.map(m => `${m.type}:${m.id}:${m.startIndex}`).join('|')
}

// ============================================================================
// RotatingPlaceholder Component
// Animated placeholder that cycles through an array of strings with fade transitions.
// Stays visible even when input is focused (until user types).
// ============================================================================

interface RotatingPlaceholderProps {
  /** Array of placeholder strings to rotate through */
  placeholders: string[]
  /** Interval in ms between rotations (default: 5000) */
  intervalMs?: number
  /** Additional className for styling */
  className?: string
}

function RotatingPlaceholder({
  placeholders,
  intervalMs = 5000,
  className,
}: RotatingPlaceholderProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [opacity, setOpacity] = React.useState(1)

  React.useEffect(() => {
    // Don't rotate if only one placeholder
    if (placeholders.length <= 1) return

    const interval = setInterval(() => {
      // Fade out
      setOpacity(0)

      // After fade out (300ms), swap text and fade back in
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % placeholders.length)
        setOpacity(1)
      }, 300)
    }, intervalMs)

    return () => clearInterval(interval)
  }, [placeholders.length, intervalMs])

  return (
    <div
      className={cn('transition-opacity duration-300 ease-in-out', className)}
      style={{ opacity }}
    >
      {placeholders[currentIndex]}
    </div>
  )
}

// ============================================================================
// RichTextInput Component
// ============================================================================

export const RichTextInput = React.forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(
    {
      value,
      onChange,
      placeholder = 'Type a message...',
      skills = [],
      sources = [],
      workspaceId,
      disabled = false,
      className,
      onFocus,
      onBlur,
      onKeyDown,
      onInput,
      onPaste,
      onLongTextPaste,
      ...restProps
    },
    forwardedRef
  ) {
    const divRef = React.useRef<HTMLDivElement>(null)
    const [isFocused, setIsFocused] = React.useState(false)
    const isComposing = React.useRef(false)
    const lastValueRef = React.useRef(value)
    const cursorPositionRef = React.useRef(0)
    const lastMentionSignatureRef = React.useRef('')
    const isInternalUpdate = React.useRef(false)
    // Pending cursor position to restore after external value update (e.g., after @mention selection)
    const pendingCursorRef = React.useRef<number | null>(null)

    const skillSlugs = React.useMemo(() => skills.map(s => s.slug), [skills])
    const sourceSlugs = React.useMemo(() => sources.map(s => s.config.slug), [sources])

    // Preload icons for sources and skills
    React.useEffect(() => {
      if (!workspaceId) return

      // Preload source icons
      for (const source of sources) {
        loadSourceIcon({ config: source.config, workspaceId })
      }

      // Preload skill icons
      for (const skill of skills) {
        if (skill.iconPath) {
          loadSkillIcon({ slug: skill.slug, iconPath: skill.iconPath }, workspaceId)
        }
      }
    }, [sources, skills, workspaceId])

    // Expose imperative handle
    React.useImperativeHandle(forwardedRef, () => ({
      focus: () => divRef.current?.focus(),
      blur: () => divRef.current?.blur(),
      get value() { return lastValueRef.current },
      get selectionStart() { return cursorPositionRef.current },
      setValue: (newValue: string) => {
        lastValueRef.current = newValue
      },
      setSelectionRange: (start: number, _end: number) => {
        // Store pending cursor for when external value sync runs
        pendingCursorRef.current = start
        cursorPositionRef.current = start
        if (divRef.current) {
          setCursorPosition(divRef.current, start)
        }
      },
      getBoundingClientRect: () => divRef.current?.getBoundingClientRect() ?? new DOMRect(),
      getCaretRect: () => {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return null
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        // If rect has zero dimensions (collapsed selection at line start), use a fallback
        if (rect.width === 0 && rect.height === 0 && rect.x === 0 && rect.y === 0) {
          // Insert a temporary span to measure position
          const span = document.createElement('span')
          span.textContent = '\u200B' // Zero-width space
          range.insertNode(span)
          const spanRect = span.getBoundingClientRect()
          span.remove()
          // Restore selection
          selection.removeAllRanges()
          selection.addRange(range)
          return spanRect
        }
        return rect
      },
      get element() { return divRef.current },
    }), [])

    // Handle input events
    const handleInput = React.useCallback(() => {
      if (isComposing.current) return
      if (!divRef.current) return

      const newText = getTextFromElement(divRef.current)
      const cursorPos = getCursorPosition(divRef.current, cursorPositionRef.current)

      lastValueRef.current = newText
      cursorPositionRef.current = cursorPos

      // Check if mentions changed - if so, we need to re-render HTML
      const newSignature = getMentionSignature(newText, skillSlugs, sourceSlugs)
      if (newSignature !== lastMentionSignatureRef.current) {
        lastMentionSignatureRef.current = newSignature
        // Re-render with badges
        isInternalUpdate.current = true
        const html = textToHTML(newText, skills, sources, workspaceId)
        divRef.current.innerHTML = html || '<br>' // Empty contenteditable needs a BR
        // Restore cursor
        setCursorPosition(divRef.current, cursorPos)
        isInternalUpdate.current = false
      }

      onChange(newText)
      onInput?.(newText, cursorPos)
    }, [onChange, onInput, skills, sources, skillSlugs, sourceSlugs, workspaceId])

    // Handle composition (IME)
    const handleCompositionStart = React.useCallback(() => {
      isComposing.current = true
    }, [])

    const handleCompositionEnd = React.useCallback(() => {
      isComposing.current = false
      handleInput()
    }, [handleInput])

    // Handle paste - delegate files to parent, manually insert plain text
    const handlePasteInternal = React.useCallback((e: React.ClipboardEvent) => {
      // Check if we have files - let parent handle that
      const hasFiles = e.clipboardData?.files && e.clipboardData.files.length > 0
      if (hasFiles && onPaste) {
        e.preventDefault()
        onPaste(e)
        return
      }

      // Prevent default to avoid HTML paste, then insert plain text manually
      e.preventDefault()

      const text = e.clipboardData?.getData('text/plain')
      if (!text) return

      // Check if text is too long - convert to file attachment instead
      const lineCount = text.split('\n').length
      if (lineCount > LONG_TEXT_LINE_THRESHOLD && onLongTextPaste) {
        onLongTextPaste(text)
        return
      }

      // Use Selection API to insert text at cursor position
      const selection = window.getSelection()
      if (!selection || !selection.rangeCount) return

      const range = selection.getRangeAt(0)
      range.deleteContents()

      const textNode = document.createTextNode(text)
      range.insertNode(textNode)

      // Move cursor to end of inserted text
      range.setStartAfter(textNode)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)

      // Trigger input event to update state
      if (divRef.current) {
        divRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }, [onPaste, onLongTextPaste])

    // Handle focus
    const handleFocus = React.useCallback((e: React.FocusEvent<HTMLDivElement>) => {
      setIsFocused(true)
      // Tell browser to use <br> instead of <div> for line breaks.
      // This prevents div-wrapping when typing before non-editable spans (badges).
      document.execCommand('defaultParagraphSeparator', false, 'br')
      onFocus?.(e)
    }, [onFocus])

    // Handle blur
    const handleBlur = React.useCallback((e: React.FocusEvent<HTMLDivElement>) => {
      setIsFocused(false)
      onBlur?.(e)
    }, [onBlur])

    // Sync value from props (when parent updates value externally)
    React.useEffect(() => {
      if (!divRef.current) return
      if (isInternalUpdate.current) return
      if (lastValueRef.current === value) return

      // External value change - update content
      lastValueRef.current = value
      lastMentionSignatureRef.current = getMentionSignature(value, skillSlugs, sourceSlugs)

      const html = textToHTML(value, skills, sources, workspaceId)
      divRef.current.innerHTML = html || '<br>'

      // Restore cursor position after innerHTML update.
      // Always restore if we have a pending position (from setSelectionRange call).
      // Otherwise restore to end of value.
      // Note: We restore even if not focused because focus can momentarily shift
      // during React re-renders, and we don't want cursor to reset to 0.
      const cursorPos = pendingCursorRef.current ?? value.length
      setCursorPosition(divRef.current, cursorPos)
      pendingCursorRef.current = null // Clear after use
    }, [value, skills, sources, skillSlugs, sourceSlugs, workspaceId])

    // Initialize content on mount
    React.useEffect(() => {
      if (!divRef.current) return
      lastMentionSignatureRef.current = getMentionSignature(value, skillSlugs, sourceSlugs)
      const html = textToHTML(value, skills, sources, workspaceId)
      divRef.current.innerHTML = html || '<br>'
      lastValueRef.current = value
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Handle selection changes to highlight badges when selected
    React.useEffect(() => {
      // Get selection color from CSS variable (accent with transparency)
      const getSelectionColor = () => {
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
        // Return accent color with 40% opacity
        return accent ? `oklch(${accent.replace('oklch(', '').replace(')', '')} / 0.4)` : 'rgba(99, 102, 241, 0.4)'
      }

      const handleSelectionChange = () => {
        if (!divRef.current) return

        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return

        const range = selection.getRangeAt(0)

        // Get all mention badges
        const badges = divRef.current.querySelectorAll('.mention-badge') as NodeListOf<HTMLElement>

        badges.forEach((badge) => {
          // Check if badge is within selection range
          const badgeRange = document.createRange()
          badgeRange.selectNode(badge)

          const isSelected =
            range.compareBoundaryPoints(Range.START_TO_END, badgeRange) > 0 &&
            range.compareBoundaryPoints(Range.END_TO_START, badgeRange) < 0

          if (isSelected) {
            badge.style.backgroundColor = getSelectionColor()
            badge.classList.remove('bg-background')
          } else {
            badge.style.backgroundColor = ''
            badge.classList.add('bg-background')
          }
        })
      }

      document.addEventListener('selectionchange', handleSelectionChange)
      return () => document.removeEventListener('selectionchange', handleSelectionChange)
    }, [])

    // Show placeholder when input is empty (regardless of focus state)
    const showPlaceholder = !value

    // Normalize placeholder to array for RotatingPlaceholder
    const placeholderArray = React.useMemo(() => {
      if (!placeholder) return ['Type a message...']
      return Array.isArray(placeholder) ? placeholder : [placeholder]
    }, [placeholder])

    // Check if value contains any mentions (badges) to adjust line height
    const hasMentions = React.useMemo(() => {
      const mentions = parseMentions(value, skillSlugs, sourceSlugs)
      return mentions.skills.length > 0 || mentions.sources.length > 0
    }, [value, skillSlugs, sourceSlugs])

    return (
      <div className="relative">
        <div
          ref={divRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          tabIndex={disabled ? -1 : 0}
          className={cn(
            'outline-none text-sm whitespace-pre-wrap break-words',
            'min-h-[1.5em]',
            disabled && 'opacity-50 cursor-not-allowed',
            // Make text transparent when showing placeholder (so caret is still visible)
            showPlaceholder && 'text-transparent caret-foreground',
            className
          )}
          // Use inline style for line-height to override text-sm's built-in line-height
          style={{ lineHeight: 1.25 }}
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPaste={handlePasteInternal}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          aria-disabled={disabled}
          aria-placeholder={Array.isArray(placeholder) ? placeholder[0] : placeholder}
          role="textbox"
          aria-multiline="true"
          {...restProps}
        />
        {/* Rotating placeholder overlay - visible when empty, even when focused */}
        {showPlaceholder && (
          <RotatingPlaceholder
            placeholders={placeholderArray}
            intervalMs={5000}
            className={cn(
              'absolute inset-0 text-sm text-muted-foreground pointer-events-none select-none',
              className
            )}
          />
        )}
      </div>
    )
  }
)
