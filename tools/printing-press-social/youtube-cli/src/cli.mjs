#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BROWSER_ENGINE, resolveBrowserEngine, launchBrowserContextForEngine } from '../../src/browser-engines.mjs';

const SUPPORTED_PLATFORMS = new Set(['youtube']);

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    writeResult({
      ok: false,
      status: 'failed',
      error: error.message,
      code: error.code || 'UNHANDLED_ERROR',
    }, true);
    process.exit(1);
  });
}

function isDirectRun() {
  return Boolean(process.argv[1])
    && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv[0] === 'help') {
    printHelp();
    return;
  }

  const [group, command, ...rest] = argv;
  const flags = parseFlags(rest);

  if (group === 'profile') {
    await handleProfile(command, flags);
    return;
  }

  if (group === 'post' && command === 'youtube') {
    await handleYouTubePost(flags);
    return;
  }

  if (group === 'comment' && command === 'youtube') {
    await handleYouTubeComment(flags);
    return;
  }

  throw new CliError(`Unknown command: ${argv.join(' ')}`, 'UNKNOWN_COMMAND');
}

async function handleProfile(command, flags) {
  if (command === 'add') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const store = loadProfileStore();
    const sessionRef = path.join('sessions', platform, profileId);

    const profile = {
      id: profileId,
      platform,
      modePreference: 'browser',
      adapter: resolveBrowserEngine(flags),
      browserEngine: resolveBrowserEngine(flags),
      sessionRef,
      proxyId: flags['proxy-id'] || null,
      ratePolicy: flags['rate-policy'] || 'normal',
      confirmPolicy: flags['confirm-policy'] || process.env.SOCIAL_CONFIRM_POLICY || 'autorun',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.profiles[profileKey(platform, profileId)] = profile;
    saveProfileStore(store);

    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.add',
      platform,
      profile: profileId,
      data: profile,
    }, flags.json);
    return;
  }

  if (command === 'set-policy') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const confirmPolicy = requireFlag(flags, 'confirm-policy');
    if (!['require-confirm', 'autorun'].includes(confirmPolicy)) {
      throw new CliError('--confirm-policy must be require-confirm or autorun', 'INVALID_CONFIRM_POLICY');
    }

    const store = loadProfileStore();
    const key = profileKey(platform, profileId);
    const profile = store.profiles[key];
    if (!profile) throw new CliError(`Profile not found: ${platform}/${profileId}`, 'PROFILE_NOT_FOUND');
    profile.confirmPolicy = confirmPolicy;
    profile.updatedAt = new Date().toISOString();
    store.profiles[key] = profile;
    saveProfileStore(store);

    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.set-policy',
      platform,
      profile: profileId,
      confirmPolicy,
      data: profile,
    }, flags.json);
    return;
  }

  if (command === 'list') {
    const store = loadProfileStore();
    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.list',
      profiles: Object.values(store.profiles),
    }, flags.json);
    return;
  }

  if (command === 'status') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const profile = getProfile(platform, profileId);
    const sessionPath = sessionDir(profile);
    const localReady = fs.existsSync(sessionPath);
    let live = null;

    if (flags.live) {
      live = await checkYouTubeSession(profile, flags);
    }

    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.status',
      platform,
      profile: profileId,
      ready: live ? live.loggedIn : localReady,
      localSessionExists: localReady,
      live,
      data: profile,
    }, flags.json);
    return;
  }

  if (command === 'login') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const profile = getProfile(platform, profileId);
    const result = await loginYouTube(profile, flags);

    writeResult({
      ok: result.loggedIn,
      status: result.loggedIn ? 'succeeded' : 'failed',
      command: 'profile.login',
      platform,
      profile: profileId,
      sessionPath: sessionDir(profile),
      ...result,
    }, flags.json);
    return;
  }

  throw new CliError(`Unknown profile command: ${command}`, 'UNKNOWN_PROFILE_COMMAND');
}

async function handleYouTubeComment(flags) {
  const action = buildYouTubeTextAction('comment', flags, {
    targetUrl: flags.url || flags['target-url'],
  });
  if (!action.payload.targetUrl) {
    throw new CliError('YouTube comment needs --url', 'MISSING_TARGET_URL');
  }
  validateTextAction(action, 10000);

  if (flags['dry-run']) {
    writeResult(dryRunResult(action, ['open target video', 'focus comment field', 'enter comment', 'submit']), flags.json);
    return;
  }

  const profile = getProfile('youtube', action.profile);
  const result = await commentYouTubeDirect(profile, action, flags);
  writeResult(liveResult(action, result, 'comment.youtube'), flags.json);
}

