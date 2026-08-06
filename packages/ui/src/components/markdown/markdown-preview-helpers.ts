/**
 * Pure helpers for MarkdownDocBlock.
 *
 * Extracted so we can unit-test the JSON-spec → preview-items normalization
 * without spinning up React. Component DOM behavior is covered by manual
 * Electron smoke (see plan).
 */

export interface MarkdownPreviewItem {
  src: string
  label?: string
}

export interface MarkdownPreviewSpec {
  src?: string
  title?: string
  items?: MarkdownPreviewItem[]
}

/**
 * Parse a `markdown-preview` JSON spec string.
 *
 * Returns `null` for invalid JSON or specs that lack both `src` and a non-empty
 * `items` array. Mirrors `MarkdownHtmlBlock`/`MarkdownPdfBlock` so the same
 * spec shape works across preview block types.
 */
export function parseMarkdownPreviewSpec(code: string): MarkdownPreviewSpec | null {
  let raw: unknown
  try {
    raw = JSON.parse(code)
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object') return null
  const spec = raw as Record<string, unknown>

  const itemsField = spec.items
  if (Array.isArray(itemsField) && itemsField.length > 0) {
    const items = itemsField.filter(
      (item): item is MarkdownPreviewItem =>
        !!item && typeof item === 'object' && typeof (item as { src?: unknown }).src === 'string' && (item as { src: string }).src.length > 0
    )
    if (items.length === 0) return null
    return {
      src: typeof spec.src === 'string' ? spec.src : undefined,
      title: typeof spec.title === 'string' ? spec.title : undefined,
      items,
    }
  }

  if (typeof spec.src === 'string' && spec.src.length > 0) {
    return {
      src: spec.src,
      title: typeof spec.title === 'string' ? spec.title : undefined,
    }
  }

  return null
}

/**
 * Normalize a spec to a flat array of items.
 *
 * Single-item specs (only `src`) are wrapped into a one-element array so the
 * rest of the component can iterate uniformly. If both fields are present,
 * `items` wins (matches sibling preview blocks).
 */
export function normalizePreviewItems(spec: MarkdownPreviewSpec | null): MarkdownPreviewItem[] {
  if (!spec) return []
  if (spec.items && spec.items.length > 0) return spec.items
  if (spec.src) return [{ src: spec.src }]
  return []
}
