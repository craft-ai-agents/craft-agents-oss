import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { getBashRememberKey, getFileWriteRememberKey, getNetworkCommandHosts, isDangerousArgv } from '../permission-remember.ts';

const exact = (...argv: string[]) => `exact:${JSON.stringify(argv)}`;

describe('getBashRememberKey', () => {
  it.each([
    // CLIs with subcommands: the leading words before the first flag
    ['git commit -m "wip"', 'git commit'],
    ['npm test', 'npm test'],
    ['npm install lodash --save-dev', 'npm install lodash'],
    ['aws s3 ls', 'aws s3 ls'],
    ['gh pr merge 12 --squash', 'gh pr merge 12'],
    ['gcloud compute instances list', 'gcloud compute instances list'],
    ['/usr/bin/git commit -m x', '/usr/bin/git commit'],
    // Single-purpose commands: the name
    ['mkdir -p out', 'mkdir'],
    ['open README.md', 'open'],
  ])('%s -> %s', (command, key) => {
    expect(getBashRememberKey(command)).toBe(key);
  });

  it('keys commands whose flags or arguments decide what they do by the exact argv', () => {
    expect(getBashRememberKey('tar -tf a.tar')).toBe(exact('tar', '-tf', 'a.tar'));
    expect(getBashRememberKey('tar -xf a.tar -C /')).toBe(exact('tar', '-xf', 'a.tar', '-C', '/'));
    expect(getBashRememberKey('sqlite3 app.db .tables')).toBe(exact('sqlite3', 'app.db', '.tables'));
    expect(getBashRememberKey('psql -c "SELECT 1"')).toBe(exact('psql', '-c', 'SELECT 1'));
    // Interpreters and runners execute whatever follows them.
    expect(getBashRememberKey('python script.py --dry-run')).toBe(exact('python', 'script.py', '--dry-run'));
    expect(getBashRememberKey('bash -c "echo hi"')).toBe(exact('bash', '-c', 'echo hi'));
    expect(getBashRememberKey('npm run build')).toBe(exact('npm', 'run', 'build'));
    expect(getBashRememberKey('docker run ubuntu ls -la')).toBe(exact('docker', 'run', 'ubuntu', 'ls', '-la'));
    expect(getBashRememberKey('docker exec -it web sh')).toBe(exact('docker', 'exec', '-it', 'web', 'sh'));
    expect(getBashRememberKey('npx rimraf dist')).toBe(exact('npx', 'rimraf', 'dist'));
  });

  it('keeps read and write operations of resource-first CLIs apart', () => {
    expect(getBashRememberKey('aws s3 ls')).not.toBe(getBashRememberKey('aws s3 cp a s3://b/a'));
    expect(getBashRememberKey('gh pr comment 5 -b hi')).not.toBe(getBashRememberKey('gh pr merge 5'));
    expect(getBashRememberKey('sqlite3 app.db .tables')).not.toBe(getBashRememberKey('sqlite3 app.db "DROP TABLE users"'));
  });

  it.each([
    ['git push --force origin main', 'dangerous subcommand'],
    ['git reset --hard HEAD~3', 'dangerous subcommand'],
    ['git switch -f main', 'dangerous subcommand'],
    ['git stash drop', 'dangerous subcommand'],
    ['/usr/bin/git push', 'dangerous subcommand behind a path'],
    ['kubectl delete pod web', 'dangerous subcommand'],
    ['terraform apply', 'dangerous subcommand'],
    ['npm publish', 'dangerous subcommand'],
    ['aws s3 rm --recursive s3://prod', 'destructive verb before a flag'],
    ['aws s3 rb s3://prod --force', 'destructive verb'],
    ['aws ec2 terminate-instances --instance-ids i-1', 'destructive verb'],
    ['gh repo delete me/app --yes', 'destructive verb'],
    ['docker volume rm data', 'destructive verb'],
    ['docker system prune -a', 'destructive verb'],
    ['docker run ubuntu rm tmpfile', 'destructive verb among the leading words'],
    ['heroku apps:destroy --app x', 'destructive verb'],
    ['rm -rf build', 'dangerous command'],
    ['sudo git commit -m x', 'wrapper'],
    ['pkexec apt install x', 'wrapper'],
    ['env FOO=1 make', 'wrapper'],
    ['xargs rm', 'wrapper'],
    ['git status && rm -rf ~', 'chain'],
    ['npm test; rm -rf ~', 'sequence'],
    ['cat notes.txt | sh', 'pipeline'],
    ['echo hi > file.txt', 'redirect'],
    ['FOO=bar make deploy', 'environment assignment'],
    ['git commit -m "$(whoami)"', 'command substitution'],
    ['git commit -m x &', 'background job'],
    ['git -C /repo push', 'flag before the subcommand'],
    ['gh api -X DELETE repos/o/r', 'gh api decides its method with a flag'],
    ['gh api repos/o/r', 'gh api decides its method with a flag'],
  ])('%s -> no key (%s)', (command) => {
    expect(getBashRememberKey(command)).toBeNull();
  });
});

