/**
 * Sandbox capability atom — shared across components that render the
 * per-session sandbox toggle. Fetched once at app startup via the
 * `server:getSandboxCapability` RPC; the result is cached for the
 * process lifetime (the underlying probe is also cached server-side).
 */

import { atom } from 'jotai'
import type { SandboxCapability } from '@craft-agent/shared/agent'

/** `null` = not yet fetched. Renderers should treat null as "loading; assume unavailable" until populated. */
export const sandboxCapabilityAtom = atom<SandboxCapability | null>(null)
