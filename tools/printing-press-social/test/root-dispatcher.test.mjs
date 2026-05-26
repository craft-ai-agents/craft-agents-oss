import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cli = path.resolve('src/social.mjs');

function run(args, env = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('root registry returns CLI-Anything style command metadata', () => {
  const registry = JSON.parse(run(['registry', '--json']));
  assert.equal(registry.model, 'CLI-Anything');
  assert.ok(registry.platforms.instagram);
  assert.ok(registry.platforms.tiktok);
  assert.ok(registry.platforms.x);
  assert.ok(registry.platforms.youtube);
  assert.ok(registry.commands.some((command) => command.verb === 'doctor'));
});

test('root doctor reports install and platform health', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const result = JSON.parse(run(['doctor', '--json'], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.command, 'doctor');
  assert.equal(result.model, 'CLI-Anything');
  assert.equal(result.browserEngine, 'runner-cdp');
  assert.equal(result.checks.find((check) => check.name === 'browser-engine')?.mode, 'delegated');
  assert.equal(result.platforms.length, 4);
  assert.ok(result.platforms.find((platform) => platform.platform === 'x'));
  assert.ok(result.checks.find((check) => check.name === 'browser-engine'));
});

test('root dispatcher routes Instagram dry-run', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const media = path.join(home, 'image.jpg');
  writeFileSync(media, 'fake');
  const result = JSON.parse(run([
    'post', 'instagram',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'instagram');
});

test('root dispatcher routes YouTube dry-run', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const media = path.join(home, 'short.mp4');
  writeFileSync(media, 'fake');
  const result = JSON.parse(run([
    'post', 'youtube',
    '--profile', 'smoke',
    '--post-type', 'short',
    '--text', 'hello',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'youtube');
  assert.equal(result.action.payload.postType, 'short');
});

test('root dispatcher routes X dry-run', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const result = JSON.parse(run([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'x');
});
