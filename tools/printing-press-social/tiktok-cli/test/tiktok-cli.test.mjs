import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isTikTokLoggedIn } from '../src/cli.mjs';

const cli = path.resolve('src/cli.mjs');

function run(args, env = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function runFailure(args, env = {}) {
  try {
    run(args, env);
  } catch (error) {
    return JSON.parse(error.stdout.toString());
  }
  throw new Error('Expected command to fail');
}

function fakePage({ visible = [], loginFields = 0 } = {}) {
  return {
    waitForTimeout: async () => {},
    locator: (selector) => ({
      count: async () => (selector.includes('input[name="username"]') ? loginFields : 0),
      first: () => ({
        isVisible: async () => visible.includes(selector),
      }),
    }),
  };
}

test('TikTok auth check only trusts strong logged-in signals', async () => {
  assert.equal(await isTikTokLoggedIn(fakePage()), false);
  assert.equal(await isTikTokLoggedIn(fakePage({ loginFields: 1 })), false);
  assert.equal(await isTikTokLoggedIn(fakePage({ visible: ['a[href*="/upload"]'] })), true);
});

test('adds and lists an TikTok profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const added = JSON.parse(run([
    'profile', 'add', 'tiktok',
    '--profile', 'artist01',
    '--json',
  ], env));

  assert.equal(added.ok, true);
  assert.equal(added.data.adapter, 'runner-cdp');

  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 1);
  assert.equal(listed.profiles[0].id, 'artist01');
});

test('dry-runs an TikTok comment', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'comment', 'tiktok',
    '--profile', 'smoke',
    '--url', 'https://www.tiktok.com/@user/video/123',
    '--text', 'nice post',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'comment');
  assert.equal(result.action.payload.targetUrl, 'https://www.tiktok.com/@user/video/123');
});

test('dry-runs an TikTok dm', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'dm', 'tiktok',
    '--profile', 'smoke',
    '--to', 'testuser',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'dm');
  assert.equal(result.action.payload.recipient, 'testuser');
});

test('sets require-confirm policy on a profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'tiktok',
    '--profile', 'artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'profile', 'set-policy', 'tiktok',
    '--profile', 'artist01',
    '--confirm-policy', 'require-confirm',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.data.confirmPolicy, 'require-confirm');
});

test('dry-runs an TikTok post with normalized action output', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'video.mp4');
  writeFileSync(media, 'fake');
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'tiktok',
    '--profile', 'artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'post', 'tiktok',
    '--profile', 'artist01',
    '--text', 'new drop tonight',
    '--media', media,
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.action.platform, 'tiktok');
  assert.equal(result.action.payload.text, 'new drop tonight');
  assert.deepEqual(result.browserPlan.steps, ['open persistent session', 'go to upload page', 'attach video', 'enter caption', 'post']);
});

test('dry-run rejects invalid TikTok media', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const invalid = path.join(home, 'not-video.jpg');
  writeFileSync(invalid, 'fake');

  const result = runFailure([
    'post', 'tiktok',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', invalid,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.match(result.error, /TikTok post media must be a video file/);
});
