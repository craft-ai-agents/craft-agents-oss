import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { brewInstallArgs, createManager } from '../manager';
import type { BrewInstallContext, GitNpmInstallContext, PipInstallContext } from '../manager';
import { currentPlatform, toolchainPaths } from '../manifest';
import type { ToolArtifact, ToolEntry, ToolName } from '../types';

const FIXTURES = path.join(import.meta.dir, 'fixtures');
const ZIP_BYTES = fs.readFileSync(path.join(FIXTURES, 'demo-1.0.0.zip'));
const ZIP_SHA256 = '256730d7e1cf9c1fbacc93b92e35a5e1d476db1fa66e09687e393e31b4968c04';
const sleepNoop = () => Promise.resolve();

let tmpDir: string;
let counter = 0;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-kinds-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function demoArtifact(): ToolArtifact {
  return {
    url: 'http://test.invalid/demo.zip',
    sha256: ZIP_SHA256,
    size: ZIP_BYTES.byteLength,
    archive: 'zip',
    binPaths: ['bin/demo'],
  };
}

/**
 * jq = core (tier не указан — дефолт 'core'), fzf = default-on, skills = opt-in.
 * Все binary на одном zip-фикстуре; сети нет (fetch подменён).
 */
function tierManifest(): ToolEntry[] {
  const plat = currentPlatform();
  return [
    { name: 'jq', version: '1.0.0', displayName: 'jq', artifacts: { [plat]: demoArtifact() } },
    { name: 'fzf', version: '1.0.0', tier: 'default-on', displayName: 'fzf', artifacts: { [plat]: demoArtifact() } },
    {
      name: 'skills',
      version: '1.0.0',
      tier: 'opt-in',
      displayName: 'skills',
      artifacts: { [plat]: demoArtifact() },
    },
  ];
}

function makeManager(
  manifest: ToolEntry[],
  opts: {
    disabledTools?: ToolName[];
    pathEnv?: string;
    brewInstallImpl?: (ctx: BrewInstallContext) => Promise<void>;
    brewUninstallImpl?: (ctx: { brewBin: string; formula: string }) => Promise<void>;
    brewVersionImpl?: (ctx: {
      brewBin: string;
      formula: string;
      entry: ToolEntry;
    }) => Promise<string>;
    gitNpmInstallImpl?: (ctx: GitNpmInstallContext) => Promise<void>;
    pipInstallImpl?: (ctx: PipInstallContext) => Promise<void>;
  } = {},
) {
  const configDir = path.join(tmpDir, `cfg-${counter++}`);
  const paths = toolchainPaths(configDir);
  const fetchCalls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    fetchCalls.push(String(input));
    return new Response(ZIP_BYTES, { headers: { 'content-length': String(ZIP_BYTES.byteLength) } });
  }) as unknown as typeof fetch;
  const manager = createManager(paths, {
    manifest,
    fetchImpl,
    sleepImpl: sleepNoop,
    retryDelaysMs: [1, 1, 1],
    disabledTools: opts.disabledTools,
    pathEnv: opts.pathEnv,
    brewInstallImpl: opts.brewInstallImpl,
    brewVersionImpl: opts.brewVersionImpl,
    brewUninstallImpl: opts.brewUninstallImpl,
    gitNpmInstallImpl: opts.gitNpmInstallImpl,
    pipInstallImpl: opts.pipInstallImpl,
  });
  return { manager, paths, fetchCalls };
}

