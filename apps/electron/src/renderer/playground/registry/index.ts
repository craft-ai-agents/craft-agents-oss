import type { ComponentEntry, CategoryGroup, Category } from './types'
import { onboardingComponents } from './onboarding'
import { chatComponents } from './chat'
import { turnCardComponents, fullscreenOverlayComponents } from './turn-card'
import { messagesComponents } from './messages'
import { inputComponents } from './input'
import { slashCommandComponents } from './slash-command'
import { markdownComponents } from './markdown'
import { iconComponents } from './icons'

export * from './types'

export const componentRegistry: ComponentEntry[] = [
  ...onboardingComponents,
  ...chatComponents,
  ...turnCardComponents,
  ...fullscreenOverlayComponents,
  ...messagesComponents,
  ...inputComponents,
  ...slashCommandComponents,
  ...markdownComponents,
  ...iconComponents,
]

export function getCategories(): CategoryGroup[] {
  const categoryOrder: Category[] = ['Onboarding', 'Chat', 'Turn Cards', 'Fullscreen', 'Chat Messages', 'Chat Inputs', 'Markdown', 'Icons']
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
