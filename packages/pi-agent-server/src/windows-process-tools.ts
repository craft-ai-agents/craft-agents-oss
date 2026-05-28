import { Type } from '@sinclair/typebox';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { access, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  executePowerShell,
  findPowerShell,
  startDetachedPowerShellProcess,
  type PowerShellKind,
} from './powershell-tool.ts';

type ProcessStatus = 'running' | 'exited' | 'unknown';

interface ManagedProcess {
  id: string;
  name: string;
  pid: number;
  command: string;
  cwd: string;
  shell: PowerShellKind;
  outputFile: string;
  startedAt: string;
  status: ProcessStatus;
  lastCheckedAt?: string;
  exitCode?: number | null;
}

interface ProcessRegistry {
  version: string;
  processes: ManagedProcess[];
}

interface TailResult {
  lines: string[];
  truncated: boolean;
  totalLines: number;
  linesRead: number;
  fileExists: boolean;
}

const REGISTRY_VERSION = '1.0.0';

function toolResult(text: string, details?: Record<string, unknown>, isError = false): AgentToolResult<any> {
  return {
    content: [{ type: 'text', text }],
    details: isError ? { ...(details ?? {}), isError: true } : details,
  };
}

function getBaseDir(): string {
  return join(process.env.LOCALAPPDATA || tmpdir(), 'pi-windows-shell');
}

function getRegistryPath(): string {
  return join(getBaseDir(), 'processes.json');
}

function getLogsDir(): string {
  return join(getBaseDir(), 'logs');
}

function safeName(name: string, maxLength: number): string {
  return (name || 'process')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, maxLength);
}

function generateProcessId(name: string): string {
  return `${Date.now().toString(36)}-${safeName(name, 20)}`;
}

function getDefaultOutputFile(name: string): string {
  return join(getLogsDir(), `${Date.now().toString(36)}-${safeName(name, 50)}.log`);
}

async function loadRegistry(): Promise<ProcessRegistry> {
  await mkdir(getBaseDir(), { recursive: true });
  try {
    await access(getRegistryPath());
  } catch {
    return { version: REGISTRY_VERSION, processes: [] };
  }

  try {
    const content = await readFile(getRegistryPath(), 'utf8');
    const registry = JSON.parse(content) as ProcessRegistry;
    if (!registry.version || !Array.isArray(registry.processes)) {
      return { version: REGISTRY_VERSION, processes: [] };
    }
    return registry;
  } catch {
    return { version: REGISTRY_VERSION, processes: [] };
  }
}