function buildYouTubeTextAction(verb, flags, extraPayload) {
  const profileId = requireFlag(flags, 'profile');
  const text = readText(flags);
  if (!text) throw new CliError(`YouTube ${verb} needs --text or --text-file`, 'MISSING_TEXT');
  return {
    actionId: flags['action-id'] || `act_${randomUUID()}`,
    verb,
    platform: 'youtube',
    profile: profileId,
    mode: 'browser',
    payload: {
      text,
      ...extraPayload,
    },
    options: {
      dryRun: Boolean(flags['dry-run']),
      idempotencyKey: flags['idempotency-key'] || null,
      headed: Boolean(flags.headed),
    },
  };
}

function validateTextAction(action, maxLength) {
  const errors = [];
  if (action.payload.text.length > maxLength) errors.push(`YouTube ${action.verb} text exceeds ${maxLength} characters`);
  if (errors.length) throw new CliError(errors.join('; '), 'INVALID_ACTION');
}

function dryRunResult(action, steps) {
  return {
    ok: true,
    actionId: action.actionId,
    platform: 'youtube',
    profile: action.profile,
    mode: 'browser',
    status: 'dry_run',
    command: `${action.verb}.youtube`,
    action,
    browserPlan: {
      sessionPath: sessionDir(getProfile('youtube', action.profile)),
      steps,
    },
  };
}

function liveResult(action, result, command) {
  return {
    ok: result.ok,
    actionId: action.actionId,
    platform: 'youtube',
    profile: action.profile,
    mode: 'browser',
    status: result.ok ? 'succeeded' : 'failed',
    command,
    ...result,
  };
}

async function handleYouTubePost(flags) {
  const profileId = requireFlag(flags, 'profile');
  const title = readText(flags);
  if (!title) throw new CliError('YouTube upload needs --text/--title or --text-file', 'MISSING_TITLE');

  const profile = getProfile('youtube', profileId);
  const media = normalizeList(flags.media);
  const postType = normalizePostType(flags['post-type'] || flags.type || 'video');
  const visibility = flags.visibility || 'private';
  const action = {
    actionId: flags['action-id'] || `act_${randomUUID()}`,
    verb: 'post',
    platform: 'youtube',
    profile: profileId,
    mode: 'browser',
    payload: {
      text: title,
      title,
      description: readDescription(flags),
      media,
      postType,
      visibility,
      madeForKids: flags['made-for-kids'] || 'no',
      tags: normalizeList(flags.tags),
    },
    options: {
      dryRun: Boolean(flags['dry-run']),
      idempotencyKey: flags['idempotency-key'] || null,
      headed: Boolean(flags.headed),
    },
  };

  validateYouTubeAction(action);

  if (flags['dry-run']) {
    writeResult({
      ok: true,
      actionId: action.actionId,
      platform: 'youtube',
      profile: profileId,
      mode: 'browser',
      status: 'dry_run',
      command: 'post.youtube',
      action,
      browserPlan: {
        sessionPath: sessionDir(profile),
        steps: [
          'open persistent session',
          'go to YouTube Studio upload',
          'attach video',
          'set title',
          'set description',
          'set made-for-kids',
          'set visibility',
          postType === 'short' ? 'publish as Short' : 'publish video',
        ],
      },
    }, flags.json);
    return;
  }

  const result = await postYouTubeDirect(profile, action, flags);
  writeResult({
    ok: result.ok,
    actionId: action.actionId,
    platform: 'youtube',
    profile: profileId,
    mode: 'browser',
    status: result.ok ? 'succeeded' : 'failed',
    command: 'post.youtube',
    ...result,
  }, flags.json);
}

