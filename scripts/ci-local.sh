#!/usr/bin/env bash
# Local mirror of GitHub CI (Validate workflow). Run before opening a PR / deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> [1/4] frozen install"
bun install --frozen-lockfile

echo "==> [2/4] contracts (filenames + tool routing + skill tests)"
bun run validate:contracts

echo "==> [3/4] typecheck + shared tests + i18n"
bun run validate:dev
bun run lint:i18n:parity
bun run lint:i18n:sorted
bun run lint:i18n:coverage

if [[ "${CI_SKIP_BUILD:-}" == "1" ]]; then
  echo "==> [4/4] skip build (CI_SKIP_BUILD=1)"
else
  echo "==> [4/4] production build (subprocess + wa-worker + webui)"
  bun run build:ci
fi

echo
echo "ci-local: all green. Safe to PR / merge to main (then deploy from main)."
