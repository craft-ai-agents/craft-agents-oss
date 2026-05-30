#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(scriptDir, '..');
const repoRoot = resolve(toolDir, '..', '..');
const platformDir = `${process.platform}-${process.arch}`;
const binaryName = process.platform === 'win32' ? 'printify-pp-cli.exe' : 'printify-pp-cli';

function hasFlag(args, flag) {
  return args.includes(flag);
}

function jsonOut(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

function pathCandidates() {
  const candidates = [];
  if (process.env.PRINTIFY_PP_CLI) candidates.push(process.env.PRINTIFY_PP_CLI);
  if (process.env.CRAFT_RESOURCES_BASE) {
    candidates.push(join(process.env.CRAFT_RESOURCES_BASE, 'resources', 'bin', platformDir, binaryName));
  }
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'app', 'resources', 'bin', platformDir, binaryName));
  }
  candidates.push(join(toolDir, 'bin', platformDir, binaryName));
  candidates.push(join(repoRoot, 'apps', 'electron', 'resources', 'bin', platformDir, binaryName));
  candidates.push(join(repoRoot, 'resources', 'bin', platformDir, binaryName));
  candidates.push(join(repoRoot, 'bin', platformDir, binaryName));
  candidates.push(binaryName);
  return candidates;
}

function resolveBinary() {
  for (const candidate of pathCandidates()) {
    if (candidate === binaryName) {
      const onPath = findExecutableOnPath(binaryName);
      if (onPath) return onPath;
      continue;
    }
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findExecutableOnPath(command) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isWriteLike(args) {
  const joined = args.filter((arg) => !arg.startsWith('--')).join(' ').toLowerCase();
  if (!joined.trim()) return false;

  const writePatterns = [
    /\bcreate\b/,
    /\bupdate\b/,
    /\bdelete\b/,
    /\bdisconnect\b/,
    /\barchive\b/,
    /\bpublish(?:ed|ing)?\b/,
    /\bunpublish\b/,
    /\bsubmit\b/,
    /\bfulfill\b/,
    /\border\b.*\bwrite\b/,
    /\bproducts-json\b.*\bcreate/,
    /\bproducts-json\b.*\bupdate/,
    /\buploads\b.*\ban-image\b/,
    /\bshops\b.*\bmanage\b/,
  ];

  return writePatterns.some((pattern) => pattern.test(joined));
}

function approvalPacket(args) {
  const safeArgs = redactSensitiveArgs(args);
  const commandArgv = ['node', 'bin/printify.mjs', ...safeArgs];
  const approveArgv = [...commandArgv, '--confirm-runner'];
  return {
    ok: true,
    requiresApproval: true,
    operation: 'printify.write',
    message: 'No Printify changes were made. Run with --dry-run for provider preview or rerun with --confirm-runner after explicit user approval.',
    command: commandArgv.map(shellQuote).join(' '),
    approveCommand: approveArgv.map(shellQuote).join(' '),
    argv: commandArgv,
    approveArgv,
  };
}

function shellQuote(arg) {
  if (arg === '') return "''";
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

function redactSensitiveArgs(args) {
  const sensitiveName = /token|secret|password|bearer|authorization|api[-_]?key/i;
  const redacted = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      redacted.push('[redacted]');
      redactNext = false;
      continue;
    }
    const eqIndex = arg.indexOf('=');
    const name = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    if (sensitiveName.test(name)) {
      redacted.push(eqIndex === -1 ? arg : `${name}=[redacted]`);
      if (eqIndex === -1) redactNext = true;
    } else {
      redacted.push(arg);
    }
  }
  return redacted;
}

function installationHelp(exitCode = 127) {
  jsonOut({
    ok: false,
    error: 'printify-pp-cli binary not found',
    checked: pathCandidates(),
    fix: 'Install with `npx -y @mvanhorn/printing-press-library install printify --cli-only`, bundle printify-pp-cli under tools/printify/bin/<platform-arch>/, or set PRINTIFY_PP_CLI.',
  }, exitCode);
}

function doctor(binary, args) {
  const tokenConfigured = Boolean(process.env.PRINTIFY_API_TOKEN?.trim());
  if (!binary) {
    installationHelp(127);
    return true;
  }
  if (!tokenConfigured) {
    jsonOut({
      ok: false,
      connectionStatus: 'needs_auth',
      fix: 'Save PRINTIFY_API_TOKEN in RunnerOS Settings -> Secrets.',
    }, 1);
    return true;
  }

  const result = spawnSync(binary, ['doctor', ...args.filter((arg) => arg !== 'doctor')], {
    stdio: 'inherit',
    env: buildEnv(),
  });
  process.exitCode = result.status ?? 0;
  return true;
}

function buildEnv() {
  const env = { ...process.env };
  if (env.PRINTIFY_API_TOKEN && !env.PRINTIFY_BEARER_AUTH) {
    env.PRINTIFY_BEARER_AUTH = env.PRINTIFY_API_TOKEN;
  }
  return env;
}

const args = process.argv.slice(2);
const binary = resolveBinary();
const confirmed = hasFlag(args, '--confirm-runner');
const dryRun = hasFlag(args, '--dry-run');
const passthroughArgs = args.filter((arg) => arg !== '--confirm-runner');

if (args[0] === 'doctor') {
  doctor(binary, args.slice(1));
} else if (isWriteLike(args) && !dryRun && !confirmed) {
  jsonOut(approvalPacket(args));
} else {
  if (!binary) {
    installationHelp(127);
  } else {
    const result = spawnSync(binary, passthroughArgs.length ? passthroughArgs : ['--help'], {
      stdio: 'inherit',
      env: buildEnv(),
    });

    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  }
}
