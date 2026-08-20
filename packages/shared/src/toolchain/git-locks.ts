/**
 * Pinned git-locks (kind: 'git-npm' — установка через `bun install -g github:<repo>#<commit>`).
 *
 * Пин — git commit (content-addressed: bun выкачивает ровно этот снапшот дерева);
 * поля url/sha256/size описывают codeload-тарболл того же коммита и нужны для аудита
 * supply-chain (сверить можно офлайн: curl -L <url> | sha256sum).
 *
 * FAIL-CLOSED (зеркалит npm-locks.ts): записи нет → defaultGitNpmInstall падает с
 * понятной ошибкой; git-инструмент без lock-записи НЕ устанавливается никогда.
 *
 * Ключ: '<tool>@<version>' (version манифеста == human label; commit внутри записи —
 * фактический пин).
 *
 * Обновление: bun scripts/toolchain-locks.ts [--only <name>] — git-режим качает
 * codeload-tarball по pinned commit и печатает sha256/size; фрагмент вставляется
 * сюда вручную (ревью глазами).
 *
 * Каждый git-инструмент обязан приходить вместе со своей записью в одном PR.
 */
export interface GitLock {
  /** 'owner/repo' на GitHub (идёт в `bun install -g github:<repo>#<commit>`). */
  repo: string;
  /** Полный commit sha — фактический пин снапшота. */
  commit: string;
  /** https://codeload.github.com/<repo>/tar.gz/<commit> — для аудита. */
  url: string;
  /** sha256 codeload-тарболла (hex, lowercase) — для аудита. */
  sha256: string;
  /** Размер codeload-тарболла в байтах — для аудита. */
  size: number;
}

const GIT_LOCKS: Record<string, GitLock> = {
  // garrytan/gbrain @ 15b9863d13635d173562a54f55a1d388bfcf546b (2026-08-07; codeload sha256 сверен локально).
  'gbrain@15b9863d1363': {
    repo: 'garrytan/gbrain',
    commit: '15b9863d13635d173562a54f55a1d388bfcf546b',
    url: 'https://github.com/garrytan/gbrain/archive/15b9863d13635d173562a54f55a1d388bfcf546b.tar.gz',
    sha256: '36882e7f464e3844308ade078b736585eb421c7da1b0e73a79ba7f794e377e0d',
    size: 14544701,
  },
};

/**
 * Вернуть lock для '<name>@<version>' или undefined. undefined → установка
 * запрещена (см. header).
 */
export function getGitLock(name: string, version: string): GitLock | undefined {
  return GIT_LOCKS[`${name}@${version}`];
}
