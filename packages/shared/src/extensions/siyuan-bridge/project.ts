/**
 * Project SiYuan craft.contributes into Craft shell contribution shapes (W6).
 *
 * Permission model is fail-closed: missing grant → skip + diagnostic.
 * L0/L1 produce empty shell projections (diagnostics only).
 */

import { detectCompatLevel } from './manifest.ts'
import {
  DOCK_TO_SLOT,
  type BridgeAgentActionContribute,
  type BridgeCommandContribute,
  type BridgeDockContribute,
  type BridgeMenuContribute,
  type BridgeProjectedContributions,
  type BridgeProjectionDiagnostic,
  type BridgeSettingContribute,
  type BridgeStatusItemContribute,
  type BridgeTabContribute,
  type CompatLevel,
  type SiyuanDockPosition,
  type SiYuanBridgeManifest,
} from './types.ts'

export interface ProjectBridgeOptions {
  /**
   * Explicit grants. `undefined` = install-time default (declared contribute
   * permissions union, or `ui.command`/`ui.panel` for L2/L3 until user revoke).
   * Pass `[]` to deny all permission-gated contributes.
   */
  grantedPermissions?: string[] | Set<string>
  capabilityProbeFailed?: boolean
}

function toGrantSet(granted?: string[] | Set<string>): Set<string> {
  if (granted == null) return new Set()
  if (granted instanceof Set) return granted
  return new Set(granted)
}

/**
 * Install-time default grants for L2/L3 projections (S-05): union of permission
 * strings declared on craft.contributes entries; if the plugin declares L2/L3
 * contributes but no per-entry permissions, grant `ui.command` + `ui.panel`.
 */
export function defaultBridgeGrantedPermissions(
  manifest: SiYuanBridgeManifest | null | undefined,
  level?: CompatLevel,
): string[] {
  const resolvedLevel =
    level ??
    detectCompatLevel(manifest ?? null, undefined)
  if (resolvedLevel < 2 || !manifest?.craft?.contributes) return []

  const contributes = manifest.craft.contributes
  const declared = new Set<string>()
  const collect = (entries: Array<{ permissions?: string[] }> | undefined) => {
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (!entry?.permissions) continue
      for (const p of entry.permissions) {
        if (typeof p === 'string' && p) declared.add(p)
      }
    }
  }
  collect(contributes.commands)
  collect(contributes.docks)
  collect(contributes.agentActions)
  // menus/tabs/statusItems/settings have no permissions field in the bridge schema
  if (declared.size > 0) return [...declared]
  // L2/L3 declared contributes with no per-entry permissions → shell UI defaults.
  return ['ui.command', 'ui.panel']
}

function resolveGrantedPermissions(
  manifest: SiYuanBridgeManifest | null,
  level: CompatLevel,
  grantedPermissions: string[] | Set<string> | undefined,
): Set<string> {
  // Distinguish omit (default grant) from explicit empty (user revoke).
  if (grantedPermissions === undefined) {
    return new Set(defaultBridgeGrantedPermissions(manifest, level))
  }
  return toGrantSet(grantedPermissions)
}

function missingPermission(
  required: string[] | undefined,
  granted: Set<string>,
): string | undefined {
  if (!required || required.length === 0) return undefined
  for (const p of required) {
    if (!granted.has(p)) return p
  }
  return undefined
}

function emptyProjection(
  pluginId: string,
  level: CompatLevel,
  diagnostics: BridgeProjectionDiagnostic[] = [],
): BridgeProjectedContributions {
  return {
    commands: [],
    panels: [],
    surfaces: [],
    menus: [],
    statusItems: [],
    settings: [],
    agentActions: [],
    diagnostics,
    level,
    pluginId,
  }
}

function isDockPosition(value: unknown): value is SiyuanDockPosition {
  return (
    value === 'LeftTop' ||
    value === 'LeftBottom' ||
    value === 'RightTop' ||
    value === 'RightBottom' ||
    value === 'BottomLeft' ||
    value === 'BottomRight'
  )
}

/**
 * Project a bridge manifest into shell contribution arrays.
 * L0/L1 → empty arrays (+ optional skipped-level diagnostics).
 * L2+ → craft.contributes with permission fail-closed filtering.
 * When `grantedPermissions` is omitted, defaults to declared contribute
 * permissions (install-time grant until user revoke).
 */
