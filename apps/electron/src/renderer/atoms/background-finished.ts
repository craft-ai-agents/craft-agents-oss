/**
 * Jotai atom for the "background session finished" appearance preference.
 *
 * When a session running in the background finishes while the user is viewing a
 * different session, an in-app chip surfaces that completion in the chat input's
 * top-right corner — the in-app complement to the OS notification, which only
 * fires when the whole app is unfocused. This atom gates whether that chip is shown.
 *
 * It's an appearance *preference*, so it persists to localStorage via
 * `atomWithStorage` (same pattern as `kanbanLivePulseAtom` in `./kanban`) —
 * reactive, multi-window, no RPC/disk-config. The value is read reactively in two
 * places (the App-level completion detector and the chat-view render gate), which
 * is exactly what a persisted atom is for. Per-machine, not workspace-synced.
 *
 * The chip's transient runtime state — the queue of finished sessions plus its
 * push/dismiss action atoms — lives below the preference. The queue is a plain
 * (non-persisted) atom: a "you missed this" signal that should not survive a
 * reload.
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

/** Whether the in-app "background session finished" chip is shown. Default on. */
export const showBackgroundFinishedChipAtom = atomWithStorage<boolean>(
  'craft-show-background-finished-chip',
  true
)

export interface BackgroundFinishedEntry {
  /** The session that finished in the background. */
  sessionId: string
  /** Resolved display title at completion time (via `getSessionTitle`). */
  title: string
  /** Epoch ms the completion was observed — used to surface the most recent. */
  finishedAt: number
}

/** Transient queue of background completions awaiting acknowledgement. */
export const backgroundFinishedAtom = atom<BackgroundFinishedEntry[]>([])

/**
 * Push (or refresh) a background completion. Re-finishing the same session
 * replaces its prior entry and moves it to the most-recent (tail) position.
 */
export const pushBackgroundFinishedAtom = atom(
  null,
  (get, set, entry: BackgroundFinishedEntry) => {
    const next = get(backgroundFinishedAtom).filter(e => e.sessionId !== entry.sessionId)
    next.push(entry)
    set(backgroundFinishedAtom, next)
  }
)

/**
 * Remove a session's entry — used on navigate, manual dismiss, and whenever the
 * session is opened (a session on screen is never announced as "background").
 * No-ops when the session isn't queued, to avoid spurious re-renders.
 */
export const dismissBackgroundFinishedAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(backgroundFinishedAtom)
    const next = current.filter(e => e.sessionId !== sessionId)
    if (next.length !== current.length) {
      set(backgroundFinishedAtom, next)
    }
  }
)