function validateYouTubeAction(action) {
  const errors = [];
  if (action.payload.title.length > 100) errors.push('YouTube title exceeds 100 characters');
  if (action.payload.description.length > 5000) errors.push('YouTube description exceeds 5000 characters');
  if (!['video', 'short'].includes(action.payload.postType)) errors.push('YouTube --post-type must be video or short');
  if (!['private', 'unlisted', 'public'].includes(action.payload.visibility)) errors.push('YouTube --visibility must be private, unlisted, or public');
  if (!['yes', 'no'].includes(action.payload.madeForKids)) errors.push('YouTube --made-for-kids must be yes or no');
  if (action.payload.media.length === 0) errors.push('YouTube uploads require --media');
  if (action.payload.media.length > 1) errors.push('YouTube MVP accepts one video file per upload');
  for (const item of action.payload.media) {
    if (!fs.existsSync(item)) errors.push(`Media file not found: ${item}`);
    if (!/\.(mp4|mov|webm|m4v)$/i.test(item)) errors.push(`YouTube upload media must be a video file: ${item}`);
  }
  if (errors.length) throw new CliError(errors.join('; '), 'INVALID_ACTION');
}

async function loginYouTube(profile, flags) {
  const context = await launchBrowserContext(profile, flags, false);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });

  if (!flags.json) {
    console.log('Log into YouTube in the opened browser, then press Enter here.');
  }

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('');
    rl.close();
  } else {
    await page.waitForTimeout(Number(flags.timeout || 60000));
  }

  const loggedIn = await isYouTubeLoggedIn(page);
  await context.close();
  return { loggedIn };
}

async function checkYouTubeSession(profile, flags) {
  const context = await launchBrowserContext(profile, flags, true);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  const loggedIn = await isYouTubeLoggedIn(page);
  await context.close();
  return { loggedIn, checkedAt: new Date().toISOString() };
}

async function postYouTubeDirect(profile, action, flags) {
  const context = await launchBrowserContext(profile, flags, !flags.headed);
  const page = await context.newPage();
  const artifacts = [];

  try {
    await page.goto('https://studio.youtube.com/channel/UC/videos/upload', { waitUntil: 'domcontentloaded' });
    if (!(await isYouTubeLoggedIn(page))) {
      throw new CliError('YouTube session is not logged in. Run profile login first.', 'NOT_LOGGED_IN');
    }

    await page.locator('input[type="file"]').first().setInputFiles(action.payload.media);
    await fillYouTubeUploadDetails(page, action);

    if (!canExecuteLive(profile, flags)) {
      throw new CliError('Refusing live upload because confirmation policy blocks autorun', 'CONFIRM_REQUIRED');
    }

    await advanceUploadFlow(page, action.payload.visibility);
    await page.waitForTimeout(Number(flags['settle-ms'] || 8000));

    return { ok: true, artifacts };
  } catch (error) {
    const screenshot = path.join(ensureDir(path.join(socialHome(), 'artifacts')), `${action.actionId}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    artifacts.push({ type: 'screenshot', path: screenshot });
    return {
      ok: false,
      error: error.message,
      code: error.code || 'YOUTUBE_POST_FAILED',
      artifacts,
    };
  } finally {
    await context.close();
  }
}

async function commentYouTubeDirect(profile, action, flags) {
  return withYouTubePage(profile, action, flags, async (page) => {
    await page.goto(action.payload.targetUrl, { waitUntil: 'domcontentloaded' });
    await ensureLoggedIn(page);

    const field = page.locator('[data-e2e*="comment-input"], div[contenteditable="true"], textarea[aria-label*="comment" i], textarea').first();
    await field.waitFor({ state: 'visible', timeout: 30000 });
    await field.fill(action.payload.text).catch(async () => {
      await field.click();
      await page.keyboard.type(action.payload.text);
    });

    if (!canExecuteLive(profile, flags)) {
      throw new CliError('Refusing live comment because confirmation policy blocks autorun', 'CONFIRM_REQUIRED');
    }

    await clickText(page, 'Post', 30000).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await page.waitForTimeout(Number(flags['settle-ms'] || 3000));
    return { ok: true, artifacts: [] };
  });
}

async function withYouTubePage(profile, action, flags, fn) {
  const context = await launchBrowserContext(profile, flags, !flags.headed);
  const page = await context.newPage();
  try {
    return await fn(page);
  } catch (error) {
    const screenshot = path.join(ensureDir(path.join(socialHome(), 'artifacts')), `${action.actionId}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    return {
      ok: false,
      error: error.message,
      code: error.code || 'YOUTUBE_ACTION_FAILED',
      artifacts: [{ type: 'screenshot', path: screenshot }],
    };
  } finally {
    await context.close();
  }
}

async function ensureLoggedIn(page) {
  if (!(await isYouTubeLoggedIn(page))) {
    throw new CliError('YouTube session is not logged in. Run profile login first.', 'NOT_LOGGED_IN');
  }
}

export async function isYouTubeLoggedIn(page) {
  await page.waitForTimeout(1500);
  const signInButton = await page.getByText('Sign in', { exact: false }).first().isVisible({ timeout: 1500 }).catch(() => false);
  if (signInButton) return false;
  const loggedInSignals = [
    '#avatar-btn',
    'button[aria-label*="Account menu" i]',
    'ytcp-button#create-icon',
    'text=Create',
    'text=Channel content',
  ];
  for (const selector of loggedInSignals) {
    if (await page.locator(selector).first().isVisible({ timeout: 1500 }).catch(() => false)) return true;
  }
  return false;
}

async function clickText(page, text, timeout) {
  const candidates = [
    page.getByText(text, { exact: true }).first(),
    page.locator(`button:has-text("${text}")`).first(),
    page.locator(`div[role="button"]:has-text("${text}")`).first(),
  ];
  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.click({ timeout });
      return;
    }
  }
  throw new CliError(`Could not find YouTube button: ${text}`, 'SELECTOR_NOT_FOUND');
}

