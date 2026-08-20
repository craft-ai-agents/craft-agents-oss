/**
 * LoadedSkill → ExtensionRecord (projection only — no disk writes).
 */

import type { LoadedSkill } from '../../skills/types.ts'
import type { ExtensionInstallTarget, ExtensionRecord, ExtensionStatus } from '../types.ts'
import { parseExtensionManifest } from '../manifest.ts'
import { permissionsFromAlwaysAllow } from '../permissions.ts'

const SOURCE_TARGET: Record<string, ExtensionInstallTarget> = {
  global: 'global',
  workspace: 'workspace',
  project: 'project',
  omp: 'global',
}

export interface SkillRecordOptions {
  /** extensions/state.json flag; default true. */
  enabled?: boolean
}

/** Pure: LoadedSkill → ExtensionRecord. */
export function skillToExtensionRecord(
  skill: LoadedSkill,
  options: SkillRecordOptions = {},
): ExtensionRecord {
  const id = `skill:${skill.source}:${skill.slug}`
  const permissions = permissionsFromAlwaysAllow(skill.metadata.alwaysAllow)
  const enabled = options.enabled !== false && !skill.shadowedByCraft
  const status: ExtensionStatus = enabled ? 'enabled' : 'disabled'

  const manifest = parseExtensionManifest({
    id,
    name: skill.metadata.name || skill.slug,
    version: '0.0.0',
    runtime: 'skill-pack',
    permissions,
    dependencies: skill.metadata.requiredSources,
    contributes: {
      skills: [{ slug: skill.slug, source: skill.source }],
    },
  })

  return {
    id,
    manifest,
    category: 'skills',
    providerId: 'installed',
    status,
    worksIn: ['Agent sessions', 'Skills panel', 'Command palette'],
    installTarget: SOURCE_TARGET[skill.source] ?? 'workspace',
    description: skill.metadata.description,
    readOnly: true,
    sourceEnabled: !skill.shadowedByCraft,
    tags: skill.metadata.globs,
  }
}

export function skillsToExtensionRecords(
  skills: LoadedSkill[],
  enabledMap: Record<string, boolean> = {},
): ExtensionRecord[] {
  return skills.map((s) => {
    const id = `skill:${s.source}:${s.slug}`
    const flag = enabledMap[id]
    return skillToExtensionRecord(s, { enabled: flag === undefined ? true : flag })
  })
}