async function saveRegistry(registry: ProcessRegistry): Promise<void> {
  await mkdir(getBaseDir(), { recursive: true });
  await writeFile(getRegistryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

async function addProcess(processEntry: ManagedProcess): Promise<void> {
  const registry = await loadRegistry();
  registry.processes.push(processEntry);
  await saveRegistry(registry);
}

async function updateProcess(id: string, updates: Partial<ManagedProcess>): Promise<boolean> {
  const registry = await loadRegistry();
  const index = registry.processes.findIndex((processEntry) => processEntry.id === id);
  if (index === -1) return false;
  registry.processes[index] = { ...registry.processes[index], ...updates };
  await saveRegistry(registry);
  return true;
}

async function getProcess(id: string): Promise<ManagedProcess | null> {
  const registry = await loadRegistry();
  return registry.processes.find((processEntry) => processEntry.id === id) ?? null;
}

async function getAllProcesses(): Promise<ManagedProcess[]> {
  return (await loadRegistry()).processes;
}

async function removeProcesses(ids: string[]): Promise<number> {
  const registry = await loadRegistry();
  const idSet = new Set(ids);
  const initialLength = registry.processes.length;
  registry.processes = registry.processes.filter((processEntry) => !idSet.has(processEntry.id));
  const removed = initialLength - registry.processes.length;
  if (removed > 0) await saveRegistry(registry);
  return removed;
}

async function cleanupRegistry(options: {
  removeExited: boolean;
  deleteLogs: boolean;
  olderThanDays: number;
}): Promise<{ removedEntries: number; deletedLogs: number; keptRunning: number }> {
  const registry = await loadRegistry();
  const toRemove: string[] = [];
  let deletedLogs = 0;

  if (options.deleteLogs) {
    const olderThan = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000;
    for (const processEntry of registry.processes) {
      try {
        const fileStat = await stat(processEntry.outputFile);
        if (fileStat.mtimeMs < olderThan) {
          await unlink(processEntry.outputFile);
          deletedLogs++;
        }
      } catch {}
    }
  }

  if (options.removeExited) {
    for (const processEntry of registry.processes) {
      if (processEntry.status === 'exited') toRemove.push(processEntry.id);
    }
  }

  const removedEntries = await removeProcesses(toRemove);
  const removedIds = new Set(toRemove);
  const keptRunning = registry.processes.filter(
    (processEntry) => !removedIds.has(processEntry.id) && processEntry.status === 'running',
  ).length;

  return { removedEntries, deletedLogs, keptRunning };
}

async function tailFile(filePath: string, options: { lines: number; maxBytes: number }): Promise<TailResult> {
  try {
    await access(filePath);
  } catch {
    return { lines: [], truncated: false, totalLines: 0, linesRead: 0, fileExists: false };
  }

  const fileStat = await stat(filePath);
  if (fileStat.size <= options.maxBytes) {
    const content = await readFile(filePath, 'utf8');
    const allLines = content.split(/\r?\n/).filter((line) => line.length > 0);
    const tailLines = allLines.slice(-options.lines);
    return {
      lines: tailLines,
      truncated: allLines.length > tailLines.length,
      totalLines: allLines.length,
      linesRead: tailLines.length,
      fileExists: true,
    };
  }

  const fd = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(options.maxBytes);
    const startPos = Math.max(0, fileStat.size - options.maxBytes);
    const { bytesRead } = await fd.read(buffer, 0, options.maxBytes, startPos);
    const content = buffer.toString('utf8', 0, bytesRead);
    const allLines = content.split(/\r?\n/);
    const skipPartial = startPos > 0 && !content.startsWith('\n') && !content.startsWith('\r');
    const lineStart = skipPartial ? 1 : 0;
    const tailStartIndex = Math.max(lineStart, allLines.length - options.lines);
    const tailLines = allLines.slice(tailStartIndex);
    return {
      lines: tailLines,
      truncated: tailStartIndex > lineStart,
      totalLines: allLines.length - lineStart,
      linesRead: tailLines.length,
      fileExists: true,
    };
  } finally {
    await fd.close();
  }
}

async function isPidAlive(pid: number, cwd: string): Promise<boolean> {
  const result = await executePowerShell({
    command: `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
    timeoutMs: 10000,
    cwd,
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function resolveProcessTarget(id: string | undefined, pid: number | undefined): Promise<{
  entry: ManagedProcess | null;
  pid: number;
} | null> {
  if (id) {
    const entry = await getProcess(id);
    return entry ? { entry, pid: entry.pid } : null;
  }
  return typeof pid === 'number' ? { entry: null, pid } : null;
}

function createWinStartProcessTool(): ToolDefinition<any, any> {
  return {
    name: 'win_start_process',
    label: 'Start Windows Process',
    description:
      'Start a long-running/background Windows process through PowerShell and capture output to a persistent log file. ' +
      'Use for dev servers, watchers, and long-running scripts that should not block the agent.',
    promptSnippet: 'Start a background Windows process through PowerShell and log its output to a file.',
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: 'Human-readable name for the process' })),
      command: Type.String({ description: 'PowerShell command to run in background' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory, defaults to the active session cwd' })),
      outputFile: Type.Optional(Type.String({ description: 'Custom output file path, default is auto-generated' })),
      append: Type.Optional(Type.Boolean({ description: 'Append to output file instead of overwriting, default true' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { name?: string; command: string; cwd?: string; outputFile?: string; append?: boolean };
      try {
        const name = input.name || safeName(input.command.slice(0, 50), 50);
        const id = generateProcessId(name);
        const cwd = input.cwd ?? ctx.cwd;
        const outputFile = input.outputFile || getDefaultOutputFile(name);
        await mkdir(getLogsDir(), { recursive: true });

        const { pid, shell } = await startDetachedPowerShellProcess({
          command: input.command,
          cwd,
          outputFile,
          append: input.append,
        });

        const entry: ManagedProcess = {
          id,
          name,
          pid,
          command: input.command,
          cwd,
          shell,
          outputFile,
          startedAt: new Date().toISOString(),
          status: 'running',
        };
        await addProcess(entry);

        return toolResult([
          'Started process.',
          `ID: ${id}`,
          `NAME: ${name}`,
          `PID: ${pid}`,
          `CWD: ${cwd}`,
          `OUTPUT_FILE: ${outputFile}`,
          `COMMAND: ${input.command}`,
        ].join('\n'), { id, pid, outputFile, shell });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_start_process failed:\nCommand: ${input.command}\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinProcessStatusTool(): ToolDefinition<any, any> {
  return {
    name: 'win_process_status',
    label: 'Windows Process Status',
    description: 'Check whether a managed process ID or raw PID is alive. Updates the registry when checking by ID.',
    promptSnippet: 'Check whether a background Windows process is still running by registry ID or PID.',
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: 'Registry ID returned by win_start_process' })),
      pid: Type.Optional(Type.Number({ description: 'Raw Windows process ID' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { id?: string; pid?: number };
      try {
        if (!input.id && !input.pid) {
          return toolResult('win_process_status requires either id or pid parameter.');
        }
        const target = await resolveProcessTarget(input.id, input.pid);
        if (!target) return toolResult(`No process found with ID: ${input.id}`);

        const alive = await isPidAlive(target.pid, ctx.cwd);
        const status: ProcessStatus = alive ? 'running' : 'exited';
        if (target.entry) {
          await updateProcess(target.entry.id, { status, lastCheckedAt: new Date().toISOString() });
        }

        return toolResult([
          `ID: ${target.entry?.id ?? 'n/a'}`,
          `PID: ${target.pid}`,
          `STATUS: ${status}`,
          ...(target.entry ? [
            `NAME: ${target.entry.name}`,
            `COMMAND: ${target.entry.command}`,
            `OUTPUT_FILE: ${target.entry.outputFile}`,
            `STARTED_AT: ${target.entry.startedAt}`,
          ] : []),
        ].join('\n'), { id: target.entry?.id, pid: target.pid, status, alive });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_process_status failed:\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinReadOutputTool(): ToolDefinition<any, any> {
  return {
    name: 'win_read_output',
    label: 'Read Windows Process Output',
    description: 'Read tail output from a process started by win_start_process by registry ID or direct output file path.',
    promptSnippet: 'Read the tail of a background Windows process log by ID or output file path.',
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: 'Registry ID returned by win_start_process' })),
      outputFile: Type.Optional(Type.String({ description: 'Direct path to the output log file' })),
      tailLines: Type.Optional(Type.Number({ description: 'Number of tail lines to read, default 100' })),
      maxBytes: Type.Optional(Type.Number({ description: 'Maximum bytes to read, default 50000' })),
    }),
    async execute(_toolCallId, params) {
      const input = params as { id?: string; outputFile?: string; tailLines?: number; maxBytes?: number };
      try {
        if (!input.id && !input.outputFile) {
          return toolResult('win_read_output requires either id or outputFile parameter.');
        }

        const entry = input.id ? await getProcess(input.id) : null;
        if (input.id && !entry) return toolResult(`No process found with ID: ${input.id}`);
        const outputFile = entry?.outputFile ?? input.outputFile!;
        const tail = await tailFile(outputFile, {
          lines: input.tailLines ?? 100,
          maxBytes: input.maxBytes ?? 50000,
        });

        if (!tail.fileExists) {
          return toolResult(`Output file does not exist yet.\nThe process may not have written output.\nFile: ${outputFile}`, { outputFile });
        }
        if (tail.lines.length === 0) {
          return toolResult(`Output file exists but is empty (0 bytes).\nThe process may not have written output yet.\nFile: ${outputFile}`, { outputFile });
        }

        return toolResult([
          `OUTPUT_FILE: ${outputFile}`,
          `LINES_SHOWN: ${tail.linesRead}`,
          `TRUNCATED: ${tail.truncated}`,
          '',
          tail.lines.join('\n'),
        ].join('\n'), { outputFile, ...tail });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_read_output failed:\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinStopProcessTool(): ToolDefinition<any, any> {
  return {
    name: 'win_stop_process',
    label: 'Stop Windows Process',
    description: 'Stop a Windows process by registry ID or PID. Uses taskkill /T /F by default to kill the process tree.',
    promptSnippet: 'Stop a background Windows process by registry ID or PID.',
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: 'Registry ID returned by win_start_process' })),
      pid: Type.Optional(Type.Number({ description: 'Raw Windows process ID' })),
      force: Type.Optional(Type.Boolean({ description: 'Force kill, default true' })),
      tree: Type.Optional(Type.Boolean({ description: 'Kill process tree, default true' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { id?: string; pid?: number; force?: boolean; tree?: boolean };
      try {
        if (!input.id && !input.pid) {
          return toolResult('win_stop_process requires either id or pid parameter.');
        }
        const target = await resolveProcessTarget(input.id, input.pid);
        if (!target) return toolResult(`No process found with ID: ${input.id}`);

        const force = input.force !== false;
        const tree = input.tree !== false;
        const command = tree
          ? `taskkill /PID ${target.pid} /T${force ? ' /F' : ''}`
          : `Stop-Process -Id ${target.pid}${force ? ' -Force' : ''} -ErrorAction SilentlyContinue`;
        const killResult = await executePowerShell({ command, timeoutMs: 15000, cwd: ctx.cwd });

        if (killResult.exitCode !== 0 && killResult.exitCode !== 128) {
          const alreadyGone = /not found|no running/i.test(`${killResult.stdout}\n${killResult.stderr}`);
          if (!alreadyGone) {
            return toolResult([
              `Attempted to kill PID ${target.pid} (tree=${tree}, force=${force})`,
              `Exit code: ${killResult.exitCode}`,
              `STDERR: ${killResult.stderr}`,
            ].join('\n'), { pid: target.pid, killed: false, exitCode: killResult.exitCode }, true);
          }
        }

        if (target.entry) {
          await updateProcess(target.entry.id, { status: 'exited', lastCheckedAt: new Date().toISOString() });
        }

        return toolResult([
          'Stopped process.',
          `ID: ${target.entry?.id ?? 'n/a'}`,
          `PID: ${target.pid}`,
          `TREE: ${tree}`,
          `FORCE: ${force}`,
        ].join('\n'), { id: target.entry?.id, pid: target.pid, killed: true, tree, force });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_stop_process failed:\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinListProcessesTool(): ToolDefinition<any, any> {
  return {
    name: 'win_list_processes',
    label: 'List Windows Processes',
    description: 'List processes tracked by the persistent Windows process registry. Can refresh live PID statuses.',
    promptSnippet: 'List tracked background Windows processes with status.',
    parameters: Type.Object({
      includeExited: Type.Optional(Type.Boolean({ description: 'Include exited processes, default false' })),
      refresh: Type.Optional(Type.Boolean({ description: 'Check each PID live before reporting, default true' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { includeExited?: boolean; refresh?: boolean };
      try {
        const includeExited = input.includeExited ?? false;
        const refresh = input.refresh ?? true;
        let processes = await getAllProcesses();

        if (refresh) {
          for (const processEntry of processes) {
            try {
              const alive = await isPidAlive(processEntry.pid, ctx.cwd);
              const status: ProcessStatus = alive ? 'running' : 'exited';
              if (status !== processEntry.status) {
                await updateProcess(processEntry.id, { status, lastCheckedAt: new Date().toISOString() });
              }
            } catch {}
          }
          processes = await getAllProcesses();
        }

        const filtered = includeExited ? processes : processes.filter((processEntry) => processEntry.status !== 'exited');
        if (filtered.length === 0) {
          return toolResult(`No tracked processes.${includeExited ? ' (including exited)' : ''}`, { count: 0 });
        }

        const header = 'ID | NAME | PID | STATUS | STARTED_AT | CWD';
        const rows = filtered.map((processEntry) =>
          `${processEntry.id} | ${processEntry.name.slice(0, 20)} | ${processEntry.pid} | ${processEntry.status} | ${processEntry.startedAt.slice(0, 19)} | ${processEntry.cwd.slice(0, 40)}`,
        );
        return toolResult([header, '-'.repeat(header.length), ...rows, '', `Total: ${filtered.length} process(es)`].join('\n'), {
          count: filtered.length,
          processes: filtered,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_list_processes failed:\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinKillPortTool(): ToolDefinition<any, any> {
  return {
    name: 'win_kill_port',
    label: 'Kill Windows Port',
    description: 'Find and kill Windows processes listening on a TCP port using Get-NetTCPConnection, falling back to netstat.',
    promptSnippet: 'Kill Windows processes listening on a TCP port.',
    parameters: Type.Object({
      port: Type.Number({ description: 'TCP port number to free' }),
      force: Type.Optional(Type.Boolean({ description: 'Force kill, default true' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { port: number; force?: boolean };
      try {
        const force = input.force !== false;
        let pids: number[] = [];
        const psResult = await executePowerShell({
          command: `Get-NetTCPConnection -LocalPort ${input.port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
          timeoutMs: 15000,
          cwd: ctx.cwd,
        });

        if (psResult.exitCode === 0 && psResult.stdout.trim()) {
          pids = psResult.stdout.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter((pid) => Number.isFinite(pid) && pid > 0);
        } else {
          const netstatResult = await executePowerShell({
            command: `netstat -ano | findstr :${input.port}`,
            timeoutMs: 15000,
            cwd: ctx.cwd,
          });
          const pidSet = new Set<number>();
          for (const line of netstatResult.stdout.split(/\r?\n/).filter(Boolean)) {
            const match = line.match(/:(\d+)\s+.*\s+(\d+)\s*$/);
            if (match && Number.parseInt(match[1], 10) === input.port) {
              pidSet.add(Number.parseInt(match[2], 10));
            }
          }
          pids = Array.from(pidSet);
        }

        if (pids.length === 0) {
          return toolResult(`No process found listening on port ${input.port}.`, { port: input.port, pidsFound: [] });
        }

        const killed: number[] = [];
        for (const pid of pids) {
          const result = await executePowerShell({
            command: `taskkill /PID ${pid} /T${force ? ' /F' : ''}`,
            timeoutMs: 10000,
            cwd: ctx.cwd,
          });
          if (result.exitCode === 0 || result.exitCode === 128) killed.push(pid);
        }

        return toolResult([
          `PORT: ${input.port}`,
          `PIDS_FOUND: ${pids.join(', ')}`,
          `KILLED: ${killed.length > 0 ? killed.join(', ') : 'none'}`,
        ].join('\n'), { port: input.port, pidsFound: pids, killed });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_kill_port failed:\nPort: ${input.port}\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinWhichTool(): ToolDefinition<any, any> {
  return {
    name: 'win_which',
    label: 'Windows Which',
    description: 'Discover Windows commands using PowerShell Get-Command, falling back to cmd where.',
    promptSnippet: 'Find the location of a Windows command.',
    parameters: Type.Object({
      command: Type.String({ description: 'Command name to locate' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as { command: string };
      try {
        const psResult = await executePowerShell({
          command: `Get-Command ${input.command} -ErrorAction SilentlyContinue | Format-List Source,Version,CommandType,Name`,
          timeoutMs: 15000,
          cwd: ctx.cwd,
        });

        if (psResult.exitCode === 0 && psResult.stdout.trim()) {
          const parsed: Record<string, string> = {};
          for (const line of psResult.stdout.split(/\r?\n/).filter(Boolean)) {
            const match = line.match(/^(\w+)\s*:\s*(.+)$/);
            if (match) parsed[match[1].toLowerCase()] = match[2].trim();
          }
          return toolResult([
            `COMMAND: ${input.command}`,
            'FOUND: true',
            `SOURCE: ${parsed.source ?? 'unknown'}`,
            `VERSION: ${parsed.version ?? 'unknown'}`,
            `COMMAND_TYPE: ${parsed.commandtype ?? 'unknown'}`,
          ].join('\n'), {
            command: input.command,
            found: true,
            source: parsed.source,
            version: parsed.version,
            commandType: parsed.commandtype,
          });
        }

        const cmdResult = await executePowerShell({
          command: `cmd /c "where ${input.command} 2>nul"`,
          timeoutMs: 10000,
          cwd: ctx.cwd,
        });
        const paths = cmdResult.stdout.split(/\r?\n/).filter(Boolean);
        if (cmdResult.exitCode === 0 && paths.length > 0) {
          return toolResult([
            `COMMAND: ${input.command}`,
            'FOUND: true',
            `SOURCE: ${paths[0]}`,
            `ALL_LOCATIONS:\n${paths.join('\n')}`,
          ].join('\n'), { command: input.command, found: true, source: paths[0], allPaths: paths });
        }

        return toolResult(`COMMAND: ${input.command}\nFOUND: false`, { command: input.command, found: false });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_which failed:\nCommand: ${input.command}\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

function createWinCleanupProcessesTool(): ToolDefinition<any, any> {
  return {
    name: 'win_cleanup_processes',
    label: 'Cleanup Windows Processes',
    description: 'Clean stale registry entries and optionally delete old log files.',
    promptSnippet: 'Remove stale Windows process records and old log files.',
    parameters: Type.Object({
      removeExited: Type.Optional(Type.Boolean({ description: 'Remove exited process entries, default true' })),
      deleteLogs: Type.Optional(Type.Boolean({ description: 'Delete old log files, default false' })),
      olderThanDays: Type.Optional(Type.Number({ description: 'Age threshold in days for log deletion, default 7' })),
    }),
    async execute(_toolCallId, params) {
      const input = params as { removeExited?: boolean; deleteLogs?: boolean; olderThanDays?: number };
      try {
        const result = await cleanupRegistry({
          removeExited: input.removeExited ?? true,
          deleteLogs: input.deleteLogs ?? false,
          olderThanDays: input.olderThanDays ?? 7,
        });
        return toolResult([
          'CLEANUP SUMMARY',
          `Removed registry entries: ${result.removedEntries}`,
          `Deleted log files: ${result.deletedLogs}`,
          `Kept running processes: ${result.keptRunning}`,
        ].join('\n'), result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return toolResult(`win_cleanup_processes failed:\nError: ${msg}`, { error: msg }, true);
      }
    },
  };
}

export function createWindowsProcessTools(): ToolDefinition<any, any>[] {
  return [
    createWinStartProcessTool(),
    createWinProcessStatusTool(),
    createWinReadOutputTool(),
    createWinStopProcessTool(),
    createWinListProcessesTool(),
    createWinKillPortTool(),
    createWinWhichTool(),
    createWinCleanupProcessesTool(),
  ];
}

export type WindowsShellCommandName = 'win-shell-info' | 'win-processes' | 'win-cleanup';

export async function runWindowsShellCommand(
  command: WindowsShellCommandName,
  cwd: string,
): Promise<{ text: string; details?: Record<string, unknown> }> {
  if (command === 'win-shell-info') {
    const discovery = await findPowerShell();
    const versionResult = await executePowerShell({
      command: '$PSVersionTable.PSVersion.ToString()',
      timeoutMs: 10000,
      cwd,
    });
    const version = versionResult.exitCode === 0 ? versionResult.stdout.trim() : 'unknown';
    return {
      text: [
        `Shell: ${discovery.exe} (${discovery.kind})`,
        `Version: ${version || 'unknown'}`,
        `Registry: ${getRegistryPath()}`,
        `Logs: ${getLogsDir()}`,
        `Base: ${getBaseDir()}`,
      ].join('\n'),
      details: {
        shell: discovery.exe,
        kind: discovery.kind,
        version,
        registryPath: getRegistryPath(),
        logsDir: getLogsDir(),
        baseDir: getBaseDir(),
      },
    };
  }

  if (command === 'win-processes') {
    const processes = await getAllProcesses();
    if (processes.length === 0) {
      return { text: 'No tracked processes.', details: { count: 0 } };
    }
    const lines = processes.map(
      (processEntry) =>
        `[${processEntry.status}] ${processEntry.id}  PID:${processEntry.pid}  ${processEntry.name}  ${processEntry.command.slice(0, 60)}`,
    );
    return {
      text: lines.join('\n'),
      details: { count: processes.length, processes },
    };
  }

  const result = await cleanupRegistry({
    removeExited: true,
    deleteLogs: false,
    olderThanDays: 7,
  });
  return {
    text: `Removed ${result.removedEntries} entries, kept ${result.keptRunning} running.`,
    details: result,
  };
}
