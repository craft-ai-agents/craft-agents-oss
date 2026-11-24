// Runtime assets ship flat next to index.js: electron-builder strips node_modules from packaged files.
import type { BunPlugin } from 'bun';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const PHOTON_WASM = 'photon_rs_bg.wasm';
export const RESIZE_WORKER = 'image-resize-worker.js';
export const BUNDLE_FILES = ['index.js', RESIZE_WORKER, PHOTON_WASM] as const;

export interface SourceRewrite {
  name: string;
  filter: RegExp;
  from: string;
  to: string;
}

export const SOURCE_REWRITES: readonly SourceRewrite[] = [
  {
    // Bun inlines CJS __dirname as the build machine's path, which never exists on users' machines.
    name: 'photon wasm resolved next to the bundle',
    filter: /[\\/]@silvia-odwyer[\\/]photon-node[\\/]photon_rs\.js$/,
    from: "require('path').join(__dirname, 'photon_rs_bg.wasm')",
    to: `require('path').join(import.meta.dirname, '${PHOTON_WASM}')`,
  },
  {
    // Under Bun the SDK's relative worker path resolves against the cwd, i.e. the user's project.
    name: 'resize worker pinned to the bundle',
    filter: /[\\/]@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]utils[\\/]image-resize\.js$/,
    from: 'resizeImageInWorker("./src/utils/image-resize-worker.ts"',
    to: `resizeImageInWorker(new URL("./${RESIZE_WORKER}", import.meta.url).href`,
  },
];

// Electron-only; reached solely via try/catch probes in shared (openUrl, getElectronLog) that fall back.
export const INLINED_DIRNAME_ALLOWLIST: readonly string[] = [
  'node_modules/electron',
  'node_modules/electron-log/src/main',
];

/** Replaces exactly one occurrence of `rewrite.from`; anything else means the dependency changed. */
export function applyRewrite(source: string, rewrite: SourceRewrite, path: string): string {
  const index = source.indexOf(rewrite.from);
  if (index === -1 || source.indexOf(rewrite.from, index + 1) !== -1) {
    throw new Error(
      `pi-agent-server build: "${rewrite.name}" expected exactly one \`${rewrite.from}\` in ${path}. ` +
        'The dependency changed — re-check whether the rewrite is still needed.',
    );
  }
  return source.slice(0, index) + rewrite.to + source.slice(index + rewrite.from.length);
}

function sourceRewritePlugin(rewrites: readonly SourceRewrite[], applied: Set<string>): BunPlugin {
  return {
    name: 'pi-agent-server-source-rewrites',
    setup(build) {
      for (const rewrite of rewrites) {
        build.onLoad({ filter: rewrite.filter }, ({ path }) => {
          const contents = applyRewrite(readFileSync(path, 'utf8'), rewrite, path);
          applied.add(rewrite.name);
          return { contents, loader: 'js' };
        });
      }
    },
  };
}

/** Build-machine paths Bun inlined as `var __dirname = "..."`, relative to `repoRoot` with `/` separators. */
export function findInlinedBuildPaths(bundleSource: string, repoRoot: string): string[] {
  const found = new Set<string>();
  for (const match of bundleSource.matchAll(/var __(?:dirname|filename) = ("(?:[^"\\]|\\.)*")/g)) {
    const inlined = JSON.parse(match[1]!) as string;
    if (!isAbsolute(inlined)) continue;
    const rel = relative(repoRoot, inlined);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    found.add(rel.split(sep).join('/'));
  }
  return [...found].sort();
}

function verifyBundle(distDir: string, repoRoot: string): void {
  const missing = BUNDLE_FILES.filter((file) => !existsSync(join(distDir, file)));
  if (missing.length > 0) {
    throw new Error(`pi-agent-server build: missing ${missing.join(', ')} in ${distDir}`);
  }
  for (const file of ['index.js', RESIZE_WORKER]) {
    const unexpected = findInlinedBuildPaths(readFileSync(join(distDir, file), 'utf8'), repoRoot)
      .filter((path) => !INLINED_DIRNAME_ALLOWLIST.includes(path));
    if (unexpected.length > 0) {
      throw new Error(
        `pi-agent-server build: ${file} reads paths that only exist on this machine: ${unexpected.join(', ')}. ` +
          'Ship the asset next to the bundle (see SOURCE_REWRITES), or allowlist it with a justification.',
      );
    }
  }
}

export async function buildPiAgentServer(packageDir: string = import.meta.dir): Promise<string> {
  const repoRoot = resolve(packageDir, '..', '..');
  const distDir = join(packageDir, 'dist');
  const sdkEntry = Bun.resolveSync('@earendil-works/pi-coding-agent', packageDir);
  const workerEntry = join(dirname(sdkEntry), 'utils', RESIZE_WORKER);
  const photonDir = dirname(Bun.resolveSync('@silvia-odwyer/photon-node', dirname(sdkEntry)));

  rmSync(distDir, { recursive: true, force: true });

  const applied = new Set<string>();
  const result = await Bun.build({
    entrypoints: [join(packageDir, 'src', 'index.ts'), workerEntry],
    outdir: distDir,
    naming: '[name].[ext]',
    target: 'bun',
    format: 'esm',
    plugins: [sourceRewritePlugin(SOURCE_REWRITES, applied)],
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'pi-agent-server build failed');
  }
  const skipped = SOURCE_REWRITES.filter((rewrite) => !applied.has(rewrite.name));
  if (skipped.length > 0) {
    throw new Error(
      `pi-agent-server build: rewrites never matched a bundled file: ${skipped.map((r) => r.name).join(', ')}`,
    );
  }

  copyFileSync(join(photonDir, PHOTON_WASM), join(distDir, PHOTON_WASM));
  verifyBundle(distDir, repoRoot);
  return distDir;
}

if (import.meta.main) {
  const distDir = await buildPiAgentServer();
  console.log(`pi-agent-server bundle: ${BUNDLE_FILES.map((file) => join(distDir, file)).join(', ')}`);
}
