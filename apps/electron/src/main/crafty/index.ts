import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CRAFTY_DOUBLE_TAP_VALUES, CRAFTY_OPEN_WITH_VALUES, setPersistedCraftyEnabled } from '@craft-agent/shared/config'
import { normalizeThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import {
  CRAFTY_TRANSFORM_MAX_CHARS,
  type CraftyDoubleTap,
  type CraftyFollowStrategy,
  type CraftyInsertRequest,
  type CraftyMetric,
  type CraftyOpenWith,
  type CraftyPermissionKind,
  type CraftyPoint,
  type CraftySessionModel,
  type CraftyTargetRef,
  type CraftyTransformRequest,
} from '../../shared/crafty'
import { CraftyController, type CraftyDeps } from './controller'
import { parseTransform } from './transform-prompt'

export { CraftyController } from './controller'

const FOLLOW_STRATEGIES: CraftyFollowStrategy[] = ['off', 'poll', 'mousemove']
const PERMISSION_KINDS: CraftyPermissionKind[] = ['accessibility', 'screen', 'automation']
/** A language, with a script for Chinese ("hu", "zh-Hant"): what the pie's Translate sends. */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/

/** Only well-formed fields go on; createSession resolves them like any new session's options. */
function sessionModel(value: unknown): CraftySessionModel {
  if (!value || typeof value !== 'object') return {}
  const fields = value as Record<string, unknown>
  const text = (field: unknown) => (typeof field === 'string' && field.length > 0 && field.length <= 200 ? field : undefined)
  return {
    llmConnection: text(fields.llmConnection),
    model: text(fields.model),
    thinkingLevel: normalizeThinkingLevel(fields.thinkingLevel),
  }
}

/** A session reference, or null for a new session each time. */
function targetRef(value: unknown): CraftyTargetRef | null {
  if (value === null || value === undefined) return null
  const fields = (typeof value === 'object' ? value : {}) as Record<string, unknown>
  const { workspaceId, sessionId } = fields
  if (typeof workspaceId !== 'string' || !workspaceId || typeof sessionId !== 'string' || !sessionId) throw new Error('Invalid target')
  return { workspaceId, sessionId }
}

function windowPoint(value: unknown): CraftyPoint {
  const fields = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const { x, y } = fields
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid point')
  return { x, y }
}

function transformRequest(value: unknown): CraftyTransformRequest {
  const fields = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const transform = parseTransform(fields.transform)
  const { invocationId, text } = fields
  if (!transform || typeof invocationId !== 'string' || typeof text !== 'string' || !text.trim()) throw new Error('Invalid transform request')
  if (text.length > CRAFTY_TRANSFORM_MAX_CHARS) throw new Error(`The selection is too long for this (over ${CRAFTY_TRANSFORM_MAX_CHARS} characters).`)
  const code = fields.languageCode
  const languageCode = transform.kind === 'translate' && typeof code === 'string' && LANGUAGE_CODE.test(code) ? code : undefined
  return { invocationId, transform, text, model: sessionModel(fields.model), languageCode }
}

/**
 * Create the Crafty controller, register its `crafty:*` IPC (direct IPC, never on a remote
 * server: Crafty is a per-device feature) and start it when the setting is on.
 */
export function initCrafty(deps: CraftyDeps): CraftyController {
  const crafty = new CraftyController(deps)

  // Settings (any window)
  ipcMain.handle('crafty:getStatus', () => crafty.status())
  ipcMain.handle('crafty:setEnabled', (_event, enabled: unknown) => {
    setPersistedCraftyEnabled(enabled === true)
    crafty.syncWithSetting()
    crafty.broadcastTarget()
    return crafty.status()
  })
  ipcMain.handle('crafty:openPermissionSettings', (_event, kind: unknown) => {
    if (!PERMISSION_KINDS.includes(kind as CraftyPermissionKind)) throw new Error('Unknown permission')
    return crafty.openPermissionSettings(kind as CraftyPermissionKind)
  })
  ipcMain.handle('crafty:requestAccessibility', () => crafty.requestAccessibility())
  ipcMain.handle('crafty:setFollow', (_event, strategy: unknown) => {
    if (!FOLLOW_STRATEGIES.includes(strategy as CraftyFollowStrategy)) throw new Error('Unknown follow strategy')
    return crafty.setFollow(strategy as CraftyFollowStrategy)
  })
  ipcMain.handle('crafty:setDoubleTap', (_event, value: unknown) => {
    if (!CRAFTY_DOUBLE_TAP_VALUES.includes(value as CraftyDoubleTap)) throw new Error('Unknown double-tap key')
    return crafty.setDoubleTap(value as CraftyDoubleTap)
  })
  ipcMain.handle('crafty:setOpenWith', (_event, value: unknown) => {
    if (!CRAFTY_OPEN_WITH_VALUES.includes(value as CraftyOpenWith)) throw new Error('Unknown surface')
    return crafty.setOpenWith(value as CraftyOpenWith)
  })
  // A session's menu in Craft, or the panel's target menu
  ipcMain.handle('crafty:setTarget', (event, target: unknown) =>
    crafty.setTarget(targetRef(target), crafty.isCraftyWebContents(event.sender.id) ? 'panel' : 'session-menu'))

  // The Crafty window only
  const fromCrafty = <A extends unknown[], R>(channel: string, handler: (...args: A) => R) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!crafty.isCraftyWebContents(event.sender.id)) throw new Error(`${channel} is only for the Crafty window`)
      return handler(...(args as A))
    })
  }
  fromCrafty('crafty:nextEvent', () => crafty.nextEvent())
  fromCrafty('crafty:cursor', () => crafty.cursor())
  fromCrafty('crafty:setInteractive', (interactive: unknown) => crafty.setInteractive(interactive === true))
  fromCrafty('crafty:focusPanel', (invocationId: unknown) => crafty.focusPanel(String(invocationId)))
  fromCrafty('crafty:hide', (reason: unknown) => crafty.closePanel(String(reason ?? 'window')))
  fromCrafty('crafty:resignKey', (invocationId: unknown) => crafty.resignKey(String(invocationId)))
  fromCrafty('crafty:createSession', (invocationId: unknown, model: unknown) => crafty.createSession(String(invocationId), sessionModel(model)))
  fromCrafty('crafty:listSessions', (invocationId: unknown) => crafty.listSessions(String(invocationId)))
  fromCrafty('crafty:insert', (request: unknown) => {
    const r = request as Partial<CraftyInsertRequest> | null
    if (!r || typeof r.text !== 'string' || !r.text || typeof r.invocationId !== 'string') throw new Error('Invalid insert request')
    const mode = r.mode === 'type' || r.mode === 'paste' ? r.mode : 'auto'
    return crafty.insert({ invocationId: r.invocationId, text: r.text, mode, confirm: r.confirm === true })
  })
  fromCrafty('crafty:captureRegion', (invocationId: unknown) => crafty.captureRegion(String(invocationId)))
  fromCrafty('crafty:useRecentScreenshot', (invocationId: unknown) => crafty.useRecentScreenshot(String(invocationId)))
  fromCrafty('crafty:openInCraft', (workspaceId: unknown, sessionId: unknown) => crafty.openInCraft(String(workspaceId), String(sessionId)))
  fromCrafty('crafty:openCraft', (invocationId: unknown) => crafty.openCraft(String(invocationId)))
  fromCrafty('crafty:warp', (invocationId: unknown, point: unknown) => crafty.warp(String(invocationId), windowPoint(point)))
  fromCrafty('crafty:transform', (request: unknown) => crafty.transform(transformRequest(request)))
  fromCrafty('crafty:metric', (metric: unknown) => {
    if (metric && typeof metric === 'object' && typeof (metric as CraftyMetric).kind === 'string') crafty.rendererMetric(metric as CraftyMetric)
  })

  crafty.syncWithSetting()
  return crafty
}
