import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  createAwsCredentialProcessRun,
  createDockerCredentialGet,
  createGitCredentialFill,
  createKeychainGet,
  createKeychainList,
  createSshAgentList,
  defaultPaths,
  parseAwsCredentialProcess,
  parseDockerCredentialGet,
  parseGitCredentialFill,
  parseKeychainDump,
  parseSshAgentList,
  type AwsProcessRun,
  type DockerRun,
  type GitRun,
  type KeychainGetRun,
  type KeychainListRun,
  type SshListRun,
} from '../host-runners.ts';

const GIT_PASSWORD = 'git-fill-super-secret';
const DOCKER_SECRET = 'dckr_pat_host-runner-secret';
const KEYCHAIN_PASSWORD = 'keychain-dump-must-not-leak';
const AWS_SECRET = 'aws/host-runner/secret-access-key';
const SSH_PRIVATE = '-----BEGIN OPENSSH PRIVATE KEY-----\nhost-runner-ssh-secret\n-----END OPENSSH PRIVATE KEY-----';

describe('host-runners defaultPaths', () => {
  it('returns HOME-relative paths without throwing', () => {
    const paths = defaultPaths();
    const home = homedir();
    expect(paths.gitConfig).toBe(join(home, '.gitconfig'));
    expect(paths.dockerConfig).toBe(join(home, '.docker', 'config.json'));
    expect(paths.awsCredentials).toBe(join(home, '.aws', 'credentials'));
    expect(paths.awsConfig).toBe(join(home, '.aws', 'config'));
    expect(paths.adc === process.env.GOOGLE_APPLICATION_CREDENTIALS || paths.adc === join(home, '.config', 'gcloud', 'application_default_credentials.json')).toBe(true);
  });
});

describe('host-runners git credential fill', () => {
  it('parses username/password from fill protocol output', () => {
    const parsed = parseGitCredentialFill(
      ['protocol=https', 'host=github.com', `username=git`, `password=${GIT_PASSWORD}`, ''].join('\n'),
    );
    expect(parsed.username).toBe('git');
    expect(parsed.password).toBe(GIT_PASSWORD);
  });

  it('uses injected GitRun and never spawns real git', async () => {
    let calls = 0;
    let seenStdin = '';
    const run: GitRun = async ({ stdin }) => {
      calls += 1;
      seenStdin = stdin;
      return `username=octocat\npassword=${GIT_PASSWORD}\n`;
    };
    const fill = createGitCredentialFill(run);
    const secret = await fill({ helper: 'osxkeychain', protocol: 'https', host: 'github.com' });
    expect(calls).toBe(1);
    expect(seenStdin).toContain('protocol=https');
    expect(seenStdin).toContain('host=github.com');
    expect(seenStdin.endsWith('\n\n')).toBe(true);
    expect(secret).toEqual({ username: 'octocat', password: GIT_PASSWORD });
  });

  it('fail-closes to {} when run throws or returns empty', async () => {
    const throwing = createGitCredentialFill(async () => {
      throw new Error(`boom ${GIT_PASSWORD}`);
    });
    await expect(throwing({ helper: 'store', host: 'x' })).resolves.toEqual({});
    const empty = createGitCredentialFill(async () => '');
    await expect(empty({ helper: 'store', host: 'x' })).resolves.toEqual({});
  });
});

describe('host-runners docker credential get', () => {
  it('parses Username/Secret JSON', () => {
    expect(
      parseDockerCredentialGet(JSON.stringify({ Username: 'octocat', Secret: DOCKER_SECRET })),
    ).toEqual({ Username: 'octocat', Secret: DOCKER_SECRET });
    expect(parseDockerCredentialGet('not-json')).toEqual({});
  });

  it('uses injected DockerRun and fail-closes on errors', async () => {
    let helperSeen = '';
    let stdinSeen = '';
    const run: DockerRun = async ({ helper, stdin }) => {
      helperSeen = helper;
      stdinSeen = stdin;
      return JSON.stringify({ Username: 'u', Secret: DOCKER_SECRET });
    };
    const get = createDockerCredentialGet(run);
    const secret = await get({ helper: 'desktop', serverUrl: 'https://index.docker.io/v1/' });
    expect(helperSeen).toBe('desktop');
    expect(stdinSeen).toBe('https://index.docker.io/v1/');
    expect(secret.Secret).toBe(DOCKER_SECRET);

    const failing = createDockerCredentialGet(async () => {
      throw new Error(DOCKER_SECRET);
    });
    await expect(failing({ helper: 'desktop', serverUrl: 'https://x' })).resolves.toEqual({});
  });
});

