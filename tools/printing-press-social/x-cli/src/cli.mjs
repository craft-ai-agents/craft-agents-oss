#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BROWSER_ENGINE, resolveBrowserEngine, launchBrowserContextForEngine } from '../../src/browser-engines.mjs';

const SUPPORTED_PLATFORMS = new Set(['x']);

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

  if (group === 'post' && command === 'x') {
    await handleXPost(flags);
    return;
  }

  if (group === 'comment' && command === 'x') {
    await handleXComment(flags);
    return;
  }

  if (group === 'dm' && command === 'x') {
    await handleXDm(flags);
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
      live = await checkXSession(profile, flags);
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
    const result = await loginX(profile, flags);

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

async function handleXComment(flags) {
  const action = buildXTextAction('comment', flags, {
    targetUrl: flags.url || flags['target-url'],
  });
  if (!action.payload.targetUrl) {
    throw new CliError('X comment needs --url', 'MISSING_TARGET_URL');
  }
  validateTextAction(action, 280);

  if (flags['dry-run']) {
    writeResult(dryRunResult(action, ['open target post', 'focus comment field', 'enter comment', 'submit']), flags.json);
    return;
  }

  const profile = getProfile('x', action.profile);
  const result = await commentXDirect(profile, action, flags);
  writeResult(liveResult(action, result, 'comment.x'), flags.json);
}

async function handleXDm(flags) {
  const action = buildXTextAction('dm', flags, {
    recipient: flags.to || flags.recipient,
  });
  if (!action.payload.recipient) {
    throw new CliError('X DM needs --to <username>', 'MISSING_RECIPIENT');
  }
  validateTextAction(action, 1000);

  if (flags['dry-run']) {
    writeResult(dryRunResult(action, ['open inbox', 'start message', 'select recipient', 'enter message', 'send']), flags.json);
    return;
  }

  const profile = getProfile('x', action.profile);
  const result = await dmXDirect(profile, action, flags);
  writeResult(liveResult(action, result, 'dm.x'), flags.json);
}

function buildXTextAction(verb, flags, extraPayload) {
  const profileId = requireFlag(flags, 'profile');
  const text = readText(flags);
  if (!text) throw new CliError(`X ${verb} needs --text or --text-file`, 'MISSING_TEXT');
  return {
    actionId: flags['action-id'] || `act_${randomUUID()}`,
    verb,
    platform: 'x',
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
  if (action.payload.text.length > maxLength) errors.push(`X ${action.verb} text exceeds ${maxLength} characters`);
  if (errors.length) throw new CliError(errors.join('; '), 'INVALID_ACTION');
}

function dryRunResult(action, steps) {
  return {
    ok: true,
    actionId: action.actionId,
    platform: 'x',
    profile: action.profile,
    mode: 'browser',
    status: 'dry_run',
    command: `${action.verb}.x`,
    action,
    browserPlan: {
      sessionPath: sessionDir(getProfile('x', action.profile)),
      steps,
    },
  };
}

function liveResult(action, result, command) {
  return {
    ok: result.ok,
    actionId: action.actionId,
    platform: 'x',
    profile: action.profile,
    mode: 'browser',
    status: result.ok ? 'succeeded' : 'failed',
    command,
    ...result,
  };
}

async function handleXPost(flags) {
  const profileId = requireFlag(flags, 'profile');
  const profile = getProfile('x', profileId);
  const text = readText(flags);
  const media = normalizeList(flags.media);
  const action = {
    actionId: flags['action-id'] || `act_${randomUUID()}`,
    verb: 'post',
    platform: 'x',
    profile: profileId,
    mode: 'browser',
    payload: {
      text,
      media,
      postType: flags['post-type'] || 'post',
    },
    options: {
      dryRun: Boolean(flags['dry-run']),
      idempotencyKey: flags['idempotency-key'] || null,
      headed: Boolean(flags.headed),
    },
  };

  validateXAction(action);

  if (flags['dry-run']) {
    writeResult({
      ok: true,
      actionId: action.actionId,
      platform: 'x',
      profile: profileId,
      mode: 'browser',
      status: 'dry_run',
      command: 'post.x',
      action,
      browserPlan: {
        sessionPath: sessionDir(profile),
        steps: [
          'open persistent session',
          'open X composer',
          ...(text ? ['enter post text'] : []),
          ...(media.length ? ['attach media'] : []),
          'post',
        ],
      },
    }, flags.json);
    return;
  }

  const result = await postXDirect(profile, action, flags);
  writeResult({
    ok: result.ok,
    actionId: action.actionId,
    platform: 'x',
    profile: profileId,
    mode: 'browser',
    status: result.ok ? 'succeeded' : 'failed',
    command: 'post.x',
    ...result,
  }, flags.json);
}

function validateXAction(action) {
  const errors = [];
  if (!action.payload.text && action.payload.media.length === 0) errors.push('X post needs --text, --text-file, or --media');
  if (action.payload.text.length > 280) errors.push('X post text exceeds 280 characters');
  if (action.payload.postType !== 'post') errors.push('Direct MVP supports --post-type post only');
  const imageMedia = [];
  const videoMedia = [];
  for (const item of action.payload.media) {
    if (!fs.existsSync(item)) errors.push(`Media file not found: ${item}`);
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(item)) imageMedia.push(item);
    else if (/\.(mp4|mov|webm|m4v)$/i.test(item)) videoMedia.push(item);
    else errors.push(`X post media must be image/video: ${item}`);
  }
  if (videoMedia.length > 1) errors.push('X MVP accepts one video per post');
  if (videoMedia.length && imageMedia.length) errors.push('X MVP does not mix image and video media in one post');
  if (imageMedia.length > 4) errors.push('X supports up to 4 images per post');
  if (errors.length) throw new CliError(errors.join('; '), 'INVALID_ACTION');
}

async function loginX(profile, flags) {
  const context = await launchBrowserContext(profile, flags, false);
  const page = await context.newPage();
  await page.goto('https://x.com/', { waitUntil: 'domcontentloaded' });

  if (!flags.json) {
    console.log('Log into X in the opened browser, then press Enter here.');
  }

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('');
    rl.close();
  } else {
    await page.waitForTimeout(Number(flags.timeout || 60000));
  }

  const loggedIn = await isXLoggedIn(page);
  await context.close();
  return { loggedIn };
}

