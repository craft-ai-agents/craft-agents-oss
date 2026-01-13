/**
 * Tutorial Registry
 *
 * Central registry for all available tutorials.
 * Tutorials are registered at app startup and can be queried by ID.
 */

import type { TutorialDefinition } from './types'

/**
 * Map of tutorial ID to definition
 */
const tutorialRegistry = new Map<string, TutorialDefinition>()

/**
 * Register a tutorial definition.
 * Call this at app startup for each tutorial.
 */
export function registerTutorial(tutorial: TutorialDefinition): void {
  if (tutorialRegistry.has(tutorial.id)) {
    console.warn(`[Tutorial] Tutorial "${tutorial.id}" already registered, overwriting`)
  }
  tutorialRegistry.set(tutorial.id, tutorial)
}

/**
 * Get a tutorial by ID.
 * Returns undefined if not found.
 */
export function getTutorial(id: string): TutorialDefinition | undefined {
  return tutorialRegistry.get(id)
}

/**
 * Get all registered tutorials.
 */
export function getAllTutorials(): TutorialDefinition[] {
  return Array.from(tutorialRegistry.values())
}

/**
 * Check if a tutorial is registered.
 */
export function hasTutorial(id: string): boolean {
  return tutorialRegistry.has(id)
}

/**
 * Unregister a tutorial (for testing).
 */
export function unregisterTutorial(id: string): boolean {
  return tutorialRegistry.delete(id)
}

/**
 * Clear all registered tutorials (for testing).
 */
export function clearTutorials(): void {
  tutorialRegistry.clear()
}