describe('host-runners keychain dump/list', () => {
  const DUMP = `
keychain: "/Users/me/Library/Keychains/login.keychain-db"
class: "genp"
attributes:
    0x00000007 <blob>="ignored-label"
    "acct"<blob>="octocat"
    "svce"<blob>="github.com"
    "password"<blob>="${KEYCHAIN_PASSWORD}"
password: "${KEYCHAIN_PASSWORD}"
class: "genp"
attributes:
    "svce"<blob>="npm"
    "acct"<blob>="publish"
    "passwd"<blob>="${KEYCHAIN_PASSWORD}"
`.trim();

  it('extracts only svce/acct and never retains password material', () => {
    const items = parseKeychainDump(DUMP);
    expect(items).toEqual([
      { service: 'github.com', account: 'octocat' },
      { service: 'npm', account: 'publish' },
    ]);
    expect(JSON.stringify(items)).not.toContain(KEYCHAIN_PASSWORD);
    expect(JSON.stringify(items).toLowerCase()).not.toContain('password');
  });

  it('lists via injected dump run', async () => {
    let calls = 0;
    const run: KeychainListRun = async () => {
      calls += 1;
      return DUMP;
    };
    const list = createKeychainList(run);
    const items = await list();
    expect(calls).toBe(1);
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items)).not.toContain(KEYCHAIN_PASSWORD);
  });

  it('gets password via injected run and fail-closes', async () => {
    const run: KeychainGetRun = async (query) => {
      expect(query).toEqual({ service: 'github.com', account: 'octocat' });
      return KEYCHAIN_PASSWORD;
    };
    const get = createKeychainGet(run);
    await expect(get({ service: 'github.com', account: 'octocat' })).resolves.toEqual({
      password: KEYCHAIN_PASSWORD,
    });
    const failing = createKeychainGet(async () => {
      throw new Error('nope');
    });
    await expect(failing({ service: 'a', account: 'b' })).resolves.toEqual({});
  });
});

describe('host-runners ssh-add -L', () => {
  const PUB =
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostRunnerPublicKeyMaterialOnly git@github.com';

  it('parses public keys into comment + sha256(line) fingerprint and omits private blocks', () => {
    const text = [PUB, SSH_PRIVATE, 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7 work'].join('\n');
    const identities = parseSshAgentList(text);
    expect(identities).toHaveLength(2);
    expect(identities[0]?.comment).toBe('git@github.com');
    expect(identities[0]?.fingerprint).toBe(
      `SHA256:${createHash('sha256').update(PUB, 'utf8').digest('hex')}`,
    );
    expect(JSON.stringify(identities)).not.toContain('host-runner-ssh-secret');
    expect(JSON.stringify(identities)).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(identities.every((row) => !('privateKey' in row))).toBe(true);
  });

  it('lists via injected run', async () => {
    const run: SshListRun = async () => PUB;
    const list = createSshAgentList(run);
    const identities = await list();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.comment).toBe('git@github.com');
  });
});

describe('host-runners aws credential_process', () => {
  it('parses AccessKeyId/SecretAccessKey/SessionToken JSON', () => {
    expect(
      parseAwsCredentialProcess(
        JSON.stringify({
          AccessKeyId: 'AKIATEST',
          SecretAccessKey: AWS_SECRET,
          SessionToken: 'token',
        }),
      ),
    ).toEqual({
      AccessKeyId: 'AKIATEST',
      SecretAccessKey: AWS_SECRET,
      SessionToken: 'token',
    });
    expect(parseAwsCredentialProcess('nope')).toEqual({});
  });

  it('uses injected AwsProcessRun and fail-closes', async () => {
    let commandSeen = '';
    const run: AwsProcessRun = async ({ command }) => {
      commandSeen = command;
      return JSON.stringify({ AccessKeyId: 'AKIATEST', SecretAccessKey: AWS_SECRET });
    };
    const processRun = createAwsCredentialProcessRun(run);
    const secret = await processRun({ profile: 'ci', command: 'aws-vault exec ci --json' });
    expect(commandSeen).toBe('aws-vault exec ci --json');
    expect(secret.SecretAccessKey).toBe(AWS_SECRET);
    const failing = createAwsCredentialProcessRun(async () => {
      throw new Error(AWS_SECRET);
    });
    await expect(failing({ profile: 'ci', command: 'false' })).resolves.toEqual({});
  });
});
