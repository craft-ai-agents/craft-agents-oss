export const INLINE_EDIT_POPOVER_CONTEXT_KEYS = [
  'add-source',
  'add-source-api',
  'add-source-mcp',
  'add-source-local',
  'add-skill',
] as const

const INLINE_EDIT_POPOVER_CONTEXT_KEY_SET = new Set<string>(INLINE_EDIT_POPOVER_CONTEXT_KEYS)

export function usesInlineExecutionForEditPopoverContext(key: string): boolean {
  return INLINE_EDIT_POPOVER_CONTEXT_KEY_SET.has(key)
}
