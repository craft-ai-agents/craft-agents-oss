#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(scriptDir, '..');
const repoRoot = resolve(toolDir, '..', '..');
const platformDir = `${process.platform}-${process.arch}`;
const binaryName = process.platform === 'win32' ? 'google-ads-pp-cli.exe' : 'google-ads-pp-cli';

function pathCandidates() {
  const candidates = [];
  if (process.env.GOOGLE_ADS_PP_CLI) candidates.push(process.env.GOOGLE_ADS_PP_CLI);
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
    if (candidate === binaryName || existsSync(candidate)) return candidate;
  }
  return null;
}

function loadRunnerOsCredentials() {
  const cachePath = join(homedir(), '.config', 'runneros', 'google-ads', 'credentials.json');
  if (!existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return {
      GOOGLE_ADS_ACCESS_TOKEN: parsed.accessToken,
      GOOGLE_ADS_DEVELOPER_TOKEN: parsed.developerToken,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: parsed.loginCustomerId,
    };
  } catch {
    return {};
  }
}

const binary = resolveBinary();
if (!binary) {
  console.error(JSON.stringify({
    ok: false,
    error: 'google-ads-pp-cli binary not found',
    checked: pathCandidates(),
    fix: 'Bundle google-ads-pp-cli under apps/electron/resources/bin/<platform-arch>/ or set GOOGLE_ADS_PP_CLI.',
  }, null, 2));
  process.exit(127);
}

const args = process.argv.slice(2);
const cachedCredentials = loadRunnerOsCredentials();
const env = { ...process.env };
for (const [key, value] of Object.entries(cachedCredentials)) {
  if (!env[key] && typeof value === 'string' && value.trim()) {
    env[key] = value;
  }
}

const result = spawnSync(binary, args.length ? args : ['--help'], {
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
