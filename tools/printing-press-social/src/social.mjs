#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BROWSER_ENGINE, checkBrowserEngine } from './browser-engines.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REGISTRY_PATH = path.join(ROOT, 'registry.json');

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    status: 'failed',
    error: error.message,
    code: error.code || 'UNHANDLED_ERROR',
  }, null, 2)}\n`);
  process.exit(1);
});

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'repl') {
    await runRepl();
    return;
  }

  if (argv.includes('--help') || argv[0] === 'help') {
    printHelp();
    return;
  }

  if (argv[0] === 'registry') {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    if (argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    } else {
      console.log(registry.commands.map((cmd) => `${cmd.verb} ${cmd.platform}`).join('\n'));
    }
    return;
  }

  if (argv[0] === 'doctor') {
    await runDoctor(argv.slice(1));
    return;
  }

  const platform = resolvePlatform(argv);
  if (!platform) {
    throw new CliError(`Could not resolve platform from command: ${argv.join(' ')}`, 'PLATFORM_REQUIRED');
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const entry = registry.platforms[platform];
  if (!entry) throw new CliError(`Unsupported platform: ${platform}`, 'UNSUPPORTED_PLATFORM');

  const cliPath = path.join(ROOT, entry.path, entry.entrypoint);
  const result = await run(process.execPath, [cliPath, ...argv]);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

async function runRepl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('social REPL. Type commands after `social`, or `exit`.');
  while (true) {
    const line = (await rl.question('social> ')).trim();
    if (!line || line === 'exit' || line === 'quit') break;
    const args = splitArgs(line);
    const result = await run(process.execPath, [path.join(ROOT, 'src/social.mjs'), ...args]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  rl.close();
}

async function runDoctor(args) {
  const flags = parseFlags(args);
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const checks = [];
  const platforms = [];
  const browserEngine = process.env.SOCIAL_BROWSER_ENGINE || DEFAULT_BROWSER_ENGINE;
  const browserEngineAvailability = checkBrowserEngine(browserEngine, registry, ROOT);

  checks.push({
    name: 'browser-engine',
    ok: browserEngineAvailability.available !== false,
    engine: browserEngine,
    ...browserEngineAvailability,
  });

  checks.push({
    name: 'schemas',
    ok: fs.existsSync(path.join(ROOT, registry.schemas.action)) && fs.existsSync(path.join(ROOT, registry.schemas.result)),
    actionSchema: registry.schemas.action,
    resultSchema: registry.schemas.result,
  });

  for (const [platform, entry] of Object.entries(registry.platforms)) {
    const cliPath = path.join(ROOT, entry.path, entry.entrypoint);
    const platformResult = {
      platform,
      ok: fs.existsSync(cliPath),
      cliPath,
      harnessPath: path.join(ROOT, entry.path, entry.harness),
      skillPath: path.join(ROOT, entry.path, entry.skill),
      profiles: [],
    };

    if (platformResult.ok) {
      const list = await runJson(process.execPath, [cliPath, 'profile', 'list', '--json']);
      if (list.ok && list.data.ok) {
        for (const profile of (list.data.profiles || []).filter((item) => item.platform === platform)) {
          const status = await runJson(process.execPath, [
            cliPath,
            'profile',
            'status',
            platform,
            '--profile',
            profile.id,
            '--json',
            ...(flags.live ? ['--live'] : []),
          ]);
          platformResult.profiles.push({
            id: profile.id,
            confirmPolicy: profile.confirmPolicy,
            browserEngine: profile.browserEngine,
            ready: status.ok ? status.data.ready : false,
            localSessionExists: status.ok ? status.data.localSessionExists : false,
            live: status.ok ? status.data.live || null : null,
            error: status.ok ? null : status.error,
          });
        }
      } else {
        platformResult.ok = false;
        platformResult.error = list.error || list.data?.error || 'profile list failed';
      }
    }

    platforms.push(platformResult);
  }

  const ok = checks.every((check) => check.ok) && platforms.every((platform) => platform.ok);
  const result = {
    ok,
    status: ok ? 'succeeded' : 'failed',
    command: 'doctor',
    model: registry.model,
    browserEngine,
    liveChecked: Boolean(flags.live),
    checks,
    platforms,
    next: [
      'Add profiles with social profile add <platform> --profile <name> --json',
      'Login with social profile login <platform> --profile <name>',
      'Verify sessions with social doctor --live --json',
      'Dry-run every action before live execution',
    ],
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`${result.status}: ${result.command}`);
  for (const platform of platforms) {
    console.log(`${platform.platform}: ${platform.ok ? 'ok' : 'failed'} profiles=${platform.profiles.length}`);
  }
}

function splitArgs(line) {
  return line.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) || [];
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const raw = token.slice(2);
    const [key, inline] = raw.split('=', 2);
    if (inline !== undefined) {
      out[key] = inline;
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function resolvePlatform(argv) {
  const [group, command, maybePlatform] = argv;
  if (group === 'profile') return argv.find((part) => ['instagram', 'tiktok', 'x', 'youtube'].includes(part));
  if (['post', 'comment', 'dm'].includes(group)) return command;
  if (maybePlatform && ['instagram', 'tiktok', 'x', 'youtube'].includes(maybePlatform)) return maybePlatform;
  return null;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runJson(command, args) {
  const result = await run(command, args);
  if (result.code !== 0) {
    return { ok: false, error: result.stderr || result.stdout || `Exited ${result.code}` };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `Invalid JSON from ${args.join(' ')}: ${error.message}` };
  }
}

function printHelp() {
  console.log(`social - root dispatcher for Printing Press CLIs

Commands:
  social registry --json
  social doctor --json
  social doctor --live --json
  social repl
  social profile add instagram --profile artist01 --json
  social profile add tiktok --profile creator01 --json
  social profile add x --profile artist01 --json
  social profile add youtube --profile channel01 --json
  social post instagram --profile artist01 --text "caption" --media image.jpg --dry-run --json
  social post tiktok --profile creator01 --text "caption" --media video.mp4 --dry-run --json
  social post x --profile artist01 --text "post text" --dry-run --json
  social post youtube --profile channel01 --post-type short --text "title" --media short.mp4 --dry-run --json
`);
}
