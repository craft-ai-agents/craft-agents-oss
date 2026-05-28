import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

export type PowerShellKind = 'pwsh' | 'powershell.exe';

interface PowerShellDiscovery {
  exe: string;
  kind: PowerShellKind;
}

interface PowerShellResult {
  shell: PowerShellKind;
  cwd: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

interface ExecutePowerShellOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxLines?: number;
  signal?: AbortSignal;
}

interface PowerShellToolDeps {
  executePowerShell?: (options: ExecutePowerShellOptions) => Promise<PowerShellResult>;
}

interface PowerShellToolParams {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxLines?: number;
}

let cachedDiscovery: PowerShellDiscovery | null = null;

function textResult(text: string, isError = false): AgentToolResult<{ isError?: boolean }> {
  return {
    content: [{ type: 'text', text }],
    details: isError ? { isError: true } : {},
  };
}

function truncateOutput(text: string, maxBytes: number, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  let result = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text;
  let truncated = lines.length > maxLines;

  const bytes = Buffer.byteLength(result, 'utf8');
  if (bytes > maxBytes) {
    result = Buffer.from(result, 'utf8').subarray(0, maxBytes).toString('utf8');
    truncated = true;
  }

  return {
    text: truncated ? `${result}\n\n[Output truncated]` : result,
    truncated,
  };
}

function shellKind(exe: string): PowerShellKind {
  return exe.toLowerCase().includes('pwsh') ? 'pwsh' : 'powershell.exe';
}

function spawnPowerShell(
  shellExe: string,
  command: string,
  options: {
    cwd?: string;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<PowerShellResult> {
  const cwd = options.cwd || process.cwd();

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn(shellExe, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const finish = (result: PowerShellResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      resolve(result);
    };

    const abort = (): void => {
      proc.kill();
      finish({
        shell: shellKind(shellExe),
        cwd,
        command,
        exitCode: -1,
        stdout,
        stderr: 'Command aborted',
        timedOut: false,
        truncated: false,
      });
    };

    const timeout = setTimeout(() => {
      proc.kill();
      finish({
        shell: shellKind(shellExe),
        cwd,
        command,
        exitCode: -1,
        stdout,
        stderr: 'Command timed out',
        timedOut: true,
        truncated: false,
      });
    }, options.timeoutMs);

    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      finish({
        shell: shellKind(shellExe),
        cwd,
        command,
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut: false,
        truncated: false,
      });
    });

    proc.on('error', (error) => {
      finish({
        shell: shellKind(shellExe),
        cwd,
        command,
        exitCode: -1,
        stdout: '',
        stderr: error.message,
        timedOut: false,
        truncated: false,
      });
    });
  });
}

export function clearPowerShellDiscoveryCache(): void {
  cachedDiscovery = null;
}

export async function findPowerShell(): Promise<PowerShellDiscovery> {
  if (cachedDiscovery) return cachedDiscovery;

  const candidates = ['pwsh', 'powershell.exe'];
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    candidates.push(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  }

  for (const exe of candidates) {
    const result = await spawnPowerShell(exe, '$PSVersionTable.PSVersion.ToString()', { timeoutMs: 5000 });
    if (result.exitCode === 0 && result.stdout.trim()) {
      cachedDiscovery = { exe, kind: shellKind(exe) };
      return cachedDiscovery;
    }
  }

  throw new Error('PowerShell is not available on this system');
}

export async function executePowerShell(options: ExecutePowerShellOptions): Promise<PowerShellResult> {
  const discovery = await findPowerShell();
  const result = await spawnPowerShell(discovery.exe, options.command, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 120000,
    signal: options.signal,
  });

  const maxOutputBytes = options.maxOutputBytes ?? 50000;
  const maxLines = options.maxLines ?? 2000;
  const stdout = truncateOutput(result.stdout, maxOutputBytes, maxLines);
  const stderr = truncateOutput(result.stderr, 10000, 200);

  return {
    ...result,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
  };
}

export async function startDetachedPowerShellProcess(options: {
  command: string;
  cwd: string;
  outputFile: string;
  append?: boolean;
}): Promise<{ pid: number; shell: PowerShellKind }> {
  const discovery = await findPowerShell();
  const flags = options.append !== false ? 'a' : 'w';
  mkdirSync(dirname(options.outputFile), { recursive: true });

  return new Promise((resolve, reject) => {
    let fdOut: number;
    let fdErr: number;
    try {
      fdOut = openSync(options.outputFile, flags);
      fdErr = openSync(options.outputFile, flags);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      reject(new Error(`Failed to open output file: ${msg}`));
      return;
    }

    const proc = spawn(discovery.exe, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      options.command,
    ], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', fdOut, fdErr],
    });

    proc.on('error', (error) => {
      try { closeSync(fdOut); } catch {}
      try { closeSync(fdErr); } catch {}
      reject(new Error(`Failed to spawn ${discovery.exe}: ${error.message}`));
    });

    proc.on('close', () => {
      try { closeSync(fdOut); } catch {}
      try { closeSync(fdErr); } catch {}
    });

    if (!proc.pid) {
      try { closeSync(fdOut); } catch {}
      try { closeSync(fdErr); } catch {}
      reject(new Error(`Failed to spawn ${discovery.exe}: no PID returned`));
      return;
    }

    proc.unref();
    resolve({ pid: proc.pid, shell: discovery.kind });
  });
}

export function createPowerShellTool(deps: PowerShellToolDeps = {}): ToolDefinition<any, any> {
  const runPowerShell = deps.executePowerShell ?? executePowerShell;

  return {
    name: 'powershell',
    label: 'PowerShell',
    description:
      'Run a foreground PowerShell command on Windows. Use for Windows-native commands: Windows paths (C:\\, D:\\), ' +
      '$env variables, .exe/.cmd/.bat/.ps1 execution, and Windows system inspection. Returns stdout, stderr, and exit code. ' +
      'Default timeout: 120s. Output is truncated at 50KB/2000 lines.',
    promptSnippet: 'Run a foreground PowerShell command on Windows, with stdout/stderr/exit code and truncated output.',
    parameters: Type.Object({
      command: Type.String({ description: 'PowerShell command to execute' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory, defaults to the active session cwd' })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Timeout in milliseconds, default 120000' })),
      maxOutputBytes: Type.Optional(Type.Number({ description: 'Maximum stdout bytes, default 50000' })),
      maxLines: Type.Optional(Type.Number({ description: 'Maximum stdout lines, default 2000' })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as PowerShellToolParams;
      try {
        const result = await runPowerShell({
          command: input.command,
          cwd: input.cwd ?? ctx.cwd,
          timeoutMs: input.timeoutMs,
          maxOutputBytes: input.maxOutputBytes,
          maxLines: input.maxLines,
          signal,
        });

        const parts = [
          `Shell: ${result.shell}`,
          `CWD: ${result.cwd}`,
          result.timedOut ? '[Command timed out]' : '',
          result.truncated ? '[Output truncated]' : '',
          `Exit code: ${result.exitCode}`,
          result.stdout ? `\nSTDOUT:\n${result.stdout}` : '',
          result.stderr ? `\nSTDERR:\n${result.stderr}` : '',
        ].filter(Boolean);

        return textResult(parts.join('\n'), result.exitCode !== 0);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return textResult(`powershell failed:\nCommand: ${input.command}\nError: ${msg}`, true);
      }
    },
  };
}
