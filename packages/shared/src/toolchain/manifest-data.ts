/**
 * Данные манифеста toolchain — PURE DATA, без логики.
 *
 * ВЛАДЕЛЕЦ: Collector-агент перезаписывает этот файл при сборе/бампе версий.
 * Все записи проверены: каждый артефакт скачан 2026-08-06 и sha256/size
 * вычислены локально; где вендор публикует checksums (nodejs SHASUMS256.txt,
 * jqlang/jq sha256sum.txt, cli/cli checksums.txt, mikefarah/yq checksums,
 * BtbN checksums.sha256) — локальный sha256 сверен с опубликованным.
 * Если платформы нет в artifacts — инструмент на ней недоступен (пропускается менеджером).
 */

import type { ToolArtifact, ToolKind, ToolName, ToolTier, ToolchainPlatform } from './types';
import { OPENCLAW_NPM_PIN } from './npm-locks';

export interface ManifestToolData {
  version: string;
  displayName: string;
  kind?: ToolKind;
  tier?: ToolTier;
  critical?: boolean;
  dependsOn?: ToolName[];
  /** detect/brew kinds и безартефактный fallback (git на mac/linux): имя системного бинарника. */
  systemBinary?: string;
  /** brew kind: имя формулы для `brew install`. */
  brewFormula?: string;
  /** pip kind: PyPI distribution name (docs; lock is source of truth). */
  pipPackage?: string;
  /** pip kind: console-script / python -m module for launcher generation. */
  pipModule?: string;
  artifacts: Partial<Record<ToolchainPlatform, ToolArtifact>>;
}

/** Матрица «инструмент → целевые платформы». git — только win32-x64 (на mac/linux git системный). */
export const TOOL_PLATFORM_MATRIX: Record<ToolName, ToolchainPlatform[]> = {
  omp: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  python: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  node: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  ffmpeg: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  pandoc: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  gh: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  jq: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  yq: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  git: ['win32-x64'],
  bun: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  uv: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],

  // binary default-on (github releases, sha256 из релизных checksums)
  just: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  fzf: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  mise: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  worktrunk: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  // binary opt-in
  infisical: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],

  // npm default-on (тарболл платформонезависимый; opencode-ai postinstall кладёт нативный бинарь)
  'opencode-ai': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  // oh-my-openagent НЕ входит: у npm-пакета транзитивный dep git-bash-mcp не опубликован
  // (npm EUNSUPPORTEDPROTOCOL/404) — npm-kind невозможен до фикса апстрима.
  'oh-my-codex': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  'oh-my-claude-sisyphus': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  skills: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  // npm opt-in
  openclaw: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  // Vercel marketplace kind:tool path
  eve: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  'agent-browser': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  portless: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  'just-bash': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  opensrc: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  deepsec: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  dev3000: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],

  // git-npm default-on: bun install -g github:garrytan/gbrain@commit (платформонезависимый JS)
  gbrain: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],

  // brew opt-in: формула mole публикуется только под macOS
  mole: ['darwin-arm64', 'darwin-x64'],

  // detect opt-in: системные исполняемые (brew под win не существует)
  docker: ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  brew: ['darwin-arm64', 'darwin-x64', 'linux-x64'],

  // pip opt-in: uv pip install --require-hashes (embedded lock in pip-locks.ts)
  'pip-packaging': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
  'cli-anything': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
};

function uvPython(binPaths: string[]): ToolArtifact {
  return {
    url: '',
    sha256: 'uv-managed',
    size: 0,
    archive: 'uv-python',
    binPaths,
  };
}

