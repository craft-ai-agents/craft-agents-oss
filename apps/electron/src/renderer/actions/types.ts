export type ActionScope = 'global' | 'session-list' | 'chat' | 'sidebar'

export interface ActionDefinition {
  id: string
  label: string
  description?: string
  defaultHotkey: string | null  // null = no default hotkey
  category: string
  scope?: ActionScope           // Default: 'global'
  inputSafe?: boolean           // If true, action fires even when focus is in INPUT/TEXTAREA
}

export type ActionId = keyof typeof import('./definitions').actions

export interface ActionHandler {
  actionId: ActionId
  handler: () => void
  enabled?: () => boolean
}
