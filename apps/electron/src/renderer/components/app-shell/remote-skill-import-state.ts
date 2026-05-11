import type { DiscoveredSkill, RemoteResolveResult } from '../../../shared/types'

const REMOTE_EMPTY_DISCOVERY_MESSAGE =
  'The repository was reached, but no supported SKILL.md files were found. Remote discovery supports a top-level SKILL.md or skill directories up to three levels deep; when multiple skills are found, the Skill Picker will let you choose. Open a direct GitHub subpath to a skill, or use the Upload tab to install from a zip file.'

export type RemoteResolvePhase =
  | { kind: 'error'; message: string }
  | { kind: 'single'; skill: DiscoveredSkill }
  | { kind: 'picker'; skills: DiscoveredSkill[] }

/**
 * Maps a completed remote resolver result to the next Remote tab phase.
 */
export function getRemoteResolvePhase(result: RemoteResolveResult): RemoteResolvePhase {
  if ('error' in result) {
    return { kind: 'error', message: result.error }
  }

  if (result.length === 0) {
    return { kind: 'error', message: REMOTE_EMPTY_DISCOVERY_MESSAGE }
  }

  if (result.length === 1) {
    return { kind: 'single', skill: result[0] }
  }

  return { kind: 'picker', skills: result }
}
