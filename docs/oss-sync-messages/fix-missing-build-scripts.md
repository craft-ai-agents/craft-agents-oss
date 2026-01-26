fix: add missing build scripts to OSS allow-list (#67)

The OSS repo was unbuildable — `bun run electron:start` failed because
the electron build scripts referenced by package.json were not synced.

Added:
- electron-build-main.ts, electron-build-preload.ts,
  electron-build-renderer.ts, electron-build-resources.ts (fixes electron:start)
- electron-clean.ts, electron-dev.ts (fixes electron:clean, electron:dev)
- Fix CONTRIBUTING.md clone URL → lukilabs/craft-agents-oss

Removed dist-only scripts that OSS contributors don't need:
- afterPack.cjs, build-dmg.sh, build-win.ps1, build-linux.sh

All added scripts are standard build tooling with no secrets. OAuth env
vars default to empty strings and the app gracefully degrades at runtime.

Closes #67
