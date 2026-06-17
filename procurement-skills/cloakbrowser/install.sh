#!/usr/bin/env bash
# Post-install setup for the cloakbrowser skill.
# Idempotent: safe to re-run.
#
# Steps:
#   1. uv tool install cloakbrowser  (or pipx fallback)
#   2. cloakbrowser install          (downloads the ~206 MB patched Chromium)
#   3. Symlink /usr/local/bin/cloakbrowser-python → the venv interpreter,
#      so the bundled scripts' shebangs work even when HOME is isolated.
set -euo pipefail

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if have uv; then
  say "Installing cloakbrowser via uv tool"
  uv tool install --quiet cloakbrowser || uv tool upgrade cloakbrowser
elif have pipx; then
  say "Installing cloakbrowser via pipx"
  pipx install cloakbrowser || pipx upgrade cloakbrowser
else
  echo "error: neither uv nor pipx is installed. Install one first:" >&2
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

say "Downloading stealth Chromium binary"
cloakbrowser install

# Find the venv python the wrapper installed.
CB_BIN=$(command -v cloakbrowser)
VENV_PY="$(dirname "$(dirname "$(readlink -f "$CB_BIN")")")/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  # Fallback for uv's tool layout: ~/.local/share/uv/tools/cloakbrowser/bin/python
  if have uv; then
    VENV_PY="$(uv tool dir)/cloakbrowser/bin/python"
  fi
fi

if [[ ! -x "$VENV_PY" ]]; then
  echo "error: could not locate the cloakbrowser venv Python." >&2
  echo "       checked: $VENV_PY" >&2
  exit 1
fi

WRAPPER=/usr/local/bin/cloakbrowser-python
say "Writing exec wrapper $WRAPPER → $VENV_PY"
# A plain symlink doesn't work here: Python resolves argv[0] through the symlink
# chain past the venv into the base interpreter, loses sys.prefix, and can't
# find the cloakbrowser package. An exec wrapper rewrites argv[0] via execve,
# so Python sees the venv path and reads pyvenv.cfg correctly.
WRAPPER_BODY=$(cat <<EOF
#!/usr/bin/env bash
exec "$VENV_PY" "\$@"
EOF
)
if [[ -w "$(dirname "$WRAPPER")" ]]; then
  printf '%s\n' "$WRAPPER_BODY" > "$WRAPPER"
  chmod +x "$WRAPPER"
else
  printf '%s\n' "$WRAPPER_BODY" | sudo tee "$WRAPPER" >/dev/null
  sudo chmod +x "$WRAPPER"
fi

say "Verifying"
"$WRAPPER" -c "import cloakbrowser; print('cloakbrowser', cloakbrowser._version.__version__ if hasattr(cloakbrowser, '_version') else 'ok')"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/scripts/check-stealth.py" | tail -1

say "Done. The skill is ready to use."