describe('isDangerousArgv', () => {
  it('matches single commands and <command> <subcommand> pairs', () => {
    expect(isDangerousArgv(['rm', '-rf', 'x'])).toBe(true);
    expect(isDangerousArgv(['git', 'push'])).toBe(true);
    expect(isDangerousArgv(['/usr/bin/git', 'reset', '--hard'])).toBe(true);
    expect(isDangerousArgv(['git', 'commit'])).toBe(false);
    expect(isDangerousArgv(['ls'])).toBe(false);
  });
});

describe('getFileWriteRememberKey', () => {
  it('keys a write by the folder it goes into', () => {
    expect(getFileWriteRememberKey('/repo/src/a.ts')).toBe(`write:${dirname(resolve('/repo/src/a.ts'))}`);
    expect(getFileWriteRememberKey('/repo/src/b.ts')).toBe(`write:${dirname(resolve('/repo/src/b.ts'))}`);
    expect(getFileWriteRememberKey('~/.ssh/authorized_keys')).toBe(`write:${join(homedir(), '.ssh')}`);
    expect(getFileWriteRememberKey('/repo/src/../../etc/hosts')).toBe(`write:${dirname(resolve('/repo/src/../../etc/hosts'))}`);
  });
});

describe('getNetworkCommandHosts', () => {
  it('collects every host a curl call contacts', () => {
    expect(getNetworkCommandHosts('curl -sS https://api.example.com/v1 https://Evil.com/x')).toEqual(['api.example.com', 'evil.com']);
  });

  it('counts schemeless URLs with or without dots, user info and ports', () => {
    expect(getNetworkCommandHosts('curl api.example.com/v1')).toEqual(['api.example.com']);
    expect(getNetworkCommandHosts('curl localhost/admin https://api.example.com/v1')).toEqual(['localhost', 'api.example.com']);
    expect(getNetworkCommandHosts('wget https://user:pw@files.example.com:8443/a.tgz')).toEqual(['files.example.com']);
    expect(getNetworkCommandHosts('curl http://localhost:3000/health')).toEqual(['localhost']);
  });

  it('reads the host the way curl does when user info hides another name', () => {
    expect(getNetworkCommandHosts('curl https://allowed.com@evil.com/')).toEqual(['evil.com']);
    expect(getNetworkCommandHosts('curl "https://evil.com#@allowed.com"')).toEqual(['evil.com']);
  });

  it('refuses to vouch for URLs it cannot parse or cannot see', () => {
    expect(getNetworkCommandHosts('curl --url=https://evil.com/x https://api.example.com')).toBeNull();
    expect(getNetworkCommandHosts('curl "https://evil.com\\@allowed.com"')).toBeNull();
    expect(getNetworkCommandHosts('curl "[::1"')).toBeNull();
  });

  it('is null for chains, config or input files, and other commands', () => {
    expect(getNetworkCommandHosts('curl https://a.com && rm -rf ~')).toBeNull();
    expect(getNetworkCommandHosts('curl -K urls.txt')).toBeNull();
    expect(getNetworkCommandHosts('wget -i urls.txt')).toBeNull();
    expect(getNetworkCommandHosts('git fetch https://a.com/repo.git')).toBeNull();
  });
});
