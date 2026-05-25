export type RecentDirScenario = 'none' | 'few' | 'many'

const RECENT_DIR_SCENARIO_DATA: Record<RecentDirScenario, string[]> = {
  none: [],
  few: [
    '/Users/demo/projects/runneros',
    '/Users/demo/projects/runneros/apps/electron',
    '/Users/demo/projects/runneros/packages/shared',
  ],
  many: [
    '/Users/demo/projects/runneros',
    '/Users/demo/projects/runneros/apps/electron',
    '/Users/demo/projects/runneros/apps/viewer',
    '/Users/demo/projects/runneros/apps/cli',
    '/Users/demo/projects/runneros/packages/shared',
    '/Users/demo/projects/runneros/packages/server-core',
    '/Users/demo/projects/runneros/packages/pi-agent-server',
    '/Users/demo/projects/runneros/packages/ui',
    '/Users/demo/projects/runneros/scripts',
  ],
}

/** Return a copy of the fixture list for the selected scenario. */
export function getRecentDirsForScenario(scenario: RecentDirScenario): string[] {
  return [...RECENT_DIR_SCENARIO_DATA[scenario]]
}
