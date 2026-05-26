import { createRequire } from 'node:module';
import path from 'node:path';

export const DEFAULT_BROWSER_ENGINE = 'runner-cdp';
export const SUPPORTED_BROWSER_ENGINES = new Set([
  'runner-cdp',
  'chrome-devtools',
  'stagehand',
  'cloakbrowser',
  'playwright',
]);

export function resolveBrowserEngine(flags = {}, profile = {}) {
  return flags.engine || profile.browserEngine || process.env.SOCIAL_BROWSER_ENGINE || DEFAULT_BROWSER_ENGINE;
}

export function assertSupportedBrowserEngine(engine) {
  if (!SUPPORTED_BROWSER_ENGINES.has(engine)) {
    const supported = Array.from(SUPPORTED_BROWSER_ENGINES).join(', ');
    throw new Error(`Unsupported browser engine "${engine}". Supported: ${supported}`);
  }
}

export function checkBrowserEngine(engine, registry, rootDir) {
  if (engine === 'runner-cdp') {
    return {
      available: true,
      mode: 'delegated',
      note: 'Default for RunnerOS. The CLI emits structured action plans; Runner executes with native browser/CDP tools.',
    };
  }

  if (engine === 'chrome-devtools') {
    return {
      available: null,
      mode: 'external',
      note: 'Chrome DevTools MCP/CDP adapter is external. Configure the Runner/browser harness before live execution.',
    };
  }

  if (engine === 'stagehand') {
    return {
      available: null,
      mode: 'external',
      note: 'Stagehand is an optional adaptive browser layer. Install/configure separately before live execution.',
    };
  }

  if (engine === 'cloakbrowser') {
    return {
      available: null,
      mode: 'external',
      note: 'CloakBrowser is optional and checked only at live launch time.',
    };
  }

  if (engine === 'playwright') {
    const locations = [];
    const rootRequire = createRequire(path.join(rootDir, 'package.json'));
    try {
      locations.push({ scope: 'root', path: rootRequire.resolve('playwright') });
    } catch {}

    for (const [platform, entry] of Object.entries(registry.platforms || {})) {
      try {
        const platformRequire = createRequire(path.join(rootDir, entry.path, 'package.json'));
        locations.push({ scope: platform, path: platformRequire.resolve('playwright') });
      } catch {}
    }

    return {
      available: locations.length > 0,
      mode: 'local-library',
      locations,
      note: locations.length > 0
        ? 'Playwright fallback is installed.'
        : 'Playwright fallback is not installed. Run npm install in the Printing Press Social package only if you need standalone fallback execution.',
    };
  }

  return {
    available: false,
    note: `Unsupported configured browser engine: ${engine}`,
  };
}

export async function launchBrowserContextForEngine(engine, profile, flags, options, sessionDir) {
  assertSupportedBrowserEngine(engine);

  if (engine === 'runner-cdp') {
    throw Object.assign(
      new Error('runner-cdp is delegated to RunnerOS native browser tools. Run the command with --dry-run --json, then execute the returned browserPlan through Runner browser tools.'),
      { code: 'RUNNER_CDP_DELEGATED' }
    );
  }

  if (engine === 'chrome-devtools') {
    throw Object.assign(
      new Error('chrome-devtools live adapter is not wired inside this CLI process yet. Use Runner native browser tools or configure an external CDP adapter.'),
      { code: 'CHROME_DEVTOOLS_DELEGATED' }
    );
  }

  if (engine === 'stagehand') {
    throw Object.assign(
      new Error('stagehand live adapter is optional and not installed by RunnerOS. Configure Stagehand separately before using this engine.'),
      { code: 'STAGEHAND_NOT_CONFIGURED' }
    );
  }

  if (engine === 'cloakbrowser') {
    try {
      const { launchPersistentContext } = await import('cloakbrowser');
      return await launchPersistentContext({
        userDataDir: sessionDir(profile),
        ...options,
        humanize: flags.humanize !== 'false',
        humanPreset: flags['human-preset'] || 'careful',
      });
    } catch (error) {
      throw Object.assign(
        new Error(`CloakBrowser launch failed or is not installed: ${error.message}`),
        { code: 'CLOAKBROWSER_FAILED' }
      );
    }
  }

  if (engine === 'playwright') {
    try {
      const { chromium } = await import('playwright');
      return await chromium.launchPersistentContext(sessionDir(profile), options);
    } catch (error) {
      throw Object.assign(
        new Error(`Playwright fallback launch failed: ${error.message}`),
        { code: 'PLAYWRIGHT_FAILED' }
      );
    }
  }
}
