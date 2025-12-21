import type { ComponentEntry, CategoryGroup, Category } from './types'
import { onboardingComponents } from './onboarding'
import { agentSetupComponents } from './agent-setup'
import { chatComponents } from './chat'
import { turnCardComponents } from './turn-card'
import { messagesComponents } from './messages'
import { inputComponents } from './input'
import { markdownComponents } from './markdown'
import { iconComponents } from './icons'
import { settingsComponents } from './settings'

export * from './types'

export const componentRegistry: ComponentEntry[] = [
  ...onboardingComponents,
  ...agentSetupComponents,
  ...chatComponents,
  ...turnCardComponents,
  ...messagesComponents,
  ...inputComponents,
  ...markdownComponents,
  ...iconComponents,
  ...settingsComponents,
]

export function getCategories(): CategoryGroup[] {
  const categoryOrder: Category[] = ['Onboarding', 'Agent Setup', 'Chat', 'Chat Messages', 'Chat Inputs', 'Markdown', 'Icons', 'Settings']
  const categoryMap = new Map<Category, ComponentEntry[]>()

  for (const entry of componentRegistry) {
    const existing = categoryMap.get(entry.category) ?? []
    categoryMap.set(entry.category, [...existing, entry])
  }

  return categoryOrder
    .filter(name => categoryMap.has(name))
    .map(name => ({
      name,
      components: categoryMap.get(name)!,
    }))
}

export function getComponentById(id: string): ComponentEntry | undefined {
  return componentRegistry.find(c => c.id === id)
}
