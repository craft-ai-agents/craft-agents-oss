/**
 * Documentation Utilities
 *
 * Provides access to built-in documentation that Claude can reference
 * when performing configuration tasks (sources, agents, permissions, etc.).
 *
 * Docs are stored at ~/.craft-agent/docs/ and copied on first run.
 * Source content lives in packages/shared/assets/docs/*.md for easier editing.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { isDebugEnabled } from '../utils/debug.ts';
import { getAppVersion } from '../version/index.ts';

const CONFIG_DIR = join(homedir(), '.craft-agent');
const DOCS_DIR = join(CONFIG_DIR, 'docs');

// Track if docs have been initialized this session (prevents re-init on hot reload)
let docsInitialized = false;

// Resolve the assets directory containing bundled documentation files.
//
// Uses __dirname-based paths first, which work reliably in both environments:
// - Development (Bun):   __dirname = packages/shared/src/docs/
//                         -> join(__dirname, '../../assets/docs') = packages/shared/assets/docs/
// - Packaged (esbuild CJS): __dirname = <app-bundle>/dist/
//                         -> join(__dirname, 'assets/docs') = <app-bundle>/dist/assets/docs/
//
// process.cwd()-based paths are kept as fallbacks but don't work in packaged
// Electron apps where cwd is the user's directory, not the app bundle.
// See: https://github.com/lukilabs/craft-agents-oss/issues/71
function getAssetsDir(): string {
  const possiblePaths = [
    // 1. __dirname relative: development (packages/shared/src/docs/ -> ../../assets/docs)
    join(__dirname, '..', '..', 'assets', 'docs'),
    // 2. __dirname relative: bundled CJS (dist/ -> assets/docs)
    join(__dirname, 'assets', 'docs'),
    // 3. Fallback: process.cwd() for monorepo root in dev
    join(process.cwd(), 'packages', 'shared', 'assets', 'docs'),
    // 4. Fallback: process.cwd() for bundled builds
    join(process.cwd(), 'dist', 'assets', 'docs'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Fallback: first path (will fail gracefully if files don't exist)
  return possiblePaths[0]!;
}

/**
 * Load bundled docs from asset files.
 * Called once at module initialization.
 * Returns empty strings if files don't exist (graceful degradation).
 */
function loadBundledDocs(): Record<string, string> {
  const assetsDir = getAssetsDir();
  const docFiles = ['sources.md', 'skills.md', 'permissions.md', 'themes.md', 'statuses.md', 'labels.md'];

  const docs: Record<string, string> = {};

  for (const filename of docFiles) {
    const filePath = join(assetsDir, filename);
    try {
      if (existsSync(filePath)) {
        docs[filename] = readFileSync(filePath, 'utf-8');
      } else {
        console.warn(`[docs] Asset file not found: ${filePath}`);
        docs[filename] = `# ${filename.replace('.md', '')}\n\nDocumentation not available.`;
      }
    } catch (error) {
      console.error(`[docs] Failed to load ${filename}:`, error);
      docs[filename] = `# ${filename.replace('.md', '')}\n\nFailed to load documentation.`;
    }
  }

  return docs;
}

// Load docs at module initialization (one-time read)
const BUNDLED_DOCS = loadBundledDocs();

/**
 * Get the docs directory path
 */
export function getDocsDir(): string {
  return DOCS_DIR;
}

/**
 * Get path to a specific doc file
 */
export function getDocPath(filename: string): string {
  return join(DOCS_DIR, filename);
}

// App root path reference for use in prompts
// Using ~ for display since actual path varies per system/instance
export const APP_ROOT = '~/.craft-agent';

/**
 * Documentation file references for use in error messages and tool descriptions.
 * Use these constants instead of hardcoding paths to keep references in sync.
 */
export const DOC_REFS = {
  appRoot: APP_ROOT,
  sources: `${APP_ROOT}/docs/sources.md`,
  permissions: `${APP_ROOT}/docs/permissions.md`,
  skills: `${APP_ROOT}/docs/skills.md`,
  themes: `${APP_ROOT}/docs/themes.md`,
  statuses: `${APP_ROOT}/docs/statuses.md`,
  labels: `${APP_ROOT}/docs/labels.md`,
  docsDir: `${APP_ROOT}/docs/`,
} as const;

/**
 * Check if docs directory exists
 */
export function docsExist(): boolean {
  return existsSync(DOCS_DIR);
}

/**
 * List available doc files
 */
export function listDocs(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
}

/**
 * Extract version from a doc file's first line.
 * Expected format: <!-- version: X.Y.Z -->
 */
function extractVersion(content: string): string | null {
  const match = content.match(/^<!--\s*version:\s*([^\s]+)\s*-->/);
  return match?.[1] ?? null;
}

/**
 * Compare semver versions. Returns:
 *  1 if a > b
 *  0 if a == b
 * -1 if a < b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * Initialize docs directory with bundled documentation.
 * - Debug mode: Always overwrite docs (once per session)
 * - Production: Only update if bundled version is newer
 */
export function initializeDocs(): void {
  // Skip if already initialized this session (prevents re-init on hot reload)
  if (docsInitialized) {
    return;
  }
  docsInitialized = true;

  if (!existsSync(DOCS_DIR)) {
    mkdirSync(DOCS_DIR, { recursive: true });
  }

  const appVersion = getAppVersion();
  const debugMode = isDebugEnabled();

  for (const [filename, content] of Object.entries(BUNDLED_DOCS)) {
    const docPath = join(DOCS_DIR, filename);
    const versionedContent = `<!-- version: ${appVersion} -->\n${content}`;

    if (!existsSync(docPath)) {
      // File doesn't exist - create it
      writeFileSync(docPath, versionedContent, 'utf-8');
      console.log(`[docs] Created ${filename} (v${appVersion})`);
      continue;
    }

    if (debugMode) {
      // Debug mode - always overwrite
      writeFileSync(docPath, versionedContent, 'utf-8');
      console.log(`[docs] Updated ${filename} (v${appVersion}, debug mode)`);
      continue;
    }

    // Production - check version
    try {
      const existingContent = readFileSync(docPath, 'utf-8');
      const installedVersion = extractVersion(existingContent);

      if (!installedVersion || compareVersions(appVersion, installedVersion) > 0) {
        // No version or bundled is newer - update
        writeFileSync(docPath, versionedContent, 'utf-8');
        console.log(`[docs] Updated ${filename} (v${installedVersion || 'none'} → v${appVersion})`);
      }
    } catch {
      // Error reading - overwrite
      writeFileSync(docPath, versionedContent, 'utf-8');
      console.log(`[docs] Recreated ${filename} (v${appVersion})`);
    }
  }
}

export { BUNDLED_DOCS };

// Re-export source guides utilities (parsing only - bundled guides removed)
export {
  parseSourceGuide,
  getSourceGuide,
  getSourceGuideForDomain,
  getSourceKnowledge,
  extractDomainFromSource,
  extractDomainFromUrl,
  type ParsedSourceGuide,
  type SourceGuideFrontmatter,
} from './source-guides.ts';

// Re-export doc links (for UI help popovers)
export {
  getDocUrl,
  getDocInfo,
  DOCS,
  type DocFeature,
  type DocInfo,
} from './doc-links.ts';
