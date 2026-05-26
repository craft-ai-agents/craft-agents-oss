import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isXLoggedIn } from '../src/cli.mjs';

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

test('X auth check only trusts strong logged-in signals', async () => {
  assert.equal(await isXLoggedIn(fakePage()), false);
  assert.equal(await isXLoggedIn(fakePage({ loginFields: 1 })), false);
  assert.equal(await isXLoggedIn(fakePage({ visible: ['[data-testid="SideNav_AccountSwitcher_Button"]'] })), true);
});

test('adds and lists an X profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const added = JSON.parse(run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--json',
  ], env));

  assert.equal(added.ok, true);
  assert.equal(added.data.adapter, 'runner-cdp');

  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 1);
  assert.equal(listed.profiles[0].id, 'artist01');
});

test('dry-runs an X comment', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'comment', 'x',
    '--profile', 'smoke',
    '--url', 'https://x.com/user/status/123',
    '--text', 'nice post',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'comment');
  assert.equal(result.action.payload.targetUrl, 'https://x.com/user/status/123');
});

test('dry-runs an X dm', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'dm', 'x',
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
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'profile', 'set-policy', 'x',
    '--profile', 'artist01',
    '--confirm-policy', 'require-confirm',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.data.confirmPolicy, 'require-confirm');
});

test('dry-runs a text-only X post with normalized action output', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'post', 'x',
    '--profile', 'artist01',
    '--text', 'new drop tonight',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.action.platform, 'x');
  assert.equal(result.action.payload.text, 'new drop tonight');
  assert.deepEqual(result.browserPlan.steps, ['open persistent session', 'open X composer', 'enter post text', 'post']);
});

test('dry-runs an X media post', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'video.mp4');
  writeFileSync(media, 'fake');

  const result = JSON.parse(run([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'new clip',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.action.payload.media, [media]);
  assert.deepEqual(result.browserPlan.steps, ['open persistent session', 'open X composer', 'enter post text', 'attach media', 'post']);
});

test('dry-run rejects invalid X media', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const invalid = path.join(home, 'not-media.txt');
  writeFileSync(invalid, 'fake');

  const result = runFailure([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', invalid,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.match(result.error, /X post media must be image\/video/);
});
