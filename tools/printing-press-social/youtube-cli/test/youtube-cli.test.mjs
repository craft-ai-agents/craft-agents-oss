import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isYouTubeLoggedIn } from '../src/cli.mjs';

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

function fakePage({ visible = [], signInVisible = false } = {}) {
  return {
    waitForTimeout: async () => {},
    getByText: (text) => ({
      first: () => ({
        isVisible: async () => text === 'Sign in' ? signInVisible : visible.includes(String(text)),
      }),
    }),
    locator: (selector) => ({
      first: () => ({
        isVisible: async () => visible.includes(selector),
      }),
    }),
  };
}

test('YouTube auth check only trusts strong logged-in signals', async () => {
  assert.equal(await isYouTubeLoggedIn(fakePage()), false);
  assert.equal(await isYouTubeLoggedIn(fakePage({ signInVisible: true })), false);
  assert.equal(await isYouTubeLoggedIn(fakePage({ visible: ['#avatar-btn'] })), true);
});

test('adds and lists an YouTube profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const added = JSON.parse(run([
    'profile', 'add', 'youtube',
    '--profile', 'artist01',
    '--json',
  ], env));

  assert.equal(added.ok, true);
  assert.equal(added.data.adapter, 'runner-cdp');

  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 1);
  assert.equal(listed.profiles[0].id, 'artist01');
});

test('dry-runs an YouTube comment', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'comment', 'youtube',
    '--profile', 'smoke',
    '--url', 'https://www.youtube.com/@user/video/123',
    '--text', 'nice post',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'comment');
  assert.equal(result.action.payload.targetUrl, 'https://www.youtube.com/@user/video/123');
});

test('YouTube rejects unsupported dm command', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const result = runFailure([
    'dm', 'youtube',
    '--profile', 'smoke',
    '--to', 'testuser',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_COMMAND');
});

test('sets require-confirm policy on a profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'youtube',
    '--profile', 'artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'profile', 'set-policy', 'youtube',
    '--profile', 'artist01',
    '--confirm-policy', 'require-confirm',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.data.confirmPolicy, 'require-confirm');
});

test('dry-runs a YouTube full video with normalized action output', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'video.mp4');
  writeFileSync(media, 'fake');
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'youtube',
    '--profile', 'artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'post', 'youtube',
    '--profile', 'artist01',
    '--post-type', 'video',
    '--text', 'new drop tonight',
    '--description', 'full upload description',
    '--media', media,
    '--visibility', 'unlisted',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.action.platform, 'youtube');
  assert.equal(result.action.payload.postType, 'video');
  assert.equal(result.action.payload.title, 'new drop tonight');
  assert.equal(result.action.payload.description, 'full upload description');
  assert.equal(result.action.payload.visibility, 'unlisted');
  assert.deepEqual(result.browserPlan.steps, [
    'open persistent session',
    'go to YouTube Studio upload',
    'attach video',
    'set title',
    'set description',
    'set made-for-kids',
    'set visibility',
    'publish video',
  ]);
});

test('dry-runs a YouTube Short upload', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'short.mp4');
  writeFileSync(media, 'fake');

  const result = JSON.parse(run([
    'post', 'youtube',
    '--profile', 'smoke',
    '--post-type', 'shorts',
    '--text', 'short title',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.action.payload.postType, 'short');
  assert.equal(result.action.payload.visibility, 'private');
  assert.equal(result.browserPlan.steps.at(-1), 'publish as Short');
});

test('dry-run rejects invalid YouTube media', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const invalid = path.join(home, 'not-video.jpg');
  writeFileSync(invalid, 'fake');

  const result = runFailure([
    'post', 'youtube',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', invalid,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.match(result.error, /YouTube upload media must be a video file/);
});