async function checkXSession(profile, flags) {
  const context = await launchBrowserContext(profile, flags, true);
  const page = await context.newPage();
  await page.goto('https://x.com/', { waitUntil: 'domcontentloaded' });
  const loggedIn = await isXLoggedIn(page);
  await context.close();
  return { loggedIn, checkedAt: new Date().toISOString() };
}

async function postXDirect(profile, action, flags) {
  const context = await launchBrowserContext(profile, flags, !flags.headed);
  const page = await context.newPage();
  const artifacts = [];

  try {
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });
    if (!(await isXLoggedIn(page))) {
      throw new CliError('X session is not logged in. Run profile login first.', 'NOT_LOGGED_IN');
    }

    if (action.payload.text) await fillComposer(page, action.payload.text);
    if (action.payload.media.length) {
      await page.locator('input[type="file"]').first().setInputFiles(action.payload.media);
    }

    if (!canExecuteLive(profile, flags)) {
      throw new CliError('Refusing live post because confirmation policy blocks autorun', 'CONFIRM_REQUIRED');
    }

    await clickXButton(page, ['Post', 'Tweet'], 30000);
    await page.waitForTimeout(Number(flags['settle-ms'] || 5000));

    return { ok: true, artifacts };
  } catch (error) {
    const screenshot = path.join(ensureDir(path.join(socialHome(), 'artifacts')), `${action.actionId}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    artifacts.push({ type: 'screenshot', path: screenshot });
    return {
      ok: false,
      error: error.message,
      code: error.code || 'X_POST_FAILED',
      artifacts,
    };
  } finally {
    await context.close();
  }
}

async function commentXDirect(profile, action, flags) {
  return withXPage(profile, action, flags, async (page) => {
    await page.goto(action.payload.targetUrl, { waitUntil: 'domcontentloaded' });
    await ensureLoggedIn(page);

    const field = page.locator('[data-testid="tweetTextarea_0"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea').first();
    await field.waitFor({ state: 'visible', timeout: 30000 });
    await field.fill(action.payload.text).catch(async () => {
      await field.click();
      await page.keyboard.type(action.payload.text);
    });

    if (!canExecuteLive(profile, flags)) {
      throw new CliError('Refusing live comment because confirmation policy blocks autorun', 'CONFIRM_REQUIRED');
    }

    await clickXButton(page, ['Reply', 'Post', 'Tweet'], 30000).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await page.waitForTimeout(Number(flags['settle-ms'] || 3000));
    return { ok: true, artifacts: [] };
  });
}

async function dmXDirect(profile, action, flags) {
  return withXPage(profile, action, flags, async (page) => {
    await page.goto('https://x.com/messages', { waitUntil: 'domcontentloaded' });
    await ensureLoggedIn(page);

    await clickXButton(page, ['New message', 'New chat'], 30000).catch(async () => {
      await page.locator('[data-testid="NewDM_Button"]').first().click({ timeout: 30000 });
    });

    const search = page.locator('input[placeholder*="Search" i], input[placeholder*="people" i], input').first();
    await search.waitFor({ state: 'visible', timeout: 30000 });
    await search.fill(action.payload.recipient);
    await page.waitForTimeout(1500);
    await page.getByText(action.payload.recipient, { exact: false }).first().click({ timeout: 30000 });
    await clickXButton(page, ['Next', 'Chat'], 30000).catch(async () => {
      await page.keyboard.press('Enter');
    });

    const messageBox = page.locator('[data-testid="dmComposerTextInput"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea').last();
    await messageBox.waitFor({ state: 'visible', timeout: 30000 });
    await messageBox.click();
    await page.keyboard.type(action.payload.text);

    if (!canExecuteLive(profile, flags)) {
      throw new CliError('Refusing live DM because confirmation policy blocks autorun', 'CONFIRM_REQUIRED');
    }

    await clickXButton(page, ['Send'], 30000);
    await page.waitForTimeout(Number(flags['settle-ms'] || 3000));
    return { ok: true, artifacts: [] };
  });
}

async function withXPage(profile, action, flags, fn) {
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
      code: error.code || 'X_ACTION_FAILED',
      artifacts: [{ type: 'screenshot', path: screenshot }],
    };
  } finally {
    await context.close();
  }
}

async function ensureLoggedIn(page) {
  if (!(await isXLoggedIn(page))) {
    throw new CliError('X session is not logged in. Run profile login first.', 'NOT_LOGGED_IN');
  }
}

export async function isXLoggedIn(page) {
  await page.waitForTimeout(1500);
  const loginField = await page.locator('input[name="username"], input[name="password"], input[placeholder*="email" i], input[placeholder*="phone" i]').count().catch(() => 0);
  if (loginField > 0) return false;
  const loggedInSignals = [
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Profile_Link"]',
    'a[href="/compose/post"]',
    'text=Post',
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
  throw new CliError(`Could not find X button: ${text}`, 'SELECTOR_NOT_FOUND');
}

async function clickXButton(page, labels, timeout) {
  for (const label of labels) {
    const candidates = [
      page.locator(`[data-testid="${label.toLowerCase()}Button"]`).first(),
      page.locator(`[aria-label="${label}"]`).first(),
      page.getByText(label, { exact: true }).first(),
      page.locator(`button:has-text("${label}")`).first(),
      page.locator(`div[role="button"]:has-text("${label}")`).first(),
    ];
    for (const locator of candidates) {
      if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
        await locator.click({ timeout });
        return;
      }
    }
  }
  throw new CliError(`Could not find X button: ${labels.join('/')}`, 'SELECTOR_NOT_FOUND');
}

async function fillComposer(page, text) {
  const candidates = [
    page.locator('[data-testid="tweetTextarea_0"]').first(),
    page.locator('div[aria-label*="post text" i][contenteditable="true"]').first(),
    page.locator('div[contenteditable="true"][role="textbox"]').first(),
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
  throw new CliError('Could not find X composer field', 'COMPOSER_FIELD_NOT_FOUND');
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
  return process.env.SOCIAL_HOME || path.join(os.homedir(), '.config', 'printing-press-clis', 'x');
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
  if (flags.text) return String(flags.text);
  if (flags['text-file']) return fs.readFileSync(String(flags['text-file']), 'utf8').trim();
  return '';
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

X MVP:
  social profile add x --profile artist01 --json
  social profile set-policy x --profile artist01 --confirm-policy require-confirm --json
  social profile login x --profile artist01
  social profile status x --profile artist01 --live --json
  social post x --profile artist01 --text "post text" --dry-run --json
  social post x --profile artist01 --text "post text" --media image.jpg --json
  social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --dry-run --json
  social comment x --profile artist01 --url "https://x.com/user/status/123" --text "reply" --json
  social dm x --profile artist01 --to username --text "message" --dry-run --json
  social dm x --profile artist01 --to username --text "message" --json

Global env:
  SOCIAL_HOME Override local .social store
  SOCIAL_CONFIRM_POLICY autorun|require-confirm
  SOCIAL_BROWSER_ENGINE runner-cdp|chrome-devtools|stagehand|cloakbrowser|playwright
`);
}