export function projectBridgeContributions(
  manifest: SiYuanBridgeManifest | null,
  opts: ProjectBridgeOptions = {},
): BridgeProjectedContributions {
  const level = detectCompatLevel(manifest, {
    capabilityProbeFailed: opts.capabilityProbeFailed,
  })
  const pluginId = manifest?.name?.trim() ? manifest.name.trim() : ''
  const granted = resolveGrantedPermissions(manifest, level, opts.grantedPermissions)

  if (!manifest || !pluginId) {
    return emptyProjection(pluginId, 0, [
      {
        kind: 'invalid',
        contributeType: 'manifest',
        message: 'Invalid or missing SiYuan plugin manifest',
      },
    ])
  }

  if (level < 2) {
    const diagnostics: BridgeProjectionDiagnostic[] = [
      {
        kind: 'skipped-level',
        contributeType: 'craft.contributes',
        message: `Compat level L${level} does not project shell contributions`,
      },
    ]
    return emptyProjection(pluginId, level, diagnostics)
  }

  const contributes = manifest.craft?.contributes
  const out = emptyProjection(pluginId, level)
  if (!contributes) return out

  // commands
  if (Array.isArray(contributes.commands)) {
    for (const raw of contributes.commands) {
      const cmd = raw as BridgeCommandContribute
      if (!cmd || typeof cmd.id !== 'string' || typeof cmd.title !== 'string') {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'commands',
          message: 'Invalid command contribution',
        })
        continue
      }
      const denied = missingPermission(cmd.permissions, granted)
      if (denied) {
        out.diagnostics.push({
          kind: 'permission-denied',
          contributeType: 'commands',
          id: cmd.id,
          permission: denied,
          message: `Missing permission ${denied} for command ${cmd.id}`,
        })
        continue
      }
      out.commands.push({
        ...cmd,
        source: 'siyuan-plugin',
        pluginId,
      })
    }
  }

  // docks → panels
  if (Array.isArray(contributes.docks)) {
    let dockIndex = 0
    for (const raw of contributes.docks) {
      const dock = raw as BridgeDockContribute
      if (!dock || !isDockPosition(dock.position)) {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'docks',
          message: 'Invalid dock contribution',
        })
        continue
      }
      const denied = missingPermission(dock.permissions, granted)
      if (denied) {
        out.diagnostics.push({
          kind: 'permission-denied',
          contributeType: 'docks',
          id: `${dock.position}:${dockIndex}`,
          permission: denied,
          message: `Missing permission ${denied} for dock ${dock.position}`,
        })
        dockIndex++
        continue
      }
      const slot = DOCK_TO_SLOT[dock.position]
      const id = `siyuan-plugin:${pluginId}:dock:${dock.position}:${dockIndex}`
      out.panels.push({
        id,
        slot,
        title: typeof dock.title === 'string' && dock.title.trim() ? dock.title : pluginId,
        source: { type: 'siyuan-plugin', id: pluginId },
        permissions: dock.permissions,
      })
      dockIndex++
    }
  }

  // tabs → surfaces
  if (Array.isArray(contributes.tabs)) {
    for (const raw of contributes.tabs) {
      const tab = raw as BridgeTabContribute
      if (!tab || typeof tab.type !== 'string' || typeof tab.title !== 'string') {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'tabs',
          message: 'Invalid tab contribution',
        })
        continue
      }
      out.surfaces.push({
        kind: 'extension',
        extensionId: `siyuan-plugin:${pluginId}`,
        viewId: tab.type,
        title: tab.title,
        icon: tab.icon,
      })
    }
  }

  // menus
  if (Array.isArray(contributes.menus)) {
    for (const raw of contributes.menus) {
      const menu = raw as BridgeMenuContribute
      if (
        !menu ||
        typeof menu.command !== 'string' ||
        (menu.location !== 'editor' &&
          menu.location !== 'tree' &&
          menu.location !== 'dock' &&
          menu.location !== 'block' &&
          menu.location !== 'tab')
      ) {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'menus',
          message: 'Invalid menu contribution',
        })
        continue
      }
      out.menus.push({ ...menu, pluginId })
    }
  }

  // statusItems
  if (Array.isArray(contributes.statusItems)) {
    for (const raw of contributes.statusItems) {
      const item = raw as BridgeStatusItemContribute
      if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'statusItems',
          message: 'Invalid status item contribution',
        })
        continue
      }
      out.statusItems.push({ ...item, pluginId })
    }
  }

  // settings
  if (Array.isArray(contributes.settings)) {
    for (const raw of contributes.settings) {
      const setting = raw as BridgeSettingContribute
      if (
        !setting ||
        typeof setting.key !== 'string' ||
        typeof setting.title !== 'string' ||
        (setting.type !== 'checkbox' &&
          setting.type !== 'text' &&
          setting.type !== 'number' &&
          setting.type !== 'select')
      ) {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'settings',
          message: 'Invalid setting contribution',
        })
        continue
      }
      out.settings.push({ ...setting, pluginId })
    }
  }

  // agentActions — L3 only meaningfully, but project when present at L2+
  if (Array.isArray(contributes.agentActions)) {
    for (const raw of contributes.agentActions) {
      const action = raw as BridgeAgentActionContribute
      if (
        !action ||
        typeof action.id !== 'string' ||
        typeof action.title !== 'string' ||
        typeof action.description !== 'string' ||
        !action.inputSchema ||
        typeof action.inputSchema !== 'object' ||
        !Array.isArray(action.permissions)
      ) {
        out.diagnostics.push({
          kind: 'invalid',
          contributeType: 'agentActions',
          message: 'Invalid agent action contribution',
        })
        continue
      }
      const denied = missingPermission(action.permissions, granted)
      if (denied) {
        out.diagnostics.push({
          kind: 'permission-denied',
          contributeType: 'agentActions',
          id: action.id,
          permission: denied,
          message: `Missing permission ${denied} for agent action ${action.id}`,
        })
        continue
      }
      out.agentActions.push({
        ...action,
        pluginId,
        source: 'siyuan-plugin',
      })
    }
  }

  return out
}
