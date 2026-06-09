/**
 * SoundEventHandler — Subscribes to WorkspaceEventBus and plays sounds for agent events.
 *
 * Registered during AutomationSystem initialization (per-workspace).
 * Maps automation events to CESP sound categories and delegates to SoundEngine.
 *
 * NOTE: The primary wiring is done via SessionRuntimeHooks.onAutomationEvent
 * in the Electron app's main/index.ts. This module is kept as an alternative
 * subscription point for direct event bus attachment if needed.
 */

import type { EventBus, BaseEventPayload, AnyEventHandler } from '@craft-agent/shared/automations/event-bus'
import type { AutomationEvent } from '@craft-agent/shared/automations/types'
import { mapEventToCategory, type CespCategory } from '@craft-agent/shared/audio'
import { getSoundEngine } from './SoundEngine.js'

/**
 * Subscribe the sound handler to a workspace event bus.
 * Returns an unsubscribe function.
 */
export function subscribeSoundHandler(bus: EventBus): () => void {
  const handler: AnyEventHandler = (
    event: AutomationEvent,
    payload: BaseEventPayload,
  ) => {
    const category = mapEventToCategory(event)
    if (!category) return

    const engine = getSoundEngine()
    engine.play(category, payload.sessionId)
  }

  bus.onAny(handler)

  return () => {
    bus.offAny(handler)
  }
}
