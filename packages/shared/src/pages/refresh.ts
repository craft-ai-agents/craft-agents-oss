/**
 * Page Refresh Hook
 *
 * Bridges page configs into the automations engine: every page with a
 * `refresh` spec materializes as a synthetic cron matcher carrying a single
 * `script` action. The AutomationSystem merges these into its SchedulerTick
 * matchers, so page refreshes ride the exact same pipeline as user
 * automations (cron matching, script executor, history) — never an agent
 * session (deterministic, no token cost, no session-card spam).
 *
 * Synthetic matchers are rebuilt from disk via
 * AutomationSystem.reloadPageRefreshMatchers() — the config watcher's pages
 * branch triggers that on any page.json change.
 */

import type { AutomationMatcher } from '../automations/types.ts';
import { loadWorkspacePages } from './storage.ts';

/** Matcher-id prefix marking synthetic page-refresh matchers (also the history key) */
export const PAGE_REFRESH_MATCHER_PREFIX = 'page:';

/** Stable matcher/history id for a page's refresh automation */
export function pageRefreshMatcherId(pageSlug: string): string {
  return `${PAGE_REFRESH_MATCHER_PREFIX}${pageSlug}`;
}

/** True when a matcher id belongs to a synthetic page-refresh matcher */
export function isPageRefreshMatcherId(matcherId: string): boolean {
  return matcherId.startsWith(PAGE_REFRESH_MATCHER_PREFIX);
}

/**
 * Build the synthetic SchedulerTick matchers for every page with an enabled
 * refresh spec. Pure read — no caching; callers decide when to rebuild.
 */
export function buildPageRefreshMatchers(workspaceRootPath: string): AutomationMatcher[] {
  const matchers: AutomationMatcher[] = [];

  for (const page of loadWorkspacePages(workspaceRootPath)) {
    const refresh = page.config.refresh;
    if (!refresh || refresh.enabled === false) continue;
    if (!refresh.cron || !refresh.script) continue;

    matchers.push({
      id: pageRefreshMatcherId(page.config.slug),
      name: `Page refresh: ${page.config.name}`,
      cron: refresh.cron,
      timezone: refresh.timezone,
      enabled: true,
      actions: [
        {
          type: 'script',
          script: refresh.script,
          args: refresh.args,
          runtime: refresh.runtime,
          timeoutMs: refresh.timeoutMs,
          page: page.config.slug,
        },
      ],
    });
  }

  return matchers;
}
