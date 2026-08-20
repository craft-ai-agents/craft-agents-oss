/**
 * Toolchain Download Manager — контракты.
 * Spec: docs/superpowers/specs/2026-08-06-toolchain-download-manager-design.md
 */

export type ToolchainPlatform = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64';

/** Written only after an installation is complete; resolvers reject partial versions. */
export const TOOLCHAIN_INSTALL_COMPLETE_MARKER = '.craft-toolchain-install-complete';

export type ToolName =
  // core (11): всегда ставятся ensureAll'ом
  | 'omp'
  | 'python'
  | 'node'
  | 'ffmpeg'
  | 'pandoc'
  | 'gh'
  | 'jq'
  | 'yq'
  | 'git'
  | 'bun'
  | 'uv'
  // binary default-on: ensureAll ставит, пока не в config toolchain.disabled
  | 'just'
  | 'fzf'
  | 'mise'
  | 'worktrunk'
  // binary opt-in: только через update(name)
  | 'infisical'
  // npm default-on (тарболл + fail-closed npm ci по embedded lock)
  | 'opencode-ai'
  // oh-my-openagent сознательно НЕ в union: npm-дерево содержит неопубликованный
  // транзитив git-bash-mcp (EUNSUPPORTEDPROTOCOL/404) — npm-kind невозможен до фикса апстрима
  | 'oh-my-codex'
  | 'oh-my-claude-sisyphus'
  | 'skills'
  // npm opt-in (эти 5 vercel tools ставятся из marketplace kind:tool через update)
  | 'eve'
  | 'agent-browser'
  | 'portless'
  | 'just-bash'
  | 'opensrc'
  | 'deepsec'
  | 'dev3000'
  // npm opt-in: isolated managed OpenClaw runtime (never resolves a global binary)
  | 'openclaw'
  // git-npm default-on: bun install -g github:repo@commit
  | 'gbrain'
  // brew opt-in (mac only): brew install, префлайт command -v brew
  | 'mole'
  // detect opt-in: только детект системного исполняемого, установки нет
  | 'docker'
  | 'brew'
  // pip opt-in: uv pip install --require-hashes into toolchain layout
  | 'pip-packaging'
  | 'cli-anything';


/** Every known ToolName — used to filter persisted toolchain.disabled and UI toggles. */
export const ALL_TOOL_NAMES = [
  'omp',
  'python',
  'node',
  'ffmpeg',
  'pandoc',
  'gh',
  'jq',
  'yq',
  'git',
  'bun',
  'uv',
  'just',
  'fzf',
  'mise',
  'worktrunk',
  'infisical',
  'opencode-ai',
  'oh-my-codex',
  'oh-my-claude-sisyphus',
  'skills',
  'eve',
  'agent-browser',
  'portless',
  'just-bash',
  'opensrc',
  'deepsec',
  'dev3000',
  'openclaw',
  'gbrain',
  'mole',
  'docker',
  'brew',
  'pip-packaging',
  'cli-anything',
] as const satisfies readonly ToolName[];

const TOOL_NAME_SET: ReadonlySet<string> = new Set(ALL_TOOL_NAMES);

/** True when `name` is a known ToolName (fail-closed for config / RPC input). */
export function isToolName(name: string): name is ToolName {
  return TOOL_NAME_SET.has(name);
}

/** Стратегия установки инструмента. */
export type ToolKind =
  /** Архив с бинарником по pinned url+sha256 (текущий путь). */
  | 'binary'
  /** npm-тарболл + wrapper-launcher + npm ci --locked deps (npm-locks.ts). */
  | 'npm'
  /** git-репозиторий, pinned коммитом: bun install -g github:repo@commit (git-locks.ts). */
  | 'git-npm'
  /** pip-пакет: uv pip install --require-hashes -r embedded lock (pip-locks.ts). */
  | 'pip'
  /** Homebrew формула: префлайт `command -v brew`, иначе статус skipped-no-brew. */
  | 'brew'
  /** Только детект системного исполняемого (docker/brew); toolchain ничего не ставит. */
  | 'detect';

/** Волна установки инструмента в ensureAll. */
export type ToolTier =
  /** Всегда ставится ensureAll'ом (11 исходных инструментов). */
  | 'core'
  /** Ставится ensureAll'ом, если не disabled в config (toolchain.disabled). */
  | 'default-on'
  /** Никогда не ставится ensureAll'ом — только явный update(name). */
  | 'opt-in';

/** Один артефакт для скачивания под конкретную платформу. */
export interface ToolArtifact {
  /** Прямой URL артефакта (no API — GitHub release asset / vendor CDN / npm tarball). */
  url: string;
  /** sha256 файла в hex (lowercase), обязателен для записей manifest. */
  sha256: string;
  /** Размер в байтах (для прогресс-баров и аннотирования UI). */
  size: number;
  /** Тип архива. 'raw' — голый бинарник. 'uv-python' — ставится командой `uv python install`. */
  archive: 'tar.gz' | 'tar.xz' | 'zip' | 'raw' | 'uv-python';
  /**
   * Пути к исполняемым файлам внутри распакованного дерева инструмента,
   * относительно toolchain/<tool>/<version>/. Windows — .exe обязаны.
   * Пример для node darwin: ['bin/node', 'bin/npx'].
   */
  binPaths: string[];
}

