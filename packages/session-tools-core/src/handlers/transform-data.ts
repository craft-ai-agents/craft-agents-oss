/**
 * Transform Data Handler
 *
 * Transforms data files using Python/Node/Bun scripts for
 * datatable/spreadsheet/html-preview blocks.
 *
 * Runs scripts in an isolated subprocess with sensitive env vars stripped.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import { spawn } from 'node:child_process';
import { join, normalize, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

export interface TransformDataArgs {
  language: 'python3' | 'node' | 'bun';
  script: string;
  inputFiles: string[];
  outputFile: string;
}

/**
 * Env vars stripped from subprocess to prevent credential leakage.
 * NOTE: This list is duplicated in packages/shared/src/mcp/client.ts (BLOCKED_ENV_VARS).
 * If you add a new entry here, update it there too.
 */
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'STRIPE_SECRET_KEY',
  'NPM_TOKEN',
];

const TRANSFORM_DATA_TIMEOUT_MS = 30_000;

/**
 * Handle the transform_data tool call.
 *
 * 1. Validates input/output file paths are within session boundaries
 * 2. Writes script to temp file
 * 3. Spawns subprocess with env var isolation
 * 4. Returns absolute output path for use in datatable/html-preview blocks
 */
export async function handleTransformData(
  ctx: SessionToolContext,
  args: TransformDataArgs
): Promise<ToolResult> {
  if (!ctx.sessionPath || !ctx.dataPath) {
    return errorResponse('transform_data requires sessionPath and dataPath in context.');
  }

  const sessionDir = ctx.sessionPath;
  const dataDir = ctx.dataPath;

  // Validate outputFile doesn't escape data/ directory
  const resolvedOutput = resolve(dataDir, args.outputFile);
  if (!resolvedOutput.startsWith(normalize(dataDir))) {
    return errorResponse(
      `outputFile must be within the session data directory. Got: ${args.outputFile}`
    );
  }

  // Resolve and validate input files (relative to session dir)
  const resolvedInputs: string[] = [];
  for (const inputFile of args.inputFiles) {
    const resolvedInput = resolve(sessionDir, inputFile);
    if (!resolvedInput.startsWith(normalize(sessionDir))) {
      return errorResponse(
        `inputFile must be within the session directory. Got: ${inputFile}`
      );
    }
    if (!existsSync(resolvedInput)) {
      return errorResponse(`input file not found: ${inputFile}`);
    }
    resolvedInputs.push(resolvedInput);
  }

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // Write script to temp file
  const ext = args.language === 'python3' ? '.py' : '.js';
  const tempScript = join(tmpdir(), `craft-transform-${ctx.sessionId}-${Date.now()}${ext}`);
  writeFileSync(tempScript, args.script, 'utf-8');

  try {
    // Build command
    // Use bundled uv for Python when available (ensures consistent Python 3.12 + deps)
    const useUv = args.language === 'python3' && !!process.env.CRAFT_UV;
    const cmd = useUv ? process.env.CRAFT_UV! : (args.language === 'python3' ? 'python3' : args.language);
    const spawnArgs = useUv
      ? ['run', '--python', '3.12', tempScript, ...resolvedInputs, resolvedOutput]
      : [tempScript, ...resolvedInputs, resolvedOutput];

    // Strip sensitive env vars
    const env = { ...process.env };
    for (const key of BLOCKED_ENV_VARS) {
      delete env[key];
    }

    // Spawn subprocess with manual timeout that escalates to SIGKILL.
    // We can't rely on spawn()'s built-in `timeout` option because it only sends
    // SIGTERM, which can be caught/ignored — leaving the promise hanging forever.
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolvePromise, reject) => {
      const child = spawn(cmd, spawnArgs, {
        cwd: dataDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, TRANSFORM_DATA_TIMEOUT_MS);

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (timedOut) {
          resolvePromise({ stdout, stderr: `Script timed out after ${TRANSFORM_DATA_TIMEOUT_MS / 1000}s and was killed`, code });
        } else {
          resolvePromise({ stdout, stderr, code });
        }
      });

      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
    });

    if (result.code !== 0) {
      const errorOutput = result.stderr || result.stdout || 'Script exited with non-zero code';
      return errorResponse(
        `Script failed (exit code ${result.code}):\n${errorOutput.slice(0, 2000)}`
      );
    }

    // Verify output file was created
    if (!existsSync(resolvedOutput)) {
      return errorResponse(
        `Script completed but output file was not created: ${args.outputFile}\n\nStdout: ${result.stdout.slice(0, 500)}`
      );
    }

    // Return the absolute path for use in the datatable/spreadsheet/html-preview "src" field
    const lines = [`Output written to: ${resolvedOutput}`];
    lines.push(`\nUse this absolute path as the "src" value in your datatable, spreadsheet, html-preview, or pdf-preview block.`);
    if (result.stdout.trim()) {
      lines.push(`\nStdout:\n${result.stdout.slice(0, 500)}`);
    }

    return successResponse(lines.join(''));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Error running script: ${msg}`);
  } finally {
    // Clean up temp script
    try { unlinkSync(tempScript); } catch { /* ignore */ }
  }
}