async function fillYouTubeUploadDetails(page, action) {
  await page.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await fillTitle(page, action.payload.title);
  if (action.payload.description) await fillDescription(page, action.payload.description);
  await setMadeForKids(page, action.payload.madeForKids);
}

async function fillTitle(page, text) {
  const candidates = [
    page.locator('#textbox[aria-label="Add a title that describes your video"]').first(),
    page.locator('ytcp-social-suggestions-textbox[label="Title"] #textbox').first(),
    page.locator('div[aria-label*="title" i][contenteditable="true"]').first(),
    page.locator('[contenteditable="true"]').first(),
  ];
  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.fill(text).catch(async () => {
        await locator.click();
        await page.keyboard.type(text);
      });
      return;
    }
  }
  throw new CliError('Could not find YouTube title field', 'TITLE_FIELD_NOT_FOUND');
}

async function fillDescription(page, text) {
  const candidates = [
    page.locator('#textbox[aria-label*="Tell viewers about your video" i]').first(),
    page.locator('ytcp-social-suggestions-textbox[label="Description"] #textbox').first(),
    page.locator('div[aria-label*="description" i][contenteditable="true"]').first(),
    page.locator('[contenteditable="true"]').nth(1),
  ];
  for (const locator of candidates) {
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.fill(text).catch(async () => {
        await locator.click();
        await page.keyboard.type(text);
      });
      return;
    }
  }
}

async function setMadeForKids(page, value) {
  const labels = value === 'yes'
    ? ['Yes, it is made for kids', 'Yes, it’s made for kids', "Yes, it's made for kids"]
    : ['No, it is not made for kids', 'No, it’s not made for kids', "No, it's not made for kids"];
  await clickRequiredText(page, labels, 'MADE_FOR_KIDS_FIELD_NOT_FOUND');
}

async function advanceUploadFlow(page, visibility) {
  for (let i = 0; i < 3; i += 1) {
    await clickText(page, 'Next', 30000);
    await page.waitForTimeout(1000);
  }

  await clickRequiredText(page, [visibility], 'VISIBILITY_FIELD_NOT_FOUND');
  await clickText(page, 'Publish', 30000).catch(async () => {
    await clickText(page, 'Save', 30000).catch(async () => {
      await clickText(page, 'Done', 30000);
    });
  });
}

async function clickRequiredText(page, labels, code) {
  for (const label of labels) {
    const locator = page.getByText(label, { exact: false }).first();
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.click({ timeout: 10000 });
      return;
    }
  }
  throw new CliError(`Could not set required YouTube upload field: ${labels.join(' / ')}`, code);
}

async function launchBrowserContext(profile, flags, headlessDefault) {
  const engine = resolveBrowserEngine(flags, profile);
  const options = browserOptions(flags, headlessDefault);

  try {
    return await launchBrowserContextForEngine(engine, profile, flags, options, sessionDir);
  } catch (error) {
    throw new CliError(error.message, error.code || 'BROWSER_ENGINE_FAILED');
  }
}

