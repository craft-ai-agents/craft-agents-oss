/**
 * Node-only exec/which хелперы для toolchain.
 * ВАЖНО: встроенный сервер в packaged Electron-приложении исполняется под
 * Node (не Bun) — весь toolchain обязан работать без Bun-глобалей.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isWindows = process.platform === 'win32';

/**
 * Спавн команды; reject с stderr при ненулевом exit-code / ошибке спавна.
 * Без shell — аргументы идут как есть (инъекция через argv невозможна).
 */
export async function runCommand(
  cmd: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
  const [bin, ...args] = cmd;
  if (!bin) throw new Error('runCommand: empty command');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd.join(' ')} exited ${code}: ${stderr.trim()}`));
    });
  });
}

/** Файл существует и исполняем (на win32 — просто существует). */
async function isExecutable(file: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return false;
    if (!isWindows) await fs.promises.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Имена-кандидаты: на Windows исполняемый файл имеет расширение. */
function candidates(name: string): string[] {
  if (!isWindows) return [name];
  if (/\.(exe|cmd|bat)$/i.test(name)) return [name];
  return [`${name}.exe`, `${name}.cmd`, name];
}

/** Кросс-платформенный «which» без Bun.which (Electron main = plain Node). */
export async function whichTool(name: string, pathEnv?: string): Promise<string | null> {
  const dirs = (pathEnv ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidates(name)) {
      const full = path.join(dir, candidate);
      if (await isExecutable(full)) return full;
    }
  }
  return null;
}
