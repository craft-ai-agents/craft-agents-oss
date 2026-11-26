/**
 * What the pie offers: the eight fixed slots, their sub-pies, and whether each can run on this
 * capture. Pure, so it can be tested. A slot that doesn't apply is dimmed with a reason, never
 * removed or moved, so every slot keeps its direction.
 */

import {
  AlignLeft,
  Briefcase,
  Camera,
  Crosshair,
  Languages,
  Lightbulb,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Plus,
  Reply,
  Shrink,
  Smile,
  Sparkles,
  SpellCheck,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import {
  CRAFTY_REWRITE_STYLES,
  CRAFTY_TRANSFORM_MAX_CHARS,
  type CraftyProvenance,
  type CraftyRewriteStyle,
  type CraftySelectionResult,
  type CraftySessionSummary,
  type CraftyTransform,
} from '../../../shared/crafty'
import { sourceAppName } from '../context'
import { newSessionLabel, sessionTitle } from '../target'
import type { TranslateLanguage } from './languages'

export type PresetSlot = 'summarize' | 'explain' | 'reply'

/** What a pick runs; `CraftyApp` carries it out. */
export type PieAction =
  /** The panel, with what you typed into the pie. */
  | { kind: 'ask'; text: string }
  /** The panel, sending a preset question at once. */
  | { kind: 'question'; slot: PresetSlot }
  | { kind: 'screenshot' }
  /** A one-shot outside any session, shown as a preview that ↵ puts in place of the selection. */
  | { kind: 'transform'; transform: CraftyTransform; title: string; languageCode?: string }
  /** The capture as a message to a session; null for a new one. */
  | { kind: 'send'; session: CraftySessionSummary | null }
  /** Craft Agents itself: a click on the hub's Craft mark. */
  | { kind: 'open-craft' }
  /** macOS's Accessibility prompt and pane: a click on the hub while the selection can't be read. */
  | { kind: 'allow-accessibility' }

export type PieSub = 'rewrite' | 'translate' | 'send'

export type Availability =
  | { state: 'ready' }
  /**
   * Waiting for the capture; a pick waits for it too. `what` is what the hub says meanwhile, `late`
   * why the pick can't run if the wait runs out.
   */
  | { state: 'pending'; what: string; late: string }
  | { state: 'off'; reason: string }

export interface PieItem {
  id: string
  label: string
  icon?: LucideIcon
  /** Short text drawn instead of an icon: a language's code. */
  glyph?: string
  /** What a pick does: run an action, open a sub-pie (▸), or go back to the main pie. */
  action?: PieAction
  sub?: PieSub
  back?: boolean
  availability: Availability
}

export interface PieCapture {
  /** Null while the selection is being read. */
  selection: CraftySelectionResult | null
  /** Null until the frontmost app is known. */
  provenance: CraftyProvenance | null
  /** Whether Craft had Accessibility at the trigger. */
  accessibility: boolean
  recentScreenshot: boolean
  /** The sessions Send to lists; null while they load. */
  sessions: CraftySessionSummary[] | null
}

const READY: Availability = { state: 'ready' }
const READING: Availability = { state: 'pending', what: 'Reading the selection…', late: 'The selection didn\'t arrive' }
const NEEDS_ACCESSIBILITY = 'Needs Accessibility access'
/** The hub's words while a click on it opens Accessibility's settings (`HubWords.click`). */
const ALLOW_ACCESSIBILITY = 'Click to allow Accessibility'

/** A sub-pie holds at most this many items, plus Back. */
export const SUB_PIE_MAX = 7

export function selectedText(capture: Pick<PieCapture, 'selection'>): string {
  return capture.selection?.selection?.text ?? ''
}

function hasText(capture: PieCapture): boolean {
  return selectedText(capture).trim().length > 0
}

function noTextReason(capture: PieCapture): string {
  if (!capture.accessibility) return NEEDS_ACCESSIBILITY
  if (capture.selection?.error) return 'Couldn\'t read the selection'
  return 'Select text first'
}

function needsText(capture: PieCapture): Availability {
  if (capture.selection === null) return READING
  return hasText(capture) ? READY : { state: 'off', reason: noTextReason(capture) }
}

function oneShot(capture: PieCapture): Availability {
  const text = needsText(capture)
  if (text.state !== 'ready') return text
  return selectedText(capture).length > CRAFTY_TRANSFORM_MAX_CHARS
    ? { state: 'off', reason: `Over ${CRAFTY_TRANSFORM_MAX_CHARS.toLocaleString('en-US')} characters` }
    : READY
}

/** The selection, or without one the browser's page (its URL goes along). */
function summarize(capture: PieCapture): Availability {
  if (capture.selection === null) return READING
  if (hasText(capture)) return READY
  if (!capture.provenance) return READING
  if (capture.provenance.urlPending) return { state: 'pending', what: 'Asking the browser for the page…', late: 'The browser didn\'t say which page' }
  if (capture.provenance.url) return READY
  // Selecting text only helps when it can be read
  return { state: 'off', reason: capture.accessibility && !capture.selection.error ? 'Select text or open a web page' : noTextReason(capture) }
}

/** The selection, or without one the recent screenshot (which arrives with the provenance). */
function send(capture: PieCapture): Availability {
  if (capture.selection === null) return READING
  if (!hasText(capture)) {
    if (!capture.provenance) return READING
    if (!capture.recentScreenshot) return { state: 'off', reason: noTextReason(capture) }
  }
  return capture.sessions === null ? { state: 'pending', what: 'Loading sessions…', late: 'Couldn\'t load sessions' } : READY
}

/** Clockwise from the top. Up, down, left and right are the easiest flicks: the most used actions. */
export function mainItems(capture: PieCapture): PieItem[] {
  const text = needsText(capture)
  const transform = oneShot(capture)
  return [
    { id: 'ask', label: 'Ask', icon: MessageSquare, action: { kind: 'ask', text: '' }, availability: READY },
    { id: 'rewrite', label: 'Rewrite', icon: PenLine, sub: 'rewrite', availability: transform },
    { id: 'summarize', label: 'Summarize', icon: AlignLeft, action: { kind: 'question', slot: 'summarize' }, availability: summarize(capture) },
    { id: 'translate', label: 'Translate', icon: Languages, sub: 'translate', availability: transform },
    { id: 'reply', label: 'Reply', icon: Reply, action: { kind: 'question', slot: 'reply' }, availability: text },
    { id: 'screenshot', label: 'Screenshot', icon: Camera, action: { kind: 'screenshot' }, availability: READY },
    { id: 'explain', label: 'Explain', icon: Lightbulb, action: { kind: 'question', slot: 'explain' }, availability: text },
    { id: 'send', label: 'Send to', icon: MessageSquarePlus, sub: 'send', availability: send(capture) },
  ]
}

const REWRITES: Record<CraftyRewriteStyle, { label: string; icon: LucideIcon }> = {
  improve: { label: 'Improve', icon: Sparkles },
  shorter: { label: 'Shorter', icon: Shrink },
  friendlier: { label: 'Friendlier', icon: Smile },
  formal: { label: 'More formal', icon: Briefcase },
  fix: { label: 'Fix spelling', icon: SpellCheck },
}

export function rewriteItems(): PieItem[] {
  return CRAFTY_REWRITE_STYLES.map(style => ({
    id: `rewrite:${style}`,
    label: REWRITES[style].label,
    icon: REWRITES[style].icon,
    action: { kind: 'transform', transform: { kind: 'rewrite', style }, title: `Rewrite · ${REWRITES[style].label}` },
    availability: READY,
  }))
}

export function translateItems(languages: readonly TranslateLanguage[]): PieItem[] {
  return languages.slice(0, SUB_PIE_MAX).map(language => ({
    id: `translate:${language.code}`,
    label: language.name,
    glyph: language.glyph,
    action: {
      kind: 'transform',
      transform: { kind: 'translate', language: language.name },
      title: `Translate · ${language.name}`,
      languageCode: language.code,
    },
    availability: READY,
  }))
}

/**
 * The target first (it's where Crafty sends today), then the most recent sessions, then a new one
 * (named with its workspace when there's more than one: `workspaceLabel`).
 */
export function sendItems(
  target: CraftySessionSummary | null,
  sessions: readonly CraftySessionSummary[],
  workspaceLabel: string | null = null,
): PieItem[] {
  const others = sessions.filter(session => session.sessionId !== target?.sessionId)
  const listed = (target ? [target, ...others] : others).slice(0, SUB_PIE_MAX - 1)
  return [
    ...listed.map((session): PieItem => ({
      id: `send:${session.sessionId}`,
      label: sessionTitle(session),
      icon: session.sessionId === target?.sessionId ? Crosshair : MessageSquare,
      action: { kind: 'send', session },
      availability: READY,
    })),
    { id: 'send:new', label: newSessionLabel(workspaceLabel), icon: Plus, action: { kind: 'send', session: null }, availability: READY },
  ]
}

export const BACK_ITEM: PieItem = { id: 'back', label: 'Back', icon: Undo2, back: true, availability: READY }

/**
 * No selection (yet): the Craft mark alone, never with words under it. `label` is for VoiceOver.
 * A click on it opens Craft Agents.
 */
export interface HubMark {
  mark: true
  label: string
}

/** The hub in words: the capture, a slot's name, or why something can't run. */
export interface HubWords {
  mark?: false
  primary: string
  secondary: string | null
  /** Something is still loading: the hub shows a spinner. */
  busy?: boolean
  /** A click on the hub fixes what the words say: it opens Accessibility's settings. */
  click?: 'allow-accessibility'
}

export type HubText = HubMark | HubWords

/** What a click on the hub does instead of asking (↵ always asks). */
export type HubClick = 'open-craft' | 'allow-accessibility'

export function hubClick(hub: HubText): HubClick | null {
  return hub.mark ? 'open-craft' : hub.click ?? null
}

/**
 * What the hub says with nothing aimed: the capture, as the panel's chip does. Until a selection
 * arrives it's the Craft mark, so the hub changes at most once; a problem the user can fix stays
 * in words.
 */
export function captureHub(capture: PieCapture): HubText {
  if (capture.selection === null) return { mark: true, label: 'Reading the selection' }
  const app = sourceAppName(capture.selection, capture.provenance)
  const text = selectedText(capture)
  if (text.trim()) {
    const count = `${text.length.toLocaleString('en-US')} ${text.length === 1 ? 'character' : 'characters'}`
    return { primary: count, secondary: app ? `from ${app}` : null }
  }
  if (!capture.accessibility) return { primary: 'Can\'t read the selection', secondary: ALLOW_ACCESSIBILITY, click: 'allow-accessibility' }
  if (capture.selection.error) return { primary: 'Couldn\'t read the selection', secondary: null }
  if (capture.provenance?.url) return { mark: true, label: 'No selection; the page goes along' }
  return { mark: true, label: app ? `Nothing selected in ${app}` : 'Nothing selected' }
}

/** What the hub says while a slot is aimed at: its name, and why it can't run when it can't. */
export function itemHub(item: PieItem): HubWords {
  const { availability } = item
  if (availability.state === 'pending') return { primary: item.label, secondary: availability.what, busy: true }
  if (availability.state === 'off') return { primary: item.label, secondary: availability.reason }
  return { primary: item.label, secondary: null }
}

/**
 * Why a pick didn't run. It stays in the hub while the pointer heads there, so one that needs
 * Accessibility offers it, as the hub does with nothing aimed.
 */
export function refusedHub(item: PieItem, reason: string): HubWords {
  return reason === NEEDS_ACCESSIBILITY
    ? { primary: item.label, secondary: ALLOW_ACCESSIBILITY, click: 'allow-accessibility' }
    : { primary: item.label, secondary: reason }
}

/** A slot's name for VoiceOver: the label, that it opens more, or why it's dimmed. */
export function itemAccessibleName(item: PieItem): string {
  if (item.availability.state === 'off') return `${item.label}, unavailable: ${item.availability.reason}`
  return item.sub ? `${item.label}, more options` : item.label
}