export const MANIFEST_DATA: Partial<Record<ToolName, ManifestToolData>> = {
  // omp 17.2.10 — npm tarball @oh-my-pi/pi-coding-agent (платформонезависимый JS).
  // sha256 скачанного tarball; npm integrity (sha512) сверен.
  // binPaths — именованные лончеры, которые installer генерирует из package.json "bin" (bin/omp + bin/omp.cmd).
  omp: {
    version: '17.2.10',
    kind: 'npm',
    tier: 'core',
    displayName: 'omp (Oh My Pi)',
    critical: true,
    // npm-тарболл + bun-рантайм wrapper + npm ci --locked deps (pi-natives) —
    // bun и node обязаны стоять первыми волнами.
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-17.2.10.tgz',
        sha256: 'e2789960126f237842ec735af6f39a89ea4c2b1792bddc8bb78e9d148477aa85',
        size: 10202985,
        archive: 'tar.gz',
        binPaths: ['bin/omp'],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-17.2.10.tgz',
        sha256: 'e2789960126f237842ec735af6f39a89ea4c2b1792bddc8bb78e9d148477aa85',
        size: 10202985,
        archive: 'tar.gz',
        binPaths: ['bin/omp'],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-17.2.10.tgz',
        sha256: 'e2789960126f237842ec735af6f39a89ea4c2b1792bddc8bb78e9d148477aa85',
        size: 10202985,
        archive: 'tar.gz',
        binPaths: ['bin/omp'],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-17.2.10.tgz',
        sha256: 'e2789960126f237842ec735af6f39a89ea4c2b1792bddc8bb78e9d148477aa85',
        size: 10202985,
        archive: 'tar.gz',
        binPaths: ['bin/omp.cmd'],
      },
    },
  },

  // python 3.12 — ставится через `uv python install`; url/sha256/size не применимы.
  python: {
    version: '3.12',
    kind: 'binary',
    tier: 'core',
    displayName: 'Python 3.12',
    // ставится только через toolchain uv — строго после него (волны dependsOn).
    dependsOn: ['uv'],
    artifacts: {
      'darwin-arm64': uvPython(['.pyinstall/bin/python3', '.pyinstall/bin/python3.12']),
      'darwin-x64': uvPython(['.pyinstall/bin/python3', '.pyinstall/bin/python3.12']),
      'linux-x64': uvPython(['.pyinstall/bin/python3', '.pyinstall/bin/python3.12']),
      'win32-x64': uvPython(['.pyinstall/python.exe']),
    },
  },

  // node 22.23.2 (LTS) — nodejs.org/dist. sha256 сверены с SHASUMS256.txt релиза.
  // binPaths включают корневую директорию архива (у archives нет stripComponents).
  node: {
    version: '22.23.2',
    kind: 'binary',
    tier: 'core',
    displayName: 'Node.js 22 LTS',
    critical: true,
    artifacts: {
      'darwin-arm64': {
        url: 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz',
        sha256: '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6',
        size: 50068815,
        archive: 'tar.gz',
        binPaths: ['node-v22.23.2-darwin-arm64/bin/node', 'node-v22.23.2-darwin-arm64/bin/npx'],
      },
      'darwin-x64': {
        url: 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-x64.tar.gz',
        sha256: '58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026',
        size: 51246936,
        archive: 'tar.gz',
        binPaths: ['node-v22.23.2-darwin-x64/bin/node', 'node-v22.23.2-darwin-x64/bin/npx'],
      },
      'linux-x64': {
        url: 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.gz',
        sha256: 'b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a',
        size: 56851233,
        archive: 'tar.gz',
        binPaths: ['node-v22.23.2-linux-x64/bin/node', 'node-v22.23.2-linux-x64/bin/npx'],
      },
      'win32-x64': {
        url: 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip',
        sha256: '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97',
        size: 35683585,
        archive: 'zip',
        binPaths: ['node-v22.23.2-win-x64/node.exe', 'node-v22.23.2-win-x64/npx.cmd'],
      },
    },
  },

  // jq 1.8.1 — голые бинарники ('raw' кладёт файл как toolchain/<tool>/<version>/bin/jq).
  // sha256 сверены с опубликованным jqlang/jq sha256sum.txt.
  jq: {
    version: '1.8.1',
    kind: 'binary',
    tier: 'core',
    displayName: 'jq',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-macos-arm64',
        sha256: 'a9fe3ea2f86dfc72f6728417521ec9067b343277152b114f4e98d8cb0e263603',
        size: 841408,
        archive: 'raw',
        binPaths: ['bin/jq'],
      },
      'darwin-x64': {
        url: 'https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-macos-amd64',
        sha256: 'e80dbe0d2a2597e3c11c404f03337b981d74b4a8504b70586c354b7697a7c27f',
        size: 855272,
        archive: 'raw',
        binPaths: ['bin/jq'],
      },
      'linux-x64': {
        url: 'https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-amd64',
        sha256: '020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d',
        size: 2255816,
        archive: 'raw',
        binPaths: ['bin/jq'],
      },
      'win32-x64': {
        url: 'https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-windows-amd64.exe',
        sha256: '23cb60a1354eed6bcc8d9b9735e8c7b388cd1fdcb75726b93bc299ef22dd9334',
        size: 1026560,
        archive: 'raw',
        binPaths: ['bin/jq.exe'],
      },
    },
  },

  // yq 4.53.3 — голые бинарники. sha256 сверены с опубликованным mikefarah/yq checksums.
  yq: {
    version: '4.53.3',
    kind: 'binary',
    tier: 'core',
    displayName: 'yq',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/mikefarah/yq/releases/download/v4.53.3/yq_darwin_arm64',
        sha256: '877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213',
        size: 13045874,
        archive: 'raw',
        binPaths: ['bin/yq'],
      },
      'darwin-x64': {
        url: 'https://github.com/mikefarah/yq/releases/download/v4.53.3/yq_darwin_amd64',
        sha256: 'b4ba1ecce3c47f00803f4f964de38394326c7a32eb6540616e04fb2935a0f08d',
        size: 13973184,
        archive: 'raw',
        binPaths: ['bin/yq'],
      },
      'linux-x64': {
        url: 'https://github.com/mikefarah/yq/releases/download/v4.53.3/yq_linux_amd64',
        sha256: 'fa52a4e758c63d38299163fbdd1edfb4c4963247918bf9c1c5d31d84789eded4',
        size: 13750434,
        archive: 'raw',
        binPaths: ['bin/yq'],
      },
      'win32-x64': {
        url: 'https://github.com/mikefarah/yq/releases/download/v4.53.3/yq_windows_amd64.exe',
        sha256: 'e279bc506a452eeafcdf364f91a025455e402a8001169083caf01f4b64a544e2',
        size: 14235136,
        archive: 'raw',
        binPaths: ['bin/yq.exe'],
      },
    },
  },

  // gh 2.97.0 — sha256 сверены с gh_2.97.0_checksums.txt.
  // macOS zip содержит top-level dir (gh_2.97.0_macOS_arm64/bin/gh); windows zip — БЕЗ top-level dir (bin/gh.exe).
  gh: {
    version: '2.97.0',
    kind: 'binary',
    tier: 'core',
    displayName: 'GitHub CLI',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_macOS_arm64.zip',
        sha256: 'a58b8fd77b417a38f47a0b54d1370c59b0fcdb324ccc9ca002b0998f7c4c999e',
        size: 13845290,
        archive: 'zip',
        binPaths: ['gh_2.97.0_macOS_arm64/bin/gh'],
      },
      'darwin-x64': {
        url: 'https://github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_macOS_amd64.zip',
        sha256: '63298c998cc2a924c9e254c6af6a1caad6ece281122687a91f079bc0a462700e',
        size: 15418698,
        archive: 'zip',
        binPaths: ['gh_2.97.0_macOS_amd64/bin/gh'],
      },
      'linux-x64': {
        url: 'https://github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_linux_amd64.tar.gz',
        sha256: 'a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112',
        size: 14770812,
        archive: 'tar.gz',
        binPaths: ['gh_2.97.0_linux_amd64/bin/gh'],
      },
      'win32-x64': {
        url: 'https://github.com/cli/cli/releases/download/v2.97.0/gh_2.97.0_windows_amd64.zip',
        sha256: '35d7fe05c4dd1411ffda1e73dfc7c6f44b75c936ca51fa6595c657fdc0350cec',
        size: 14938517,
        archive: 'zip',
        // У этого zip нет корневой директории — bin/ на верхнем уровне.
        binPaths: ['bin/gh.exe'],
      },
    },
  },

  // pandoc 3.10.1 — vendor checksums не публикует; sha256/size вычислены локально.
  pandoc: {
    version: '3.10.1',
    kind: 'binary',
    tier: 'core',
    displayName: 'Pandoc',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/jgm/pandoc/releases/download/3.10.1/pandoc-3.10.1-arm64-macOS.zip',
        sha256: '8607160694a70ed9aa63776caa44acef3afb729c379c7c283724b7e27455bfda',
        size: 41741911,
        archive: 'zip',
        binPaths: ['pandoc-3.10.1-arm64/bin/pandoc'],
      },
      'darwin-x64': {
        url: 'https://github.com/jgm/pandoc/releases/download/3.10.1/pandoc-3.10.1-x86_64-macOS.zip',
        sha256: '76430dd0ce5305fc4b91d8c0d5c22a00c8d2197ad3cef3937f65048f087164f7',
        size: 26096585,
        archive: 'zip',
        binPaths: ['pandoc-3.10.1-x86_64/bin/pandoc'],
      },
      'linux-x64': {
        url: 'https://github.com/jgm/pandoc/releases/download/3.10.1/pandoc-3.10.1-linux-amd64.tar.gz',
        sha256: '72948bf5784f560d5ad1876709daca27e0667f262da727bb33f77b58e52df2f5',
        size: 34873851,
        archive: 'tar.gz',
        binPaths: ['pandoc-3.10.1/bin/pandoc'],
      },
      'win32-x64': {
        url: 'https://github.com/jgm/pandoc/releases/download/3.10.1/pandoc-3.10.1-windows-x86_64.zip',
        sha256: '4725a1883e2171c2e181e6fd45003acb59ca4e9cbe031fdd3b79ef0d697d36aa',
        size: 41675076,
        archive: 'zip',
        // pandoc.exe лежит в корне top-level dir, bin/ нет.
        binPaths: ['pandoc-3.10.1/pandoc.exe'],
      },
    },
  },

  // git 2.55.0.3 — ТОЛЬКО win32-x64: MinGit busybox zip (на mac/linux git считаем системным).
  git: {
    version: '2.55.0.3',
    kind: 'binary',
    tier: 'core',
    // mac/linux: артефакта нет — системный git (детект через findExecutable).
    systemBinary: 'git',
    displayName: 'Git for Windows (MinGit)',
    artifacts: {
      'win32-x64': {
        url: 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/MinGit-2.55.0.3-busybox-64-bit.zip',
        sha256: 'cbb2ade2bf690b62f0d692ec64733cb26c6b4ea294b0b9752a705446f011b41f',
        size: 34275238,
        archive: 'zip',
        binPaths: ['cmd/git.exe'],
      },
    },
  },

  // ffmpeg — darwin: статические сборки martin-riedl.de (single-binary zip, версия 9.0);
  // linux/win: BtbN FFmpeg-Builds autobuild-2026-08-06-13-39, sha256 сверены с checksums.sha256.
  ffmpeg: {
    version: '9.0',
    kind: 'binary',
    tier: 'core',
    displayName: 'FFmpeg',
    critical: true,
    artifacts: {
      'darwin-arm64': {
        url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1785863997_9.0/ffmpeg.zip',
        sha256: '5267ef149ee0d208057a1b316aac079b661b0476574dee5da7d225769773c603',
        size: 28440078,
        archive: 'zip',
        // Zip содержит единственный бинарник ffmpeg в корне (без директории).
        binPaths: ['ffmpeg'],
      },
      'darwin-x64': {
        url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1785871427_9.0/ffmpeg.zip',
        sha256: '79d14663d8b078dbbc38de18d63a30f8a5bfc860af5dfee7f8cf3e387cf1c02c',
        size: 33842767,
        archive: 'zip',
        binPaths: ['ffmpeg'],
      },
      'linux-x64': {
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-06-13-39/ffmpeg-N-125978-g95c43d7df7-linux64-lgpl.tar.xz',
        sha256: '97d4b95d33da6f0d3102e252eaa7a4778a673ebf2434a0bf15f409a37e3afeb1',
        size: 114391856,
        archive: 'tar.xz',
        binPaths: ['ffmpeg-N-125978-g95c43d7df7-linux64-lgpl/bin/ffmpeg'],
      },
      'win32-x64': {
        url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-06-13-39/ffmpeg-N-125978-g95c43d7df7-win64-lgpl.zip',
        sha256: '79ab2838ff13a71df85ba452d633b964fe5cc681f7eccb1f3e873649974fbe1f',
        size: 148267877,
        archive: 'zip',
        binPaths: ['ffmpeg-N-125978-g95c43d7df7-win64-lgpl/bin/ffmpeg.exe'],
      },
    },
  },

  // bun 1.3.14 — oven-sh/bun GitHub releases. sha256 сверены с SHASUMS256.txt релиза;
  // darwin-aarch64 дополнительно скачан и перепроверен локально.
  // Non-baseline сборки (для M1+/современных CPU). binPaths включают top-level dir zip'а.
  bun: {
    version: '1.3.14',
    kind: 'binary',
    tier: 'core',
    displayName: 'Bun',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip',
        sha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
        size: 23586433,
        archive: 'zip',
        binPaths: ['bun-darwin-aarch64/bun'],
      },
      'darwin-x64': {
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-x64.zip',
        sha256: '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633',
        size: 26509109,
        archive: 'zip',
        binPaths: ['bun-darwin-x64/bun'],
      },
      'linux-x64': {
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip',
        sha256: '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f',
        size: 35969274,
        archive: 'zip',
        binPaths: ['bun-linux-x64/bun'],
      },
      'win32-x64': {
        url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64.zip',
        sha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922',
        size: 38366737,
        archive: 'zip',
        binPaths: ['bun-windows-x64/bun.exe'],
      },
    },
  },

  // uv 0.12.2 — astral-sh/uv GitHub releases. sha256 сверены с опубликованными
  // <asset>.sha256 файлами релиза; darwin-aarch64 дополнительно скачан и перепроверен локально.
  uv: {
    version: '0.12.2',
    kind: 'binary',
    tier: 'core',
    displayName: 'uv (Astral)',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/astral-sh/uv/releases/download/0.12.2/uv-aarch64-apple-darwin.tar.gz',
        sha256: 'fa909fea3bc06f460db79017030a221fdbc43ec4478f089cb554d8335c090817',
        size: 17676261,
        archive: 'tar.gz',
        binPaths: ['uv-aarch64-apple-darwin/uv'],
      },
      'darwin-x64': {
        url: 'https://github.com/astral-sh/uv/releases/download/0.12.2/uv-x86_64-apple-darwin.tar.gz',
        sha256: 'a6e6506a9109801222d65d17461abf4ed13bdecc5d2b13af0495418a82972c6b',
        size: 19517927,
        archive: 'tar.gz',
        binPaths: ['uv-x86_64-apple-darwin/uv'],
      },
      'linux-x64': {
        url: 'https://github.com/astral-sh/uv/releases/download/0.12.2/uv-x86_64-unknown-linux-gnu.tar.gz',
        sha256: 'd66e96b5f1ca3b99806eee283a8125d33a0bd669e6e6d9bc4ab7ffda63c41bf4',
        size: 21700643,
        archive: 'tar.gz',
        binPaths: ['uv-x86_64-unknown-linux-gnu/uv'],
      },
      'win32-x64': {
        url: 'https://github.com/astral-sh/uv/releases/download/0.12.2/uv-x86_64-pc-windows-msvc.zip',
        sha256: '01442d8ce5c7124151a73e697c836d252c6da853c18c73206d3cc4c2378a91d2',
        size: 18977266,
        archive: 'zip',
        binPaths: ['uv-x86_64-pc-windows-msvc/uv.exe'],
      },
    },
  },

  // gbrain 15b9863d1363 — git-npm: `bun install -g github:garrytan/gbrain#<commit>`
  // (пин в git-locks.ts, ключ 'gbrain@15b9863d1363'). Бинарники не качаются —
  // bun вытаскивает pinned коммит сам, поэтому artifacts пустые; dependsOn bun,
  // т.к. установка идёт toolchain-bun'ом (см. manager installOne, ветка git-npm).
  gbrain: {
    version: '15b9863d1363',
    kind: 'git-npm',
    tier: 'default-on',
    displayName: 'gbrain',
    dependsOn: ['bun'],
    artifacts: {},
  },

  // mole 1.49.2 — Homebrew формула (mac only), CLI mole + alias mo.
  // sha не нужен: ставит сам brew; префлайт `command -v brew` → иначе skipped-no-brew.
  mole: {
    version: '1.49.2',
    kind: 'brew',
    tier: 'opt-in',
    displayName: 'mole',
    systemBinary: 'mole',
    brewFormula: 'mole',
    artifacts: {},
  },

  // docker — detect opt-in: только детект системного CLI (ready/system | missing),
  // toolchain ничего не ставит.
  docker: {
    version: 'system',
    kind: 'detect',
    tier: 'opt-in',
    displayName: 'Docker CLI',
    systemBinary: 'docker',
    artifacts: {},
  },

  // brew — detect opt-in: сам Homebrew (prereq для brew-kind инструментов).
  brew: {
    version: 'system',
    kind: 'detect',
    tier: 'opt-in',
    displayName: 'Homebrew',
    systemBinary: 'brew',
    artifacts: {},
  },

  // pip-packaging 24.2 — proof opt-in pip tool (PyPI packaging library).
  // Lock: pip-locks.ts 'pip-packaging@24.2' (wheel+sdist hashes). ensureAll skips pip.
  'pip-packaging': {
    version: '24.2',
    kind: 'pip',
    tier: 'opt-in',
    displayName: 'packaging (pip)',
    dependsOn: ['uv', 'python'],
    pipPackage: 'packaging',
    // library only — no console script; installer skips launcher when pipModule unset
    artifacts: {},
  },

  // cli-anything 0.4.1 — CLI-Anything hub (PyPI cli-anything-hub).
  // Lock: pip-locks.ts 'cli-anything@0.4.1'. Console entry cli-hub → cli_hub.cli.
  'cli-anything': {
    version: '0.4.1',
    kind: 'pip',
    tier: 'opt-in',
    displayName: 'CLI-Anything',
    dependsOn: ['uv', 'python'],
    pipPackage: 'cli-anything-hub',
    pipModule: 'cli_hub.cli',
    systemBinary: 'cli-hub',
    artifacts: {},
  },



  // just 1.58.0 — github.com/casey/just; sha256: релизные checksums + локальная верификация, darwin-arm64 проверен запуском.
  just: {
    version: '1.58.0',
    kind: 'binary',
    tier: 'default-on',
    displayName: 'just',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/casey/just/releases/download/1.58.0/just-1.58.0-aarch64-apple-darwin.tar.gz',
        sha256: '50ae3e996c974a0bf32ea7d10f495070df33f1b43e0616b2769e3d4821ed8f48',
        size: 2146038,
        archive: 'tar.gz',
        binPaths: ["just"],
      },
      'darwin-x64': {
        url: 'https://github.com/casey/just/releases/download/1.58.0/just-1.58.0-x86_64-apple-darwin.tar.gz',
        sha256: '9a09cfef66aaa79da58203970103a0684307716caaabd3e9844cacc4dc0f4023',
        size: 2330963,
        archive: 'tar.gz',
        binPaths: ["just"],
      },
      'linux-x64': {
        url: 'https://github.com/casey/just/releases/download/1.58.0/just-1.58.0-x86_64-unknown-linux-musl.tar.gz',
        sha256: '4a5cc2f53e6f0f8c59092a6cc38291eb729d46a7dd95d3ae582008881b84931d',
        size: 2529009,
        archive: 'tar.gz',
        binPaths: ["just"],
      },
      'win32-x64': {
        url: 'https://github.com/casey/just/releases/download/1.58.0/just-1.58.0-x86_64-pc-windows-msvc.zip',
        sha256: '759f16fb7aa17c5c8b9594b6d4a8c1a6630dfd042cf2b3ff84841454d3d188dc',
        size: 2252404,
        archive: 'zip',
        binPaths: ["just.exe"],
      },
    },
  },

  // fzf 0.74.2 — github.com/junegunn/fzf; sha256: релизные checksums + локальная верификация, darwin-arm64 проверен запуском.
  fzf: {
    version: '0.74.2',
    kind: 'binary',
    tier: 'default-on',
    displayName: 'fzf',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/junegunn/fzf/releases/download/v0.74.2/fzf-0.74.2-darwin_arm64.tar.gz',
        sha256: 'd60ddb36356566ac69bae7c3504e888916cf747c9ad2132141c09229b1e28dee',
        size: 1905304,
        archive: 'tar.gz',
        binPaths: ["fzf"],
      },
      'darwin-x64': {
        url: 'https://github.com/junegunn/fzf/releases/download/v0.74.2/fzf-0.74.2-darwin_amd64.tar.gz',
        sha256: 'b019ae8bcca33945a2ffbbbf8369705405cd1406fc4d74267e712797010e3676',
        size: 2069781,
        archive: 'tar.gz',
        binPaths: ["fzf"],
      },
      'linux-x64': {
        url: 'https://github.com/junegunn/fzf/releases/download/v0.74.2/fzf-0.74.2-linux_amd64.tar.gz',
        sha256: 'b3648f48675612b69ee35371cf6dc99ca96d767e89b912d079080916ac8ba8bd',
        size: 2013806,
        archive: 'tar.gz',
        binPaths: ["fzf"],
      },
      'win32-x64': {
        url: 'https://github.com/junegunn/fzf/releases/download/v0.74.2/fzf-0.74.2-windows_amd64.zip',
        sha256: 'a5a3b27dd203469139d10669721952335b9b46f19346e3d1abc102a67ea60804',
        size: 2195038,
        archive: 'zip',
        binPaths: ["fzf.exe"],
      },
    },
  },

  // mise 2026.8.2 — github.com/jdx/mise; sha256: релизные checksums + локальная верификация, darwin-arm64 проверен запуском.
  mise: {
    version: '2026.8.2',
    kind: 'binary',
    tier: 'default-on',
    displayName: 'mise',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/jdx/mise/releases/download/v2026.8.2/mise-v2026.8.2-macos-arm64.tar.gz',
        sha256: '6d7ff3ad671260413d7e9e13c8b4c2d610d7c303751e1d2acd9cda234fbe06cf',
        size: 28000396,
        archive: 'tar.gz',
        binPaths: ["mise/bin/mise"],
      },
      'darwin-x64': {
        url: 'https://github.com/jdx/mise/releases/download/v2026.8.2/mise-v2026.8.2-macos-x64.tar.gz',
        sha256: '8d2b823965025473057120fe964f16575989df4103c051a8a007fe5bd1e884c4',
        size: 36056522,
        archive: 'tar.gz',
        binPaths: ["mise/bin/mise"],
      },
      'linux-x64': {
        url: 'https://github.com/jdx/mise/releases/download/v2026.8.2/mise-v2026.8.2-linux-x64.tar.gz',
        sha256: 'febda574ac4e036bf91e1ef9d33ec5e24dbfad6839eb0defa6abc12125186b74',
        size: 35957810,
        archive: 'tar.gz',
        binPaths: ["mise/bin/mise"],
      },
      'win32-x64': {
        url: 'https://github.com/jdx/mise/releases/download/v2026.8.2/mise-v2026.8.2-windows-x64.zip',
        sha256: 'f6c383ecb54876baec7d353c663959ec5866044d19920f68bef6014e7a1c41fd',
        size: 42203424,
        archive: 'zip',
        binPaths: ["mise/bin/mise.exe"],
      },
    },
  },

  // worktrunk 0.72.0 — github.com/max-sixty/worktrunk; sha256: релизные checksums + локальная верификация, darwin-arm64 проверен запуском.
  worktrunk: {
    version: '0.72.0',
    kind: 'binary',
    tier: 'default-on',
    displayName: 'worktrunk (wt)',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/max-sixty/worktrunk/releases/download/v0.72.0/worktrunk-aarch64-apple-darwin.tar.xz',
        sha256: '7e6cf79a3ef67559240431aae93c137d9a2b28a8ccdb55b64edead904b21ff73',
        size: 6580132,
        archive: 'tar.xz',
        binPaths: ["worktrunk-aarch64-apple-darwin/wt"],
      },
      'darwin-x64': {
        url: 'https://github.com/max-sixty/worktrunk/releases/download/v0.72.0/worktrunk-x86_64-apple-darwin.tar.xz',
        sha256: '2356bee43a6688a03d24b27dd18ce0db1f4666f111ee06f3c829d1f248472401',
        size: 7227732,
        archive: 'tar.xz',
        binPaths: ["worktrunk-x86_64-apple-darwin/wt"],
      },
      'linux-x64': {
        url: 'https://github.com/max-sixty/worktrunk/releases/download/v0.72.0/worktrunk-x86_64-unknown-linux-musl.tar.xz',
        sha256: 'e91bc7ceb0623942a797317f56541a825d6a36e24d055985a8299d30345be346',
        size: 8204876,
        archive: 'tar.xz',
        binPaths: ["worktrunk-x86_64-unknown-linux-musl/wt"],
      },
      'win32-x64': {
        url: 'https://github.com/max-sixty/worktrunk/releases/download/v0.72.0/worktrunk-x86_64-pc-windows-msvc.zip',
        sha256: 'cd1933e9c40836df460b6feb732999d20387bfda41da6e0972b392fadd087c03',
        size: 17375171,
        archive: 'zip',
        binPaths: ["worktrunk-x86_64-pc-windows-msvc/wt.exe"],
      },
    },
  },

  // infisical 0.43.120 — github.com/Infisical/cli; sha256: релизные checksums + локальная верификация, darwin-arm64 проверен запуском.
  infisical: {
    version: '0.43.120',
    kind: 'binary',
    tier: 'opt-in',
    displayName: 'Infisical CLI',
    artifacts: {
      'darwin-arm64': {
        url: 'https://github.com/Infisical/cli/releases/download/v0.43.120/cli_0.43.120_darwin_arm64.tar.gz',
        sha256: '6baaefd374f3c45c1b34795fde88a9cb94809429b91b4f4fda3aaf5e27dd0432',
        size: 57365209,
        archive: 'tar.gz',
        binPaths: ["infisical"],
      },
      'darwin-x64': {
        url: 'https://github.com/Infisical/cli/releases/download/v0.43.120/cli_0.43.120_darwin_amd64.tar.gz',
        sha256: '98290694f640b33a6f535a4882ceaa97523f66e32b00b0428a0ad6760ad2bdcf',
        size: 61744962,
        archive: 'tar.gz',
        binPaths: ["infisical"],
      },
      'linux-x64': {
        url: 'https://github.com/Infisical/cli/releases/download/v0.43.120/cli_0.43.120_linux_amd64.tar.gz',
        sha256: 'ac8400a1fd612d79bdbe434c4d0f505858a6592b013c607448686b21fd9edf1e',
        size: 56134826,
        archive: 'tar.gz',
        binPaths: ["infisical"],
      },
      'win32-x64': {
        url: 'https://github.com/Infisical/cli/releases/download/v0.43.120/cli_0.43.120_windows_amd64.zip',
        sha256: '99a97a82e2ac5d502d3afc2debc977e1a5bc03da9762a09bcd915eeda3f353a2',
        size: 54799521,
        archive: 'zip',
        binPaths: ["infisical.exe"],
      },
    },
  },

  // OpenClaw is deliberately opt-in: exact registry tarball + embedded lock,
  // installed script-free. Runtime resolution invokes managed Node + openclaw.mjs directly.
  openclaw: {
    version: OPENCLAW_NPM_PIN.version,
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'OpenClaw',
    dependsOn: ['node'],
    artifacts: {
      'darwin-arm64': {
        url: OPENCLAW_NPM_PIN.tarballUrl,
        sha256: OPENCLAW_NPM_PIN.tarballSha256,
        size: 19728152,
        archive: 'tar.gz',
        binPaths: ['package/openclaw.mjs'],
      },
      'darwin-x64': {
        url: OPENCLAW_NPM_PIN.tarballUrl,
        sha256: OPENCLAW_NPM_PIN.tarballSha256,
        size: 19728152,
        archive: 'tar.gz',
        binPaths: ['package/openclaw.mjs'],
      },
      'linux-x64': {
        url: OPENCLAW_NPM_PIN.tarballUrl,
        sha256: OPENCLAW_NPM_PIN.tarballSha256,
        size: 19728152,
        archive: 'tar.gz',
        binPaths: ['package/openclaw.mjs'],
      },
      'win32-x64': {
        url: OPENCLAW_NPM_PIN.tarballUrl,
        sha256: OPENCLAW_NPM_PIN.tarballSha256,
        size: 19728152,
        archive: 'tar.gz',
        binPaths: ['package/openclaw.mjs'],
      },
    },
  },

  // opencode-ai 1.18.15 — npm opencode-ai (тарболл + embedded package-lock, fail-closed).
  'opencode-ai': {
    version: '1.18.15',
    kind: 'npm',
    tier: 'default-on',
    displayName: 'OpenCode',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.18.15.tgz',
        sha256: 'aae2e10aa53da715d097ac109ca03c0feb451bd453dce9d21d335c6fc7a37c0a',
        size: 3051,
        archive: 'tar.gz',
        binPaths: ["bin/opencode"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.18.15.tgz',
        sha256: 'aae2e10aa53da715d097ac109ca03c0feb451bd453dce9d21d335c6fc7a37c0a',
        size: 3051,
        archive: 'tar.gz',
        binPaths: ["bin/opencode"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.18.15.tgz',
        sha256: 'aae2e10aa53da715d097ac109ca03c0feb451bd453dce9d21d335c6fc7a37c0a',
        size: 3051,
        archive: 'tar.gz',
        binPaths: ["bin/opencode"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.18.15.tgz',
        sha256: 'aae2e10aa53da715d097ac109ca03c0feb451bd453dce9d21d335c6fc7a37c0a',
        size: 3051,
        archive: 'tar.gz',
        binPaths: ["bin/opencode.cmd"],
      },
    },
  },

  // oh-my-codex 0.20.3 — npm oh-my-codex (тарболл + embedded package-lock, fail-closed).
  'oh-my-codex': {
    version: '0.20.3',
    kind: 'npm',
    tier: 'default-on',
    displayName: 'oh-my-codex',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/oh-my-codex/-/oh-my-codex-0.20.3.tgz',
        sha256: 'b6cacff29bb350df7ef90d589db02e5f96fd7d14fe274e07939d0efb0f41baed',
        size: 5648994,
        archive: 'tar.gz',
        binPaths: ["bin/omx"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/oh-my-codex/-/oh-my-codex-0.20.3.tgz',
        sha256: 'b6cacff29bb350df7ef90d589db02e5f96fd7d14fe274e07939d0efb0f41baed',
        size: 5648994,
        archive: 'tar.gz',
        binPaths: ["bin/omx"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/oh-my-codex/-/oh-my-codex-0.20.3.tgz',
        sha256: 'b6cacff29bb350df7ef90d589db02e5f96fd7d14fe274e07939d0efb0f41baed',
        size: 5648994,
        archive: 'tar.gz',
        binPaths: ["bin/omx"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/oh-my-codex/-/oh-my-codex-0.20.3.tgz',
        sha256: 'b6cacff29bb350df7ef90d589db02e5f96fd7d14fe274e07939d0efb0f41baed',
        size: 5648994,
        archive: 'tar.gz',
        binPaths: ["bin/omx.cmd"],
      },
    },
  },

  // oh-my-claude-sisyphus 4.15.8 — npm oh-my-claude-sisyphus (тарболл + embedded package-lock, fail-closed).
  'oh-my-claude-sisyphus': {
    version: '4.15.8',
    kind: 'npm',
    tier: 'default-on',
    displayName: 'oh-my-claudecode (sisyphus)',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/oh-my-claude-sisyphus/-/oh-my-claude-sisyphus-4.15.8.tgz',
        sha256: '35e9b8d977697dd6bb98729fe7efbad44801737d60015fe2cda4b46063ee7b11',
        size: 7162155,
        archive: 'tar.gz',
        binPaths: ["bin/omc"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/oh-my-claude-sisyphus/-/oh-my-claude-sisyphus-4.15.8.tgz',
        sha256: '35e9b8d977697dd6bb98729fe7efbad44801737d60015fe2cda4b46063ee7b11',
        size: 7162155,
        archive: 'tar.gz',
        binPaths: ["bin/omc"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/oh-my-claude-sisyphus/-/oh-my-claude-sisyphus-4.15.8.tgz',
        sha256: '35e9b8d977697dd6bb98729fe7efbad44801737d60015fe2cda4b46063ee7b11',
        size: 7162155,
        archive: 'tar.gz',
        binPaths: ["bin/omc"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/oh-my-claude-sisyphus/-/oh-my-claude-sisyphus-4.15.8.tgz',
        sha256: '35e9b8d977697dd6bb98729fe7efbad44801737d60015fe2cda4b46063ee7b11',
        size: 7162155,
        archive: 'tar.gz',
        binPaths: ["bin/omc.cmd"],
      },
    },
  },

  // skills 1.5.22 — npm skills (тарболл + embedded package-lock, fail-closed).
  skills: {
    version: '1.5.22',
    kind: 'npm',
    tier: 'default-on',
    displayName: 'vercel skills CLI',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/skills/-/skills-1.5.22.tgz',
        sha256: '10cee39139debe6c0188f4727194ade59234b277ccca2320e3ed6b620ee7f14b',
        size: 127320,
        archive: 'tar.gz',
        binPaths: ["bin/skills"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/skills/-/skills-1.5.22.tgz',
        sha256: '10cee39139debe6c0188f4727194ade59234b277ccca2320e3ed6b620ee7f14b',
        size: 127320,
        archive: 'tar.gz',
        binPaths: ["bin/skills"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/skills/-/skills-1.5.22.tgz',
        sha256: '10cee39139debe6c0188f4727194ade59234b277ccca2320e3ed6b620ee7f14b',
        size: 127320,
        archive: 'tar.gz',
        binPaths: ["bin/skills"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/skills/-/skills-1.5.22.tgz',
        sha256: '10cee39139debe6c0188f4727194ade59234b277ccca2320e3ed6b620ee7f14b',
        size: 127320,
        archive: 'tar.gz',
        binPaths: ["bin/skills.cmd"],
      },
    },
  },

  // eve 0.31.0 — npm eve (тарболл + embedded package-lock, fail-closed).
  eve: {
    version: '0.31.0',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'eve',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/eve/-/eve-0.31.0.tgz',
        sha256: '13e61aa7e3cccc94881d3cb3b77a0940696a588d42ccb9658ce818a2a863fe74',
        size: 7684730,
        archive: 'tar.gz',
        binPaths: ["bin/eve"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/eve/-/eve-0.31.0.tgz',
        sha256: '13e61aa7e3cccc94881d3cb3b77a0940696a588d42ccb9658ce818a2a863fe74',
        size: 7684730,
        archive: 'tar.gz',
        binPaths: ["bin/eve"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/eve/-/eve-0.31.0.tgz',
        sha256: '13e61aa7e3cccc94881d3cb3b77a0940696a588d42ccb9658ce818a2a863fe74',
        size: 7684730,
        archive: 'tar.gz',
        binPaths: ["bin/eve"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/eve/-/eve-0.31.0.tgz',
        sha256: '13e61aa7e3cccc94881d3cb3b77a0940696a588d42ccb9658ce818a2a863fe74',
        size: 7684730,
        archive: 'tar.gz',
        binPaths: ["bin/eve.cmd"],
      },
    },
  },

  // agent-browser 0.33.2 — npm agent-browser (тарболл + embedded package-lock, fail-closed).
  'agent-browser': {
    version: '0.33.2',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'agent-browser',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.33.2.tgz',
        sha256: '6ce3effabf413d16eb7d6090510fabc760ad5463005406a0dd4b15e85b795046',
        size: 40454547,
        archive: 'tar.gz',
        binPaths: ["bin/agent-browser"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.33.2.tgz',
        sha256: '6ce3effabf413d16eb7d6090510fabc760ad5463005406a0dd4b15e85b795046',
        size: 40454547,
        archive: 'tar.gz',
        binPaths: ["bin/agent-browser"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.33.2.tgz',
        sha256: '6ce3effabf413d16eb7d6090510fabc760ad5463005406a0dd4b15e85b795046',
        size: 40454547,
        archive: 'tar.gz',
        binPaths: ["bin/agent-browser"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.33.2.tgz',
        sha256: '6ce3effabf413d16eb7d6090510fabc760ad5463005406a0dd4b15e85b795046',
        size: 40454547,
        archive: 'tar.gz',
        binPaths: ["bin/agent-browser.cmd"],
      },
    },
  },

  // portless 0.15.5 — npm portless (тарболл + embedded package-lock, fail-closed).
  portless: {
    version: '0.15.5',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'portless',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/portless/-/portless-0.15.5.tgz',
        sha256: 'f76fb7f8d390d6e0836a25e0f954a10665428eacd4c72f3708caa2c7b5043d2e',
        size: 194331,
        archive: 'tar.gz',
        binPaths: ["bin/portless"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/portless/-/portless-0.15.5.tgz',
        sha256: 'f76fb7f8d390d6e0836a25e0f954a10665428eacd4c72f3708caa2c7b5043d2e',
        size: 194331,
        archive: 'tar.gz',
        binPaths: ["bin/portless"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/portless/-/portless-0.15.5.tgz',
        sha256: 'f76fb7f8d390d6e0836a25e0f954a10665428eacd4c72f3708caa2c7b5043d2e',
        size: 194331,
        archive: 'tar.gz',
        binPaths: ["bin/portless"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/portless/-/portless-0.15.5.tgz',
        sha256: 'f76fb7f8d390d6e0836a25e0f954a10665428eacd4c72f3708caa2c7b5043d2e',
        size: 194331,
        archive: 'tar.gz',
        binPaths: ["bin/portless.cmd"],
      },
    },
  },

  // just-bash 3.2.0 — npm just-bash (тарболл + embedded package-lock, fail-closed).
  'just-bash': {
    version: '3.2.0',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'just-bash',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/just-bash/-/just-bash-3.2.0.tgz',
        sha256: 'd82204cb63c51b4bba655325d0b670edb5be9b8ac94577e96171c2d29debca6f',
        size: 9779537,
        archive: 'tar.gz',
        binPaths: ["bin/just-bash"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/just-bash/-/just-bash-3.2.0.tgz',
        sha256: 'd82204cb63c51b4bba655325d0b670edb5be9b8ac94577e96171c2d29debca6f',
        size: 9779537,
        archive: 'tar.gz',
        binPaths: ["bin/just-bash"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/just-bash/-/just-bash-3.2.0.tgz',
        sha256: 'd82204cb63c51b4bba655325d0b670edb5be9b8ac94577e96171c2d29debca6f',
        size: 9779537,
        archive: 'tar.gz',
        binPaths: ["bin/just-bash"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/just-bash/-/just-bash-3.2.0.tgz',
        sha256: 'd82204cb63c51b4bba655325d0b670edb5be9b8ac94577e96171c2d29debca6f',
        size: 9779537,
        archive: 'tar.gz',
        binPaths: ["bin/just-bash.cmd"],
      },
    },
  },

  // opensrc 0.7.3 — npm opensrc (тарболл + embedded package-lock, fail-closed).
  opensrc: {
    version: '0.7.3',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'opensrc',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/opensrc/-/opensrc-0.7.3.tgz',
        sha256: 'f134fd04d8ac37359d0fa6e9f8b61de044f2c567e007379973a5fdda43968b66',
        size: 15709970,
        archive: 'tar.gz',
        binPaths: ["bin/opensrc"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/opensrc/-/opensrc-0.7.3.tgz',
        sha256: 'f134fd04d8ac37359d0fa6e9f8b61de044f2c567e007379973a5fdda43968b66',
        size: 15709970,
        archive: 'tar.gz',
        binPaths: ["bin/opensrc"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/opensrc/-/opensrc-0.7.3.tgz',
        sha256: 'f134fd04d8ac37359d0fa6e9f8b61de044f2c567e007379973a5fdda43968b66',
        size: 15709970,
        archive: 'tar.gz',
        binPaths: ["bin/opensrc"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/opensrc/-/opensrc-0.7.3.tgz',
        sha256: 'f134fd04d8ac37359d0fa6e9f8b61de044f2c567e007379973a5fdda43968b66',
        size: 15709970,
        archive: 'tar.gz',
        binPaths: ["bin/opensrc.cmd"],
      },
    },
  },

  // deepsec 2.3.4 — npm deepsec (тарболл + embedded package-lock, fail-closed).
  deepsec: {
    version: '2.3.4',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'deepsec',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/deepsec/-/deepsec-2.3.4.tgz',
        sha256: '051ada4fd8985957a3d019d4052ac3260d61d91a51da882e406c203707816dc1',
        size: 942615,
        archive: 'tar.gz',
        binPaths: ["bin/deepsec"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/deepsec/-/deepsec-2.3.4.tgz',
        sha256: '051ada4fd8985957a3d019d4052ac3260d61d91a51da882e406c203707816dc1',
        size: 942615,
        archive: 'tar.gz',
        binPaths: ["bin/deepsec"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/deepsec/-/deepsec-2.3.4.tgz',
        sha256: '051ada4fd8985957a3d019d4052ac3260d61d91a51da882e406c203707816dc1',
        size: 942615,
        archive: 'tar.gz',
        binPaths: ["bin/deepsec"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/deepsec/-/deepsec-2.3.4.tgz',
        sha256: '051ada4fd8985957a3d019d4052ac3260d61d91a51da882e406c203707816dc1',
        size: 942615,
        archive: 'tar.gz',
        binPaths: ["bin/deepsec.cmd"],
      },
    },
  },

  // dev3000 0.0.178 — npm dev3000 (тарболл + embedded package-lock, fail-closed).
  dev3000: {
    version: '0.0.178',
    kind: 'npm',
    tier: 'opt-in',
    displayName: 'dev3000',
    dependsOn: ['bun', 'node'],
    artifacts: {
      'darwin-arm64': {
        url: 'https://registry.npmjs.org/dev3000/-/dev3000-0.0.178.tgz',
        sha256: 'fe6f626276b33df8d78eb49450ca17955a653746846212a76186ed7b384d9ffe',
        size: 234201,
        archive: 'tar.gz',
        binPaths: ["bin/dev3000"],
      },
      'darwin-x64': {
        url: 'https://registry.npmjs.org/dev3000/-/dev3000-0.0.178.tgz',
        sha256: 'fe6f626276b33df8d78eb49450ca17955a653746846212a76186ed7b384d9ffe',
        size: 234201,
        archive: 'tar.gz',
        binPaths: ["bin/dev3000"],
      },
      'linux-x64': {
        url: 'https://registry.npmjs.org/dev3000/-/dev3000-0.0.178.tgz',
        sha256: 'fe6f626276b33df8d78eb49450ca17955a653746846212a76186ed7b384d9ffe',
        size: 234201,
        archive: 'tar.gz',
        binPaths: ["bin/dev3000"],
      },
      'win32-x64': {
        url: 'https://registry.npmjs.org/dev3000/-/dev3000-0.0.178.tgz',
        sha256: 'fe6f626276b33df8d78eb49450ca17955a653746846212a76186ed7b384d9ffe',
        size: 234201,
        archive: 'tar.gz',
        binPaths: ["bin/dev3000.cmd"],
      },
    },
  },
};
