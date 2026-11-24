/**
 * Crafty (spike): the contract between the main-process controller (`main/crafty/`), the preload
 * (`window.electronAPI.crafty`) and the Crafty window (`renderer/crafty/`).
 *
 * Everything travels over direct IPC with `invoke`. Main never pushes into the window: the window
 * pulls its events with a long poll (`crafty:nextEvent`), so no raw `webContents.send` is needed.
 * Coordinates are DIP; inside the window they are relative to the window's top-left corner.
 */

import type { FileAttachment } from '@craft-agent/shared/protocol'
import type { ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import type { CraftyDoubleTap, CraftyOpenWith } from '@craft-agent/shared/config'

export type { CraftyDoubleTap, CraftyOpenWith }

export const CRAFTY_SHORTCUT = 'Control+Alt+Space'

/** What a trigger opens: the pie, or the panel (Settings → Crafty → Opens). */
export type CraftySurface = CraftyOpenWith

/**
 * What opened Crafty. Both are held down when Crafty opens: a double-tap's second press reports
 * its release (`trigger-release`), while ⌃⌥Space's release only shows in the window's own key and
 * pointer events (once the window is key).
 */
export type CraftyTriggerSource = 'double-tap' | 'shortcut'

export interface CraftyPoint {
  x: number
  y: number
}

export interface CraftyRect {
  x: number
  y: number
  width: number
  height: number
}

/** How the selection was read: the Accessibility API, the ⌘C fallback, or nothing. */
export type CraftyCaptureMethod = 'accessibility' | 'clipboard' | 'none' | 'other'

export interface CraftySelection {
  text: string
  method: CraftyCaptureMethod
  /** selection-hook's raw `SelectionMethod` and `PositionLevel`, kept for the report. */
  rawMethod: number
  posLevel: number
  /** The selection's bounds in window coordinates, when the app reported them. */
  bounds: CraftyRect | null
  programName: string
  isFullscreen?: boolean
}

export interface CraftySelectionResult {
  selection: CraftySelection | null
  /** The whole read, measured in the native host: Accessibility, then any ⌘C fallback. */
  latencyMs: number
  /** The ⌘C fallback, when Accessibility found nothing and it ran (for the measurements). */
  copy?: { posted: boolean; copied: boolean; restored: boolean; ms: number } | null
  error?: string
}

/** Where the capture came from. Filled by JXA (`osascript`), so it arrives after the selection. */
export interface CraftyProvenance {
  pid: number | null
  bundleId: string | null
  appName: string | null
  windowTitle: string | null
  /** The browser's current URL (Safari and Chromium browsers, via Apple Events). */
  url: string | null
  /** Why the window title or URL is missing, e.g. no Accessibility grant or a refused Apple Event. */
  notes: string[]
  latencyMs: number
  /** A browser's URL is still being asked for: another provenance event follows, with it or a note. */
  urlPending?: boolean
}

export interface CraftyRecentScreenshot {
  path: string
  name: string
  ageSeconds: number
}

/** The session Crafty sends to ("Send Crafty here"). None means a new session for each question. */
export interface CraftyTargetRef {
  workspaceId: string
  sessionId: string
}

/** What Craft's windows show: whether Crafty is switched on, and its target while it is. */
export interface CraftyTargetState {
  enabled: boolean
  /** Null while Crafty is off, even with a stored target. */
  target: CraftyTargetRef | null
}

/** A session Crafty can send to: the target, and the rows of the panel's target menu. */
export interface CraftySessionSummary extends CraftyTargetRef {
  /** The session's title; null until it has one. */
  name: string | null
  /** The start of the last message, for a session without a title. */
  preview: string | null
  lastMessageAt: number | null
  /** A turn is running: a message sent now is queued or steered into it. */
  isProcessing: boolean
  llmConnection?: string
  model?: string
  thinkingLevel?: ThinkingLevel
}

export interface CraftyInvocation {
  id: string
  /** `Date.now()` in main when the shortcut fired; the window reports its first frame against it. */
  at: number
  /** The target's workspace when there is a target, else the last focused Craft window's. */
  workspaceId: string | null
  /** Where the question goes; null for a new session. Checked at the shortcut (archived → null). */
  target: CraftySessionSummary | null
  cursor: CraftyPoint
  windowSize: { width: number; height: number }
  /** True when the window had to reload for another workspace, which delays the first frame. */
  reloaded: boolean
  /** Whether macOS lets Craft read selections and type into apps (Accessibility), at the shortcut. */
  accessibility: boolean
  /** See `CraftyStatus.packaged`. */
  packaged: boolean
  surface: CraftySurface
  trigger: CraftyTriggerSource
  /** For the pie's Translate (BCP 47): your recent picks, then macOS's preferred languages. */
  languages: string[]
}

export type CraftyFollowStrategy = 'off' | 'poll' | 'mousemove'

export type CraftyEvent =
  | { type: 'invoke'; invocation: CraftyInvocation }
  | { type: 'selection'; invocationId: string; result: CraftySelectionResult }
  /** Sent once the frontmost app is known, and again when a browser's URL arrives (or fails). */
  | { type: 'provenance'; invocationId: string; provenance: CraftyProvenance; recentScreenshot: CraftyRecentScreenshot | null }
  /** Main wants the window gone (shortcut pressed again); the window animates out, then calls hide. */
  | { type: 'dismiss'; reason: string }
  /** The follow strategy changed (in Settings): track the pointer with it, or stop. */
  | { type: 'follow'; strategy: CraftyFollowStrategy }
  /** The target changed (a session's menu in Craft, or it was archived); the panel updates its chip. */
  | { type: 'target'; target: CraftySessionSummary | null }
  /**
   * The double-tap's second press ended. `interrupted`: a key press or click came while it was
   * held, so it was a ⌘ shortcut (tap ⌘, then ⌘C), not the pie. Never sent before the `invoke`.
   */
  | { type: 'trigger-release'; invocationId: string; heldMs: number; interrupted: boolean }
  /** Whether the source app's focused element takes text: Replace, or only Copy. After provenance. */
  | { type: 'editable'; invocationId: string; editable: boolean }

export type CraftyPermissionKind = 'accessibility' | 'screen' | 'automation'

export interface CraftyStatus {
  /** macOS only. */
  supported: boolean
  enabled: boolean
  running: boolean
  shortcut: string
  shortcutRegistered: boolean
  accessibility: boolean
  /** `systemPreferences.getMediaAccessStatus('screen')`. */
  screenRecording: string
  /**
   * False for a dev build. macOS gives a process the permissions of the app that launched it, so a
   * dev build started from a terminal has the terminal's grants, not Craft Agents'.
   */
  packaged: boolean
  /** Spike item 3: keep the companion next to the pointer while the panel is closed, and how to track it. */
  follow: CraftyFollowStrategy
  /** The session Crafty sends to, as stored (checked again at each shortcut). */
  target: CraftyTargetRef | null
  /** Where the spike writes its measurements. */
  metricsPath: string | null
  /** Why Crafty can't run here (thin-client mode, another platform). */
  unavailableReason?: string
  doubleTap: CraftyDoubleTap
  openWith: CraftyOpenWith
  /** The double-tap's tap: whether it runs, and why not (no Accessibility, the addon is missing). */
  doubleTapRunning: boolean
  doubleTapProblem?: 'accessibility' | 'unavailable'
}

export type CraftyInsertMode = 'auto' | 'type' | 'paste'

export interface CraftyInsertRequest {
  invocationId: string
  text: string
  mode: CraftyInsertMode
  /** Show the window again afterwards (click-through, not key), for a notice by the cursor. */
  confirm?: boolean
}

export interface CraftyInsertResult {
  ok: boolean
  mode: 'type' | 'paste'
  error?: string
  /** Whether the source app was still frontmost, or had to be re-activated. */
  reactivated?: boolean
  clipboardRestored?: boolean
  durationMs: number
}

export interface CraftyScreenshot {
  path: string
  name: string
  /** A 160 px wide data URL for the chip. */
  thumbnailDataUrl: string
  /** Ready for `storeAttachment` / `sendMessage`. Built in main, so the window never reads paths. */
  attachment: FileAttachment
}

/** A session's connection, model and thinking level, as picked in the panel's model menu. */
export interface CraftySessionModel {
  llmConnection?: string
  model?: string
  thinkingLevel?: ThinkingLevel
}

/** The new session, with the connection, model and thinking level it got (defaults resolved). */
export interface CraftyCreateSessionResult extends CraftySessionModel {
  sessionId: string
  workspaceId: string
}

export type CraftyRewriteStyle = 'improve' | 'shorter' | 'friendlier' | 'formal' | 'fix'

export const CRAFTY_REWRITE_STYLES: readonly CraftyRewriteStyle[] = ['improve', 'shorter', 'friendlier', 'formal', 'fix']

/** Longest selection a one-shot takes: about a long email. */
export const CRAFTY_TRANSFORM_MAX_CHARS = 20_000

/** A one-shot change of the selection (the pie's Rewrite and Translate). */
export type CraftyTransform =
  | { kind: 'rewrite'; style: CraftyRewriteStyle }
  /** `language`: an English language name, e.g. "Hungarian". */
  | { kind: 'translate'; language: string }

export interface CraftyTransformRequest {
  invocationId: string
  transform: CraftyTransform
  text: string
  /** The connection to use (the panel's pick); unset takes the workspace's default. */
  model?: CraftySessionModel
  /** A Translate's language as a BCP 47 code: once it worked, it leads the next sub-pie. */
  languageCode?: string
}

export interface CraftyTransformResult {
  text: string
  durationMs: number
}

/** A measurement from the window (first frame, follow rate, …), appended to the spike's JSONL. */
export interface CraftyMetric {
  kind: string
  invocationId?: string
  [key: string]: unknown
}

/** `window.electronAPI.crafty` (Electron only). The window-only calls are refused for other windows. */
export interface CraftyApi {
  // Any window (Settings)
  getStatus(): Promise<CraftyStatus>
  setEnabled(enabled: boolean): Promise<CraftyStatus>
  openPermissionSettings(kind: CraftyPermissionKind): Promise<void>
  requestAccessibility(): Promise<boolean>
  setFollow(strategy: CraftyFollowStrategy): Promise<void>
  /**
   * "Send Crafty here" (a session's menu, the panel's target menu), or null for a new session each
   * time. Rejects a session that can't take it (archived, hidden, in a remote workspace, not found).
   */
  setTarget(target: CraftyTargetRef | null): Promise<CraftyTargetRef | null>
  /** Craft's windows follow the target (the session menu's item, the composer's Crafty chip). */
  onTargetChanged(callback: (state: CraftyTargetState) => void): () => void
  setDoubleTap(value: CraftyDoubleTap): Promise<CraftyStatus>
  setOpenWith(value: CraftyOpenWith): Promise<CraftyStatus>

  // Crafty window only
  nextEvent(): Promise<CraftyEvent>
  cursor(): Promise<CraftyPoint>
  setInteractive(interactive: boolean): Promise<void>
  focusPanel(invocationId: string): Promise<void>
  hide(reason: string): Promise<void>
  /** Unset fields take the workspace's defaults, like any new session. */
  createSession(invocationId: string, model?: CraftySessionModel): Promise<CraftyCreateSessionResult>
  /** The invocation's workspace sessions for the target menu, most recent first. */
  listSessions(invocationId: string): Promise<CraftySessionSummary[]>
  insert(request: CraftyInsertRequest): Promise<CraftyInsertResult>
  captureRegion(invocationId: string): Promise<CraftyScreenshot | null>
  /** The recent screenshot the invocation offered (with its `provenance` event). */
  useRecentScreenshot(invocationId: string): Promise<CraftyScreenshot | null>
  openInCraft(workspaceId: string, sessionId: string): Promise<void>
  /** Craft Agents itself, as you left it (the pie hub's Craft mark): Crafty hides, Craft comes forward. */
  openCraft(invocationId: string): Promise<void>
  metric(metric: CraftyMetric): Promise<void>
  /** Move the pointer to a point in the window (the pie moved in from an edge). */
  warp(invocationId: string, point: CraftyPoint): Promise<boolean>
  /**
   * Give the keyboard back to the app underneath and stay up, click-through: a notice after the
   * pie (Send to). The next trigger opens a new invocation; `hide` takes the notice down.
   */
  resignKey(invocationId: string): Promise<void>
  /** Rewrite or translate the selection: one completion, outside any session. */
  transform(request: CraftyTransformRequest): Promise<CraftyTransformResult>
}