export interface ToolEntry {
  name: ToolName;
  /** Pinned-версии (inf ждет). */
  version: string;
  /** Стратегия установки (default: 'binary'). */
  kind?: ToolKind;
  /** Волна ensureAll (default: 'core'). */
  tier?: ToolTier;
  /** Критичный (omp): блокирует дефолтное OMP-подключение; статус дублируется в UI подключением. */
  critical?: boolean;
  /** Инструменты, которые должны быть установлены раньше (волнами ensureAll). */
  dependsOn?: ToolName[];
  /** Показываемая подсказка/icon для UI. */
  displayName: string;
  /** Per-platform записи. Отсутствие ключа = инструмент недоступен/не нужен на этой платформе (git: только win32-x64). */
  artifacts: Partial<Record<ToolchainPlatform, ToolArtifact>>;
  /** Платформы, на которых инструмент вообще существует (из TOOL_PLATFORM_MATRIX); undefined = все. */
  platforms?: ToolchainPlatform[];
  /**
   * Системный исполняемый для детекта/fallback: detect/brew kinds и
   * инструменты без артефакта под платформу (git на mac/linux → 'git').
   */
  systemBinary?: string;
  /** brew kind: имя формулы для `brew install` (default — имя инструмента). */
  brewFormula?: string;
  /**
   * pip kind: PyPI distribution name (docs/UI; lock in pip-locks.ts is source of truth).
   * Not consumed directly by the installer.
   */
  pipPackage?: string;
  /**
   * pip kind: console-script / `python -m <module>` name. When set,
   * updatePipTool writes a launcher under versionDir/bin/<systemBinary|name>.
   */
  pipModule?: string;
}

export type ToolPhase =
  | 'missing'
  | 'downloading'
  | 'installing'
  | 'ready'
  | 'outdated'
  | 'error'
  | 'offline'
  /** brew kind: префлайт `command -v brew` не прошёл — инструмент пропущен. */
  | 'skipped-no-brew';

export interface ToolStatus {
  name: ToolName;
  phase: ToolPhase;
  /**
   * Install tier from the manifest entry (core / default-on / opt-in).
   * Always set by the manager when emitting status. Missing on legacy
   * payloads → treat as core (no enable/disable toggle) fail-safe.
   */
  tier?: ToolTier;
  /** Скачанные байты текущей загрузки. */
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
  /** Installed путь: <toolchainDir>/<tool>/<version>. */
  installedPath?: string;
  installedVersion?: string;
}

export interface ToolchainStateFile {
  /** per-tool persist state, живёт между рестартами. */
  tools: Partial<
    Record<
      ToolName,
      {
        installedVersion: string;
        installedPath: string;
        lastError?: string;
      }
    >
  >;
}


/**
 * Exact managed OpenClaw launcher. `executablePath` is the toolchain-owned
 * Node binary and `argsPrefix[0]` is the verified package entrypoint.
 */
export interface ManagedOpenClawLauncher {
  executablePath: string;
  argsPrefix: readonly [string];
  version: '2026.7.1-2';
}

/** Публичный API — consumers: OmpAgent, agents env, bootstrap, UI status. */
export interface ToolchainResolver {
  /** Путь исполняемого с приоритетом: toolchain → bundled → PATH (null если нигде нет). */
  findExecutable(name: string): Promise<string | null>;
  /** Только pinned managed Node + package/openclaw.mjs; PATH/global OpenClaw запрещены. */
  resolveOpenClawLauncher(): Promise<ManagedOpenClawLauncher | null>;
  /** Префикс PATH, который должен получить каждый сабпроцесс агента (bin-диры toolchain + bundled). */
  toolchainPathPrefix(): Promise<string>;
  /** Директория toolchain: <CONFIG_DIR>/toolchain. */
  toolchainDir(): string;
}

export interface ToolchainManager {
  /** Diff manifest vs state; фоново ставит missing/outdated; возвращает snapshot сразу. */
  ensureAll(opts?: { background?: boolean }): Promise<ToolStatus[]>;
  /** Текущий snapshot состояний без побочных эффектов. */
  status(): Promise<ToolStatus[]>;
  /** Принудительное обновление одного инструмента (единственный путь установки opt-in). */
  update(name: ToolName): Promise<ToolStatus>;
  /** Подписка на прогресс (для UI/IPC). */
  onStatusChange(listener: (status: ToolStatus) => void): () => void;
  /** Заменить список disabled-инструментов (default-on tier пропускается ensureAll'ом). */
  setDisabledTools(tools: ToolName[]): ToolName[];
  /** Текущий список disabled-инструментов. */
  getDisabledTools(): ToolName[];
}

export interface ToolchainPaths {
  toolchainDir: string; // <CONFIG_DIR>/toolchain
  downloadsDir: string; // <CONFIG_DIR>/downloads
  stateFile: string; // <CONFIG_DIR>/toolchain/state.json
}
