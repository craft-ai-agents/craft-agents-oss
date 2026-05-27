#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const remotionBin = join(toolRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'remotion.cmd' : 'remotion');
const hyperframesBin = join(toolRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'hyperframes.cmd' : 'hyperframes');

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

function usage() {
  console.log(`hypermotion

Commands:
  doctor
  init <dir> --engine hyperframes|remotion
  preview <dir> --engine hyperframes|remotion
  render <dir> --engine hyperframes|remotion [--out output.mp4]

Notes:
  Run npm install inside tools/hypermotion once to install managed tool deps.
  Generated projects stay isolated from RunnerOS app dependencies.`);
}

function opt(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}

function targetDir() {
  const raw = args.find((arg) => !arg.startsWith('--'));
  if (!raw) fail(`Missing target directory.\n`);
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    encoding: 'utf-8',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureInstalled() {
  if (!existsSync(hyperframesBin) || !existsSync(remotionBin)) {
    fail(`Hypermotion tool dependencies are not installed.

Run:
  cd ${toolRoot}
  npm install`);
  }
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function initHyperframes(dir) {
  ensureInstalled();
  mkdirSync(dir, { recursive: true });
  write(join(dir, 'index.html'), `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1920, height=1080" />
  <title>Hypermotion HyperFrames Composition</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="1920" data-height="1080">
    <section id="scene" class="scene" data-start="0" data-duration="5" data-track-index="1">
      <p class="eyebrow">Hypermotion</p>
      <h1>Motion System Ready</h1>
      <p class="subhead">Edit this HTML/CSS/GSAP composition, then preview or render with HyperFrames.</p>
    </section>
  </div>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #050507; color: #f5f4ef; font-family: Inter, system-ui, sans-serif; }
    #root { width: 1920px; height: 1080px; overflow: hidden; background: radial-gradient(circle at 72% 28%, #164e63, transparent 32%), #050507; }
    .scene { box-sizing: border-box; width: 100%; height: 100%; padding: 120px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
    .eyebrow { margin: 0; color: #67e8f9; text-transform: uppercase; letter-spacing: .08em; font-size: 36px; }
    h1 { margin: 0; max-width: 1120px; font-size: 132px; line-height: .92; letter-spacing: 0; }
    .subhead { margin: 0; max-width: 820px; color: #c8cbd3; font-size: 36px; line-height: 1.25; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.from(".eyebrow", { opacity: 0, y: 24, duration: 0.6 }, 0);
    tl.from("h1", { opacity: 0, y: 56, duration: 0.9, ease: "power3.out" }, 0.15);
    tl.from(".subhead", { opacity: 0, y: 30, duration: 0.8 }, 0.45);
    window.__timelines["main"] = tl;
  </script>
</body>
</html>
`);
  write(join(dir, 'hyperframes.json'), `{
  "name": "hypermotion-hyperframes-project",
  "version": "0.1.0"
}
`);
  write(join(dir, 'package.json'), `{
  "name": "hypermotion-hyperframes-project",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "hyperframes preview",
    "check": "hyperframes lint",
    "render": "hyperframes render -o out/hypermotion.mp4"
  }
}
`);
  write(join(dir, 'README.md'), `# Hypermotion HyperFrames Project

Preview:

\`\`\`bash
node ${join(toolRoot, 'bin', 'hypermotion.mjs')} preview . --engine hyperframes
\`\`\`
`);
}

function initRemotion(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  write(join(dir, 'package.json'), `{
  "name": "hypermotion-remotion-project",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "studio": "remotion studio src/index.tsx",
    "render": "remotion render src/index.tsx Hypermotion out/hypermotion.mp4",
    "still": "remotion still src/index.tsx Hypermotion out/poster.png"
  },
  "dependencies": {
    "@remotion/cli": "4.0.467",
    "remotion": "4.0.467",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "zod": "4.3.6"
  },
  "devDependencies": {
    "@types/react": "^19.2.8",
    "@types/react-dom": "^19.2.3",
    "typescript": "^5.0.0"
  }
}
`);
  write(join(dir, 'src', 'index.tsx'), `import { Composition, registerRoot } from 'remotion';
import { Hypermotion } from './Hypermotion';

export const RemotionRoot = () => (
  <Composition
    id="Hypermotion"
    component={Hypermotion}
    durationInFrames={150}
    fps={30}
    width={1920}
    height={1080}
  />
);

registerRoot(RemotionRoot);
`);
  write(join(dir, 'src', 'Hypermotion.tsx'), `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const Hypermotion = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18 } });
  const glow = interpolate(frame, [0, 150], [0.2, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(circle at 72% 28%, #164e63, transparent 32%), #050507',
      color: '#f5f4ef',
      fontFamily: 'Inter, system-ui, sans-serif',
      justifyContent: 'center',
      padding: 120,
    }}>
      <div style={{ transform: \`translateY(\${(1 - enter) * 50}px)\`, opacity: enter }}>
        <p style={{ margin: 0, color: '#67e8f9', textTransform: 'uppercase', fontSize: 36 }}>
          Hypermotion
        </p>
        <h1 style={{ margin: '28px 0', maxWidth: 1120, fontSize: 132, lineHeight: .92, letterSpacing: 0 }}>
          Remotion Pipeline Ready
        </h1>
        <p style={{ margin: 0, maxWidth: 820, color: '#c8cbd3', fontSize: 36, lineHeight: 1.25 }}>
          Edit this React composition, then preview or render a deterministic MP4.
        </p>
      </div>
      <div style={{
        position: 'absolute',
        right: 160,
        bottom: 130,
        width: 260,
        height: 260,
        borderRadius: '50%',
        background: '#67e8f9',
        opacity: glow * .18,
        filter: 'blur(28px)',
      }} />
    </AbsoluteFill>
  );
};
`);
  write(join(dir, 'README.md'), `# Hypermotion Remotion Project

Install project deps:

\`\`\`bash
npm install
\`\`\`

Preview:

\`\`\`bash
node ${join(toolRoot, 'bin', 'hypermotion.mjs')} preview . --engine remotion
\`\`\`

Render:

\`\`\`bash
node ${join(toolRoot, 'bin', 'hypermotion.mjs')} render . --engine remotion --out out/hypermotion.mp4
\`\`\`
`);
}

if (command === 'help' || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

if (command === 'doctor') {
  const node = capture(process.execPath, ['--version']);
  const npm = capture('npm', ['--version']);
  const hyperframes = existsSync(hyperframesBin) ? capture(hyperframesBin, ['--version'], { cwd: toolRoot }) : { ok: false, stdout: '', stderr: 'not installed' };
  const remotion = existsSync(remotionBin) ? capture(remotionBin, ['versions', '--log=verbose'], { cwd: toolRoot }) : { ok: false, stdout: '', stderr: 'not installed' };
  console.log(JSON.stringify({
    ok: node.ok && npm.ok && hyperframes.ok && remotion.ok,
    toolRoot,
    node: node.stdout,
    npm: npm.stdout,
    hyperframes: hyperframes.ok ? hyperframes.stdout : hyperframes.stderr,
    remotion: remotion.ok ? '4.0.467' : (remotion.stderr || remotion.stdout),
  }, null, 2));
  process.exit(node.ok && npm.ok && hyperframes.ok && remotion.ok ? 0 : 1);
}

if (command === 'init') {
  const dir = targetDir();
  const engine = opt('engine', 'hyperframes');
  if (engine === 'hyperframes') initHyperframes(dir);
  else if (engine === 'remotion') initRemotion(dir);
  else fail(`Unknown engine: ${engine}`);
  console.log(JSON.stringify({ ok: true, engine, dir }, null, 2));
  process.exit(0);
}

if (command === 'preview') {
  ensureInstalled();
  const dir = targetDir();
  const engine = opt('engine', 'hyperframes');
  if (engine === 'hyperframes') run(hyperframesBin, ['preview', dir], { cwd: dir });
  else if (engine === 'remotion') run(remotionBin, ['studio', 'src/index.tsx'], { cwd: dir });
  else fail(`Unknown engine: ${engine}`);
  process.exit(0);
}

if (command === 'render') {
  ensureInstalled();
  const dir = targetDir();
  const engine = opt('engine', 'hyperframes');
  const out = opt('out', engine === 'hyperframes' ? 'out/hypermotion.mp4' : 'out/hypermotion.mp4');
  mkdirSync(join(dir, dirname(out)), { recursive: true });
  if (engine === 'hyperframes') run(hyperframesBin, ['render', dir, '--output', out], { cwd: dir });
  else if (engine === 'remotion') run(remotionBin, ['render', 'src/index.tsx', 'Hypermotion', out], { cwd: dir });
  else fail(`Unknown engine: ${engine}`);
  process.exit(0);
}

fail(`Unknown command: ${command}\n`);
