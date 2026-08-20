#!/usr/bin/env bash
# regen-omp-lock.sh <version> — обновление pinned package-lock для omp-инструмента.
#
# Что делает:
#   1. Скачивает tarball @oh-my-pi/pi-coding-agent@<version> с npm registry
#   2. Считает его sha256 (для manifest-data.ts) и размер
#   3. Генерирует package-lock.json (`npm install --package-lock-only --omit=dev`)
#   4. Обновляет ключ 'omp@<version>' в packages/shared/src/toolchain/npm-locks.ts
#
# После запуска вручную правим manifest-data.ts: version, sha256, size (выводит
# готовые значения). Старые ключи в npm-locks.ts при этом сохраняются.
#
# Зависимости: node+npm на PATH (CI/dev машина), curl, tar, python3.
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <omp-version>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCKS_TS="$REPO_ROOT/packages/shared/src/toolchain/npm-locks.ts"
WORK="$(mktemp -d /tmp/regen-omp-lock.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

command -v npm >/dev/null || { echo "npm is required on PATH" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

TARBALL_URL="https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-${VERSION}.tgz"
echo ">> downloading $TARBALL_URL"
curl -fsSL "$TARBALL_URL" -o "$WORK/omp.tgz"

SHA256=$(shasum -a 256 "$WORK/omp.tgz" | awk '{print $1}')
SIZE=$(stat -f%z "$WORK/omp.tgz" 2>/dev/null || stat -c%s "$WORK/omp.tgz")

tar -xzf "$WORK/omp.tgz" -C "$WORK"
echo ">> resolving package-lock (npm, registry network required)"
(
  cd "$WORK/package"
  npm install --package-lock-only --omit=dev --no-audit --no-fund 2>&1 | tail -2
)
[[ -f "$WORK/package/package-lock.json" ]] || { echo "package-lock.json not generated" >&2; exit 1; }
grep -q '"lockfileVersion"' "$WORK/package/package-lock.json" || { echo "invalid lockfile" >&2; exit 1; }
# root-запись обязана содержать semver, не file:-путь (иначе npm ci сломается)
python3 -c "
import json, sys
lock = json.load(open('$WORK/package/package-lock.json'))
v = lock['packages']['']['version']
assert v == '$VERSION', f'lock root version mismatch: {v}'
print('>> lock root version ok:', v)
"

echo ">> writing lock into npm-locks.ts (key omp@$VERSION)"
python3 - "$VERSION" "$WORK/package/package-lock.json" "$LOCKS_TS" <<'PYEOF'
import base64, re, sys

version, lock_path, locks_ts = sys.argv[1], sys.argv[2], sys.argv[3]
b64 = base64.b64encode(open(lock_path, 'rb').read()).decode('ascii')

src = open(locks_ts, encoding='utf8').read()

entry = f"  // @oh-my-pi/pi-coding-agent {version}\n  'omp@{version}':\n    '{b64}',\n"
key_re = re.compile(
    r"  // @oh-my-pi/pi-coding-agent [^\n]*\n"
    rf"  'omp@{re.escape(version)}':\n"
    r"    '[A-Za-z0-9+/=]+',\n"
)
key_existing_re = re.compile(rf"  'omp@{re.escape(version)}':")

if key_existing_re.search(src):
    new_src = key_re.sub(entry, src)
    if new_src == src:
        # старый формат ключа — заменяем блочно от ключа до следующего "  //"
        block_re = re.compile(
            rf"  'omp@{re.escape(version)}':[\s\S]*?,\n(?=  //|\}});"
        )
        # not reached normally; handled below
        raise SystemExit(f"failed to replace existing lock for omp@{version}: format mismatch")
    action = "replaced"
else:
    marker = "};\n\n/** Декодированный"
    if marker not in src:
        raise SystemExit("npm-locks.ts: insertion marker not found")
    new_src = src.replace(marker, entry + marker, 1)
    action = "inserted"

if new_src == src:
    raise SystemExit("no change produced — refusing to write")
open(locks_ts, 'w', encoding='utf8').write(new_src)
print(f"lock {action} for omp@{version}")
PYEOF

echo
echo "== next: update packages/shared/src/toolchain/manifest-data.ts (omp) =="
echo "version: '$VERSION'"
echo "sha256:  '$SHA256'"
echo "size:    $SIZE"
echo
echo "verify: cd packages/shared && bun run tsc --noEmit && bun test src/toolchain"
