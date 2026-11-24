import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BUNDLE_FILES } from '../build.ts';

/**
 * Smoke test against the BUILT single-file bundle, not the source tree.
 *
 * Two 0.12.1 release breakages were invisible to source-mode tests because they
 * only exist in the bundled artifact or in the exact server injection path:
 *   1. "No API key found for openai-codex" — api_key credential shipped for an
 *      OAuth-only provider (pi SDK ≥0.81 typed resolver).
 *   2. "OAuth auth derivation failed" — lazyOAuth's bundler-opaque dynamic
 *      import cannot resolve flow modules next to a single-file bundle.
 *
 * This drives dist/index.js over its JSONL protocol from a directory outside
 * the repo (so nothing resolves from node_modules) with a ChatGPT Plus-shaped
 * init, and asserts the prompt gets past credential resolution and OAuth
 * derivation all the way to request building. The fake token is deliberately
 * not a JWT: failing at accountId extraction is the deterministic, offline
 * proof that the whole auth pipeline upstream of the HTTP request works.
 *
 * Image handling (#1146) only broke on users' machines: build-machine paths
 * inlined into the bundle still exist here. That test runs a copy whose
 * repo paths are rewritten to a missing root, as a user's machine sees it.
 */

const packageDir = dirname(import.meta.dir);
const bundlePath = join(packageDir, 'dist', 'index.js');
const blockNetworkPreloadPath = join(import.meta.dir, 'test-fixtures', 'block-network.ts');
const repoRoot = realpathSync(resolve(packageDir, '..', '..'));
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const RUN_TIMEOUT_MS = 30_000;

let scratchDir: string;

beforeAll(() => {
  const build = spawnSync('bun', ['run', 'build'], { cwd: packageDir, stdio: 'pipe', timeout: 120_000 });
  if (build.status !== 0) {
    throw new Error(`bundle build failed: ${build.stderr?.toString() ?? build.stdout?.toString()}`);
  }
  scratchDir = mkdtempSync(join(tmpdir(), 'pi-bundle-smoke-'));
  mkdirSync(join(scratchDir, 'plans'), { recursive: true });
});

afterAll(() => {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
});

/**
 * Build an allowlisted subprocess environment. Besides keeping the smoke test
 * independent of the developer machine, this prevents ambient provider keys,
 * auth files, custom base URLs, and proxy/routing variables from bypassing the
 * fake credential or escaping the explicit network guard.
 */
function createOfflineEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: scratchDir,
    USERPROFILE: scratchDir,
    XDG_CONFIG_HOME: scratchDir,
    TMPDIR: scratchDir,
    TEMP: scratchDir,
    TMP: scratchDir,
  };

  // Keep only variables required to launch Bun on each supported platform.
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'] as const) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

/** Copy the bundle with every build-machine path pointing at a root that doesn't exist. */
function copyBundleAsOnUserMachine(): string {
  const dir = join(scratchDir, 'user-machine-bundle');
  mkdirSync(dir, { recursive: true });
  const inlinedRoot = JSON.stringify(repoRoot).slice(1, -1);
  const missingRoot = JSON.stringify(join(scratchDir, 'build-machine-only')).slice(1, -1);
  for (const file of BUNDLE_FILES) {
    const source = join(packageDir, 'dist', file);
    const target = join(dir, file);
    if (file.endsWith('.js')) {
      writeFileSync(target, readFileSync(source, 'utf8').split(inlinedRoot).join(missingRoot));
    } else {
      writeFileSync(target, readFileSync(source));
    }
  }
  return join(dir, 'index.js');
}

/** Spawn the bundle, send JSONL messages, and collect output until `done` matches or timeout. */
function driveBundle(
  messages: object[],
  done: (output: string) => boolean,
  entry: string = bundlePath,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--preload', blockNetworkPreloadPath, entry], {
      cwd: scratchDir,
      env: createOfflineEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(
      () => finish(new Error(`timed out waiting for terminal marker; output so far:\n${output.slice(-2000)}`)),
      RUN_TIMEOUT_MS,
    );
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (done(output)) finish();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => finish(err));
    child.on('exit', () => {
      if (!done(output)) finish(new Error(`bundle exited early; output:\n${output.slice(-2000)}`));
    });
    for (const msg of messages) {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    }
  });
}

describe('pi-agent-server bundle', () => {
  it('resolves a ChatGPT Plus credential for Astra through the bundled auth pipeline offline', async () => {
    const output = await driveBundle(
      [
        {
          type: 'init',
          apiKey: '',
          model: 'pi/gpt-6-astra',
          cwd: scratchDir,
          thinkingLevel: 'off',
          workspaceRootPath: scratchDir,
          sessionId: 'bundle-smoke',
          sessionPath: scratchDir,
          workingDirectory: scratchDir,
          plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi',
          authType: 'oauth',
          piAuth: { provider: 'openai-codex', credential: { type: 'api_key', key: 'fake-not-a-jwt' } },
        },
        { type: 'prompt', id: 'p1', message: 'hi', systemPrompt: 'You are a smoke test.' },
      ],
      // The non-JWT token must fail exactly at request-build accountId extraction —
      // any earlier failure is one of the auth-pipeline regressions this test pins.
      (out) => out.includes('Failed to extract accountId from token') ||
        out.includes('OFFLINE_FETCH_BLOCKED') ||
        out.includes('No API key found') ||
        out.includes('OAuth auth derivation failed'),
    );

    expect(output).not.toContain('No API key found');
    expect(output).not.toContain('OAuth auth derivation failed');
    expect(output).not.toContain('Cannot find module');
    expect(output).not.toContain('OFFLINE_FETCH_BLOCKED');
    expect(output).toContain('Failed to extract accountId from token');
  }, RUN_TIMEOUT_MS + 130_000);

  it('sends prompt images from a bundle on a user machine without running workers from the cwd', async () => {
    const entry = copyBundleAsOnUserMachine();
    // The SDK used to spawn this cwd-relative worker under Bun, i.e. from the user's project.
    const plantedWorker = join(scratchDir, 'src', 'utils', 'image-resize-worker.ts');
    const plantedMarker = join(scratchDir, 'planted-worker-ran');
    mkdirSync(dirname(plantedWorker), { recursive: true });
    writeFileSync(plantedWorker, `require('node:fs').writeFileSync(${JSON.stringify(plantedMarker)}, '1');\n`);

    const output = await driveBundle(
      [
        {
          type: 'init',
          apiKey: 'fake-key',
          model: 'smoke-vision',
          cwd: scratchDir,
          thinkingLevel: 'off',
          workspaceRootPath: scratchDir,
          sessionId: 'bundle-smoke-image',
          sessionPath: scratchDir,
          workingDirectory: scratchDir,
          plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'https://smoke.invalid/v1',
          customEndpoint: { api: 'openai-completions', supportsImages: true },
        },
        {
          type: 'prompt',
          id: 'p1',
          message: 'Describe the image.',
          systemPrompt: 'You are a smoke test.',
          images: [{ type: 'image', data: ONE_PIXEL_PNG_BASE64, mimeType: 'image/png' }],
        },
      ],
      (out) => out.includes('REQUEST_IMAGE='),
      entry,
    );

    expect(output).not.toContain('Cannot find module');
    expect(output).toContain('REQUEST_IMAGE=present');
    expect(output).not.toContain('REQUEST_IMAGE=omitted');
    expect(existsSync(plantedMarker)).toBe(false);
  }, RUN_TIMEOUT_MS + 130_000);
});