describe('kinds: tier-фильтр ensureAll', () => {
  it('core ставится всегда; default-on — если не disabled; opt-in — никогда', async () => {
    const { manager, fetchCalls } = makeManager(tierManifest());
    const after = await manager.ensureAll({ background: false });
    expect(after.find((s) => s.name === 'jq')?.phase).toBe('ready');
    expect(after.find((s) => s.name === 'fzf')?.phase).toBe('ready');
    // opt-in игнорируется ensureAll даже без disabled-списка
    expect(after.find((s) => s.name === 'skills')?.phase).toBe('missing');
    // скачивались только jq и fzf
    expect(fetchCalls).toHaveLength(2);
  });

  it("disabled=['fzf']: default-on из списка пропускается, core ставится; очистка списка доустанавливает", async () => {
    const { manager, fetchCalls } = makeManager(tierManifest(), { disabledTools: ['fzf'] });
    const after = await manager.ensureAll({ background: false });
    expect(after.find((s) => s.name === 'jq')?.phase).toBe('ready');
    expect(after.find((s) => s.name === 'fzf')?.phase).toBe('missing');
    expect(fetchCalls).toHaveLength(1); // только core
    expect(manager.getDisabledTools()).toEqual(['fzf']);

    manager.setDisabledTools([]);
    expect(manager.getDisabledTools()).toEqual([]);
    const rerun = await manager.ensureAll({ background: false });
    expect(rerun.find((s) => s.name === 'fzf')?.phase).toBe('ready');
    expect(fetchCalls).toHaveLength(2); // jq не перекачивается, fzf доустановился
  });

  it('brew без префлайта (brew не на PATH) -> skipped-no-brew, brew install не вызывается', async () => {
    let brewCalls = 0;
    const { manager } = makeManager(
      [
        {
          name: 'mole',
          version: '1.49.2',
          kind: 'brew',
          tier: 'opt-in',
          displayName: 'mole',
          systemBinary: 'mole',
          brewFormula: 'mole',
          artifacts: {},
        },
      ],
      {
        // Изоляция от хоста: на dev-машине /opt/homebrew/bin/brew существует —
        // пустой pathEnv делает префлайт детерминированно непройденным.
        pathEnv: '',
        brewInstallImpl: async () => {
          brewCalls++;
        },
      },
    );

    // ensureAll brew-kind не планирует вовсе (kind brew — только через update)
    await manager.ensureAll({ background: false });
    expect(brewCalls).toBe(0);

    // статус: ни системного mole, ни brew на PATH → skipped-no-brew (а не missing)
    expect((await manager.status()).find((s) => s.name === 'mole')?.phase).toBe('skipped-no-brew');

    // update — единственный путь установки opt-in/brew — тоже упирается в префлайт
    const st = await manager.update('mole');
    expect(st.phase).toBe('skipped-no-brew');
    expect(brewCalls).toBe(0);
  });
});

