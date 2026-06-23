#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

function usage() {
  console.log(`runner-lottie

Commands:
  doctor [--json] [--live]
  init <dir> [--skip-install]
  dev <dir> [-- --host 127.0.0.1 --port 5173]
  validate <dir> [--json]

Notes:
  init scaffolds the official diffusionstudio/lottie Skia player with degit.
  Write animation edits to <dir>/public/lottie.json.
  Inspect exact frames in the preview with ?frame=<n>&paused=1.`);
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function targetDir() {
  const raw = args.find((arg) => !arg.startsWith('--'));
  if (!raw) fail('Missing target directory.');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function passthroughArgs() {
  const i = args.indexOf('--');
  return i === -1 ? [] : args.slice(i + 1);
}

function capture(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    encoding: 'utf-8',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error?.message,
  };
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const line of result.lines ?? []) console.log(line);
  if (!result.ok && result.fix) console.log(`Fix: ${result.fix}`);
}

function doctor() {
  const json = hasFlag('json');
  const live = hasFlag('live');
  const checks = [];
  const lines = [];

  const node = capture(process.execPath, ['--version']);
  checks.push({ name: 'node', ok: node.ok, value: node.stdout || node.stderr || node.error });
  lines.push(`${node.ok ? '✓' : '✗'} Node: ${node.stdout || node.stderr || node.error || 'missing'}`);

  const npm = capture('npm', ['--version']);
  checks.push({ name: 'npm', ok: npm.ok, value: npm.stdout || npm.stderr || npm.error });
  lines.push(`${npm.ok ? '✓' : '✗'} npm: ${npm.stdout || npm.stderr || npm.error || 'missing'}`);

  const npx = capture('npx', ['--version']);
  checks.push({ name: 'npx', ok: npx.ok, value: npx.stdout || npx.stderr || npx.error });
  lines.push(`${npx.ok ? '✓' : '✗'} npx: ${npx.stdout || npx.stderr || npx.error || 'missing'}`);

  if (live) {
    const degit = capture('npm', ['view', 'degit', 'version']);
    checks.push({ name: 'npm-registry-degit', ok: degit.ok, value: degit.stdout || degit.stderr || degit.error });
    lines.push(`${degit.ok ? '✓' : '✗'} npm registry can resolve degit: ${degit.stdout || degit.stderr || degit.error || 'unknown'}`);
  } else {
    lines.push('• Skipped live npm registry check. Add --live to test first-run internet access.');
  }

  lines.push(`• Tool root: ${toolRoot}`);
  lines.push('• No Lottie/Diffusion Studio API key is required.');

  const ok = checks.every((check) => check.ok);
  const result = {
    ok,
    source: 'lottie',
    checks,
    canInitialize: ok,
    requiresApiKey: false,
    fix: ok ? undefined : 'Install Node.js/npm or fix PATH, then rerun doctor.',
    lines,
  };
  printResult(result, json);
  process.exit(ok ? 0 : 1);
}

function init() {
  const dir = targetDir();
  const skipInstall = hasFlag('skip-install');
  if (existsSync(dir)) {
    const entries = statSync(dir).isDirectory() ? readdirSync(dir).filter((name) => name !== '.DS_Store') : [];
    if (entries.length > 0) fail(`Target directory is not empty: ${dir}`);
  } else {
    mkdirSync(dirname(dir), { recursive: true });
  }

  run('npx', ['--yes', 'degit', 'diffusionstudio/lottie', dir]);
  if (!skipInstall) run('npm', ['install'], { cwd: dir });
  console.log(`Lottie player ready: ${dir}`);
  console.log(`Edit: ${join(dir, 'public', 'lottie.json')}`);
  console.log(`Preview: cd ${dir} && npm run dev`);
}

function dev() {
  const dir = targetDir();
  if (!existsSync(join(dir, 'package.json'))) fail(`No package.json found in ${dir}. Run init first.`);
  run('npm', ['run', 'dev', ...passthroughArgs()], { cwd: dir });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function validateShapeGroups(lottie, errors) {
  for (const [layerIndex, layer] of (lottie.layers ?? []).entries()) {
    if (layer?.ty !== 4) continue;
    if (!Array.isArray(layer.shapes) || layer.shapes.length === 0) {
      errors.push(`Shape layer ${layerIndex} (${layer.nm ?? 'unnamed'}) has no shapes array.`);
      continue;
    }
    for (const [shapeIndex, shape] of layer.shapes.entries()) {
      if (shape?.ty !== 'gr') {
        errors.push(`Shape layer ${layerIndex} has ungrouped shape at shapes[${shapeIndex}]. Wrap primitives/fills in ty:"gr".`);
        continue;
      }
      const items = Array.isArray(shape.it) ? shape.it : [];
      if (!items.some((item) => item?.ty === 'tr')) {
        errors.push(`Group ${shape.nm ?? `${layerIndex}.${shapeIndex}`} is missing a ty:"tr" group transform.`);
      }
    }
  }
}

function validate() {
  const dir = targetDir();
  const json = hasFlag('json');
  const file = join(dir, 'public', 'lottie.json');
  const controlsFile = join(dir, 'public', 'controls.json');
  const errors = [];
  const warnings = [];
  const lines = [];
  let lottie;

  if (!existsSync(file)) {
    errors.push(`Missing ${file}`);
  } else {
    try {
      lottie = readJson(file);
    } catch (error) {
      errors.push(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (lottie) {
    for (const field of ['v', 'fr', 'ip', 'op', 'w', 'h', 'assets', 'layers']) {
      if (!(field in lottie)) errors.push(`Missing top-level field: ${field}`);
    }
    if (!Array.isArray(lottie.layers)) errors.push('layers must be an array.');
    if (!Array.isArray(lottie.assets)) errors.push('assets must be an array.');
    if (typeof lottie.fr === 'number' && typeof lottie.op === 'number' && lottie.fr > 0) {
      lines.push(`Duration: ${((lottie.op - (lottie.ip ?? 0)) / lottie.fr).toFixed(2)}s at ${lottie.fr}fps`);
    }
    validateShapeGroups(lottie, errors);

    const slots = lottie.slots && typeof lottie.slots === 'object' ? lottie.slots : {};
    if (!slots.bgColor) warnings.push('Recommended: expose a bgColor slot for background color control.');
    const lastLayer = Array.isArray(lottie.layers) ? lottie.layers.at(-1) : null;
    if (!lastLayer || !String(lastLayer.nm ?? '').toLowerCase().includes('background')) {
      warnings.push('Recommended: make the last layer a full-composition background layer.');
    }
  }

  if (existsSync(controlsFile)) {
    try {
      const controls = readJson(controlsFile);
      if (!Array.isArray(controls.controls)) warnings.push('controls.json should contain a controls array.');
    } catch (error) {
      errors.push(`Invalid controls.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push('Optional: add public/controls.json to label slots and slider ranges.');
  }

  const ok = errors.length === 0;
  lines.unshift(`${ok ? '✓' : '✗'} ${file}`);
  for (const error of errors) lines.push(`✗ ${error}`);
  for (const warning of warnings) lines.push(`! ${warning}`);
  printResult({ ok, errors, warnings, lines }, json);
  process.exit(ok ? 0 : 1);
}

switch (command) {
  case 'doctor':
    doctor();
    break;
  case 'init':
    init();
    break;
  case 'dev':
    dev();
    break;
  case 'validate':
    validate();
    break;
  case 'help':
  case '--help':
  case '-h':
    usage();
    break;
  default:
    usage();
    process.exit(1);
}