function browserOptions(flags, headlessDefault) {
  return {
    headless: flags.headed ? false : headlessDefault,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    proxy: flags.proxy || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  };
}

function canExecuteLive(profile, flags) {
  if (flags.confirm === 'yes') return true;
  if (flags.confirm === 'no') return false;
  if (flags.autorun) return true;
  return profile.confirmPolicy === 'autorun';
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
      setFlag(out, key, inline);
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      setFlag(out, key, true);
    } else {
      setFlag(out, key, next);
      i += 1;
    }
  }
  return out;
}

function setFlag(out, key, value) {
  if (out[key] === undefined) out[key] = value;
  else if (Array.isArray(out[key])) out[key].push(value);
  else out[key] = [out[key], value];
}

function writeResult(result, asJson = false) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.ok) {
    console.log(`${result.status}: ${result.command || 'social'}`);
    if (result.profile) console.log(`profile: ${result.profile}`);
    if (result.ready !== undefined) console.log(`ready: ${result.ready}`);
    return;
  }
  console.error(`${result.status || 'failed'}: ${result.error}`);
}

function loadProfileStore() {
  const filePath = profileStorePath();
  if (!fs.existsSync(filePath)) return { version: 1, profiles: {} };
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveProfileStore(store) {
  const filePath = profileStorePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function getProfile(platform, id) {
  const store = loadProfileStore();
  const profile = store.profiles[profileKey(platform, id)];
  if (profile) return profile;
  if (id === 'smoke') {
    return {
      id,
      platform,
      modePreference: 'browser',
      adapter: DEFAULT_BROWSER_ENGINE,
      browserEngine: DEFAULT_BROWSER_ENGINE,
      sessionRef: path.join('sessions', platform, id),
      proxyId: null,
      ratePolicy: 'normal',
      confirmPolicy: 'autorun',
    };
  }
  throw new CliError(`Profile not found: ${platform}/${id}`, 'PROFILE_NOT_FOUND');
}

function profileKey(platform, id) {
  return `${platform}:${id}`;
}

function profileStorePath() {
  return path.join(socialHome(), 'profiles.json');
}

function sessionDir(profile) {
  return path.join(socialHome(), profile.sessionRef || path.join('sessions', profile.platform, profile.id));
}

function socialHome() {
  return process.env.SOCIAL_HOME || path.join(os.homedir(), '.config', 'printing-press-clis', 'youtube');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (!value || value === true) throw new CliError(`Missing --${name}`, `MISSING_${name.toUpperCase().replaceAll('-', '_')}`);
  return String(value);
}

function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new CliError(`Unsupported platform for MVP: ${platform || '(missing)'}`, 'UNSUPPORTED_PLATFORM');
  }
}

function readText(flags) {
  if (flags.title) return String(flags.title);
  if (flags.text) return String(flags.text);
  if (flags['text-file']) return fs.readFileSync(String(flags['text-file']), 'utf8').trim();
  return '';
}

function readDescription(flags) {
  if (flags.description) return String(flags.description);
  if (flags['description-file']) return fs.readFileSync(String(flags['description-file']), 'utf8').trim();
  return '';
}

function normalizePostType(value) {
  const normalized = String(value).toLowerCase();
  if (['short', 'shorts'].includes(normalized)) return 'short';
  if (['video', 'full', 'full-video'].includes(normalized)) return 'video';
  return normalized;
}

function normalizeList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`social - direct agent-native social CLI harness

YouTube MVP:
  social profile add youtube --profile channel01 --json
  social profile set-policy youtube --profile channel01 --confirm-policy require-confirm --json
  social profile login youtube --profile channel01
  social profile status youtube --profile channel01 --live --json
  social post youtube --profile channel01 --post-type video --text "Video title" --media video.mp4 --visibility public --dry-run --json
  social post youtube --profile channel01 --post-type short --text "Short title" --media short.mp4 --visibility public --json
  social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --dry-run --json
  social comment youtube --profile channel01 --url "https://www.youtube.com/watch?v=..." --text "comment" --json

Global env:
  SOCIAL_HOME Override local .social store
  SOCIAL_CONFIRM_POLICY autorun|require-confirm
  SOCIAL_BROWSER_ENGINE runner-cdp|chrome-devtools|stagehand|cloakbrowser|playwright
`);
}