describe('kinds: git-npm (gbrain)', () => {
  // Запись-зеркало MANIFEST_DATA.gbrain (консистентность самой записи с матрицей
  // и git-locks.ts проверяет guard-тест в manifest.test.ts). Инструмент by design
  // без artifacts: скачивания нет, bun вытаскивает pinned коммит (установка мокнута).
  const gbrainEntry: ToolEntry = {
    name: 'gbrain',
    version: '15b9863d1363',
    kind: 'git-npm',
    tier: 'default-on',
    displayName: 'gbrain',
    dependsOn: ['bun'],
    artifacts: {},
  };

  /** Префлайт `resolver.findExecutable('bun')`: фейковый bun в изолированном PATH. */
  function stubBunPathEnv(): string {
    const dir = path.join(tmpDir, `bunbin-${counter}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bun'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    return dir;
  }

  it('ensureAll видит git-npm default-on без artifacts: планирует, ставит через gitNpmInstallImpl, статус ready', async () => {
    const installs: string[] = [];
    const { manager, fetchCalls } = makeManager([gbrainEntry], {
      pathEnv: stubBunPathEnv(),
      gitNpmInstallImpl: async (ctx) => {
        installs.push(`${ctx.entry.name}@${ctx.entry.version}`);
        // реальный defaultGitNpmInstall кладёт дерево в versionDir (BUN_INSTALL) — эмулируем факт.
        fs.mkdirSync(ctx.versionDir, { recursive: true });
      },
    });

    // до установки инструмент присутствует в статусе как missing
    // (git-npm без artifacts не должен выпадать из снапшота и не ловить system-fallback)
    expect((await manager.status()).find((s) => s.name === 'gbrain')?.phase).toBe('missing');

    const after = await manager.ensureAll({ background: false });
    expect(after.find((s) => s.name === 'gbrain')?.phase).toBe('ready');
    expect(installs).toEqual(['gbrain@15b9863d1363']);
    // артефакта нет → сетевых скачиваний не было вовсе
    expect(fetchCalls).toHaveLength(0);

    // повторный ensureAll идемпотентен: установленная версия совпадает, переустановки нет
    await manager.ensureAll({ background: false });
    expect(installs).toHaveLength(1);
  });

  it('update(gbrain) ставится через sentinel-артефакт: gitNpmInstallImpl без prerecorded download', async () => {
    let installs = 0;
    const { manager } = makeManager([gbrainEntry], {
      pathEnv: stubBunPathEnv(),
      gitNpmInstallImpl: async (ctx) => {
        installs++;
        fs.mkdirSync(ctx.versionDir, { recursive: true });
      },
    });
    const st = await manager.update('gbrain');
    expect(st.phase).toBe('ready');
    expect(st.installedVersion).toBe('15b9863d1363');
    expect(installs).toBe(1);
  });
});

/** Префлайт `resolver.findExecutable('brew')`: фейковый brew в изолированном PATH. */
function stubBrewPathEnv(): string {
  const dir = path.join(tmpDir, `brewbin-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'brew'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return dir;
}

function moleBrewEntry(version: string): ToolEntry {
  return {
    name: 'mole',
    version,
    kind: 'brew',
    tier: 'opt-in',
    displayName: 'mole',
    systemBinary: 'mole',
    brewFormula: 'mole',
    artifacts: {},
  };
}

describe('kinds: brew pin verify', () => {
  it('pin match → ready with installedVersion = pin', async () => {
    let brewCalls = 0;
    const pin = '1.49.2';
    const { manager } = makeManager([moleBrewEntry(pin)], {
      pathEnv: stubBrewPathEnv(),
      brewInstallImpl: async () => {
        brewCalls++;
      },
      brewVersionImpl: async () => `mole ${pin}`,
    });

    const st = await manager.update('mole');
    expect(st.phase).toBe('ready');
    expect(st.installedVersion).toBe(pin);
    expect(brewCalls).toBe(1);
  });

  it('brewInstallArgs(mole) → install --quiet mole', () => {
    expect(brewInstallArgs('mole')).toEqual(['install', '--quiet', 'mole']);
  });

  it('pin mismatch → error; brewInstall was called; uninstall DI called', async () => {
    let brewCalls = 0;
    let uninstallCalls = 0;
    const pin = '1.49.2';
    const { manager } = makeManager([moleBrewEntry(pin)], {
      pathEnv: stubBrewPathEnv(),
      brewInstallImpl: async () => {
        brewCalls++;
      },
      brewUninstallImpl: async () => {
        uninstallCalls++;
      },
      brewVersionImpl: async () => 'mole 9.9.9',
    });

    const st = await manager.update('mole');
    expect(st.phase).toBe('error');
    expect(st.error).toContain('brew version mismatch');
    expect(st.error).toContain(pin);
    expect(brewCalls).toBe(1);
    expect(uninstallCalls).toBeGreaterThanOrEqual(1);
  });

  it("pin '1.4' must NOT match stdout 'mole 1.49.2' (no substring)", async () => {
    let brewCalls = 0;
    const pin = '1.4';
    const { manager } = makeManager([moleBrewEntry(pin)], {
      pathEnv: stubBrewPathEnv(),
      brewInstallImpl: async () => {
        brewCalls++;
      },
      brewVersionImpl: async () => 'mole 1.49.2',
    });

    const st = await manager.update('mole');
    expect(st.phase).toBe('error');
    expect(st.error).toContain('brew version mismatch');
    expect(st.error).toContain(pin);
    expect(st.error).toContain('1.49.2');
    expect(brewCalls).toBe(1);
  });

  it("no pin (version 'system') → ready installedVersion 'system'", async () => {
    let brewCalls = 0;
    let versionCalls = 0;
    const { manager } = makeManager([moleBrewEntry('system')], {
      pathEnv: stubBrewPathEnv(),
      brewInstallImpl: async () => {
        brewCalls++;
      },
      brewVersionImpl: async () => {
        versionCalls++;
        return 'mole 1.0.0';
      },
    });

    const st = await manager.update('mole');
    expect(st.phase).toBe('ready');
    expect(st.installedVersion).toBe('system');
    expect(brewCalls).toBe(1);
    expect(versionCalls).toBe(0);
  });
});

describe('kinds: pip fail-closed', () => {
  it('update without lock → error about requirements lock', async () => {
    // synthetic fixture — reuse ToolName; kind pip overrides install path
    const pipEntry: ToolEntry = {
      name: 'jq',
      version: '0.0.0-no-lock',
      kind: 'pip',
      tier: 'opt-in',
      displayName: 'fake-pip',
      artifacts: {},
    };
    const { manager } = makeManager([pipEntry], { pathEnv: '' });

    // ensureAll always skips pip
    await manager.ensureAll({ background: false });
    expect((await manager.status()).find((s) => s.name === 'jq')?.phase).toBe('missing');

    const st = await manager.update('jq');
    expect(st.phase).toBe('error');
    expect(st.error).toContain('requirements lock');
    expect(st.error).toContain('fail-closed');
  });

  it('update with lock + pipInstallImpl → ready, layout under py_packages', async () => {
    // Stub uv+python on PATH so resolver finds them; real uv never runs (DI).
    const binDir = path.join(tmpDir, `pip-bins-${counter++}`);
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ['uv', 'python3']) {
      const p = path.join(binDir, name);
      fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }

    const pipEntry: ToolEntry = {
      name: 'pip-packaging',
      version: '24.2',
      kind: 'pip',
      tier: 'opt-in',
      displayName: 'packaging (pip)',
      dependsOn: ['uv', 'python'],
      pipPackage: 'packaging',
      artifacts: {},
    };

    let installCalls = 0;
    const captured: PipInstallContext[] = [];
    const { manager, paths } = makeManager([pipEntry], {
      pathEnv: binDir,
      pipInstallImpl: async (ctx) => {
        installCalls++;
        captured.push(ctx);
        // emulate site-packages drop
        fs.mkdirSync(path.join(ctx.targetDir, 'packaging'), { recursive: true });
        fs.writeFileSync(path.join(ctx.targetDir, 'packaging', '__init__.py'), '');
      },
    });

    // ensureAll still skips opt-in pip
    await manager.ensureAll({ background: false });
    expect((await manager.status()).find((s) => s.name === 'pip-packaging')?.phase).toBe('missing');
    expect(installCalls).toBe(0);

    const st = await manager.update('pip-packaging');
    expect(st.phase).toBe('ready');
    expect(st.installedVersion).toBe('24.2');
    expect(installCalls).toBe(1);

    const ctx = captured[0]!;
    expect(ctx.uv).toContain('uv');
    expect(ctx.python).toContain('python');
    expect(ctx.requirements).toContain('packaging==24.2');
    expect(ctx.requirements).toContain('--hash=sha256:');
    expect(ctx.targetDir).toBe(path.join(ctx.versionDir, 'py_packages'));
    expect(fs.existsSync(ctx.requirementsFile)).toBe(true);
    expect(fs.readFileSync(ctx.requirementsFile, 'utf8')).toBe(ctx.requirements);
    expect(fs.existsSync(path.join(ctx.targetDir, 'packaging', '__init__.py'))).toBe(true);
    expect(st.installedPath).toBe(path.join(paths.toolchainDir, 'pip-packaging', '24.2'));
    // current symlink/junction flipped
    expect(fs.existsSync(path.join(paths.toolchainDir, 'pip-packaging', 'current'))).toBe(true);
  });

  it('update with lock + pipModule writes launcher bin', async () => {
    const binDir = path.join(tmpDir, `pip-bins-${counter++}`);
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ['uv', 'python3']) {
      fs.writeFileSync(path.join(binDir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }

    const realEntry: ToolEntry = {
      name: 'pip-packaging',
      version: '24.2',
      kind: 'pip',
      tier: 'opt-in',
      displayName: 'packaging',
      pipModule: 'packaging',
      systemBinary: 'packaging-cli',
      artifacts: {},
    };

    const { manager, paths } = makeManager([realEntry], {
      pathEnv: binDir,
      pipInstallImpl: async (ctx) => {
        fs.mkdirSync(ctx.targetDir, { recursive: true });
      },
    });

    const st = await manager.update('pip-packaging');
    expect(st.phase).toBe('ready');
    const launcher = path.join(paths.toolchainDir, 'pip-packaging', '24.2', 'bin', 'packaging-cli');
    expect(fs.existsSync(launcher)).toBe(true);
    const body = fs.readFileSync(launcher, 'utf8');
    expect(body).toContain('PYTHONPATH=');
    expect(body).toContain('py_packages');
    expect(body).toContain('-m');
    expect(body).toContain('packaging');
  });

  it('missing uv → error without calling pipInstallImpl', async () => {
    let calls = 0;
    const pipEntry: ToolEntry = {
      name: 'pip-packaging',
      version: '24.2',
      kind: 'pip',
      tier: 'opt-in',
      displayName: 'packaging',
      artifacts: {},
    };
    const { manager } = makeManager([pipEntry], {
      pathEnv: '', // no uv/python
      pipInstallImpl: async () => {
        calls++;
      },
    });
    const st = await manager.update('pip-packaging');
    expect(st.phase).toBe('error');
    expect(st.error).toMatch(/uv not found/i);
    expect(calls).toBe(0);
  });
});

describe('kinds: cli-anything pip', () => {
  it('update with lock + pipInstallImpl → ready; ensureAll skips', async () => {
    const binDir = path.join(tmpDir, `pip-bins-${counter++}`);
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ['uv', 'python3']) {
      const p = path.join(binDir, name);
      fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }

    const pipEntry: ToolEntry = {
      name: 'cli-anything',
      version: '0.4.1',
      kind: 'pip',
      tier: 'opt-in',
      displayName: 'CLI-Anything',
      dependsOn: ['uv', 'python'],
      pipPackage: 'cli-anything-hub',
      pipModule: 'cli_hub.cli',
      systemBinary: 'cli-hub',
      artifacts: {},
    };

    let installCalls = 0;
    const captured: PipInstallContext[] = [];
    const { manager, paths } = makeManager([pipEntry], {
      pathEnv: binDir,
      pipInstallImpl: async (ctx) => {
        installCalls++;
        captured.push(ctx);
        fs.mkdirSync(path.join(ctx.targetDir, 'cli_hub'), { recursive: true });
        fs.writeFileSync(path.join(ctx.targetDir, 'cli_hub', '__init__.py'), '');
      },
    });

    await manager.ensureAll({ background: false });
    expect((await manager.status()).find((s) => s.name === 'cli-anything')?.phase).toBe('missing');
    expect(installCalls).toBe(0);

    const st = await manager.update('cli-anything');
    expect(st.phase).toBe('ready');
    expect(st.installedVersion).toBe('0.4.1');
    expect(installCalls).toBe(1);

    const ctx = captured[0]!;
    expect(ctx.requirements).toContain('cli-anything-hub==0.4.1');
    expect(ctx.requirements).toContain('--hash=sha256:');
    expect(ctx.targetDir).toBe(path.join(ctx.versionDir, 'py_packages'));
    expect(st.installedPath).toBe(path.join(paths.toolchainDir, 'cli-anything', '0.4.1'));
    expect(fs.existsSync(path.join(paths.toolchainDir, 'cli-anything', 'current'))).toBe(true);

    const launcher = path.join(paths.toolchainDir, 'cli-anything', '0.4.1', 'bin', 'cli-hub');
    expect(fs.existsSync(launcher)).toBe(true);
    const body = fs.readFileSync(launcher, 'utf8');
    expect(body).toContain('PYTHONPATH=');
    expect(body).toContain('cli_hub.cli');
  });
});

